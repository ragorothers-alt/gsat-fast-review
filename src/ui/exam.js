// 模擬考：選考卷、作答、題號一覽與交卷、成績單。
// 作答時借用作答畫面（#play 加上 .exam）：題目卡、選項、草稿區與橫放版面都一樣，只是不對答案，
// 可以跳題、標記、回頭改，整卷計時。考到一半的卷存在 state.exam，離開後可以接著考。
import { FILL_SHARE, PAPERS, PAPER_BY_ID, buildPaper, examOutcome, examPoints, gradeExam, keepPaper, logExam, newExam, paperStatus, validExam } from '../exam.js';
import { usedOptions } from '../groups.js';
import { fillUnit, parseTyped } from '../numeric.js';
import { questionPrompt } from '../prompt.js';
import { msNote } from '../session.js';
import { doubtCard, needsConfirm, schedule, spotSourceFor } from '../srs.js';
import { recordAnswer } from '../stats.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { copyQuestion } from './clipboard.js';
import { sfx } from './feedback.js';
import { openKeypointsFrom } from './keypoints.js';
import { choicesClass, groupPosition, markUsed, showPassage } from './passage.js';
import { fillHTML, fillKeyFor, fillProblem, typeFillKey } from './play-fill.js';
import { plainText, richHTML, stemHTML } from './rich.js';
import { addFigZoom } from './fig-zoom.js';
import { fillConceptTags, mineHTML, practiceConceptFrom, reviewItem, speakItem, toggleMark } from './review-item.js';
import { closeSheet, openSheet, topSheet } from './sheet.js';

/** 剩這麼多秒時，時間標紅並念一次（螢幕閱讀器） */
const WARN = [300, 60];
/** 每隔幾秒存一次檔（作答、標記、換題時也會存） */
const SAVE_EVERY = 10;
/** 選了答案後多久自動換下一題（改答案、取消時不換） */
const AUTO_NEXT = 300;
/** 成績單上列出花最久的幾題 */
const SLOW_SHOWN = 5;

/** 秒數 → m:ss */
export function clock(secs) {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
/** 得分：多選題部分給分後可能有小數，取到小數第一位 */
const fmt = (x) => String(Math.round(x * 10) / 10);
const md = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function initExam(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const play = $('#play');
  const sheet = $('#exam-sheet');
  const indexSheet = $('#exam-index');
  const el = {
    card: $('#card'),
    subject: $('#q-subject'),
    topic: $('#q-topic'),
    text: $('#q-text'),
    passage: $('#q-passage'),
    answers: $('#answers'),
    progress: $('#play-progress'),
    clock: $('#exam-clock'),
    mark: $('#exam-mark'),
    prev: $('#exam-prev'),
    next: $('#exam-next'),
    status: $('#answer-status'),
  };
  const byId = ctx.byId;
  let exam = null; // 作答中的考卷（就是 ctx.state.exam）
  let tickTimer = 0;
  let autoNext = 0;
  let lastT = 0;
  let sinceSave = 0;
  let confirmSubmit = false;
  let fillText = ''; // 選填題：目前這題填的字（只按了負號這種還不算作答的也在這裡）
  let report = null; // 成績單：{ result, paper }

  // ── 選考卷 ───────────────────────────────────────────
  ctx.openExam = () => {
    renderPicker();
    openSheet(sheet, { focus: $('#exam-resume').hidden ? null : $('#exam-continue') });
  };

  /** 存檔裡考到一半的卷；題目已經不在題庫裡（例如改版刪題）就丟掉 */
  function savedExam() {
    const saved = ctx.state.exam;
    if (saved && !validExam(saved, byId)) {
      ctx.state.exam = null;
      ctx.save();
      return null;
    }
    return saved ?? null;
  }

  function renderPicker() {
    const saved = savedExam();
    $('#exam-resume').hidden = !saved;
    if (saved) {
      const paper = PAPER_BY_ID[saved.paper];
      const answered = saved.answers.filter((a) => a !== null).length;
      $('#exam-resume-text').textContent = `${paper.name}考到一半：已作答 ${answered}／${saved.ids.length} 題，還剩 ${clock(saved.limit - saved.elapsed)}。`;
    }
    const log = ctx.state.examLog ?? [];
    $('#exam-papers').innerHTML = orderedPapers().map(({ p, mine }) => {
      const last = [...log].reverse().find((e) => e.paper === p.id);
      const subjects = p.subjects.map((s) => SUBJECT_BY_ID[s]);
      return `<li style="--c:${subjects[0].color}"${mine ? '' : ' class="other"'}>
        <span class="exam-paper-name">${p.name}</span>
        <span class="exam-paper-meta">${p.size} 題・${p.minutes} 分鐘${p.subjects.length > 1 ? `・${subjects.map((s) => s.name).join('、')}` : ''}${p.groups ? `・含 ${p.groups} 組${p.groupName}` : ''}${FILL_SHARE[p.id] ? '・有選填題' : ''}</span>
        <span class="exam-paper-last">${last ? `上次 ${pct(examPoints(last), last.total)}%（${md(last.at)}）` : mine ? '還沒考過' : '沒選這科・還沒考過'}</span>
        <button type="button" class="secondary-btn exam-start" data-paper="${p.id}"${saved ? ' disabled' : ''} aria-label="開始${p.name}模擬考">開始</button>
      </li>`;
    }).join('');
    renderHistory();
  }

  /** 考卷的順序：設定裡主攻的卷先列，再來是有選到科目的，都沒選的排最後（照樣可以考） */
  function orderedPapers() {
    const { subjects = [], focus = [] } = ctx.state.settings;
    const rank = (p) => (focus.includes(p.id) ? 0 : p.subjects.some((s) => subjects.includes(s)) ? 1 : 2);
    return PAPERS.map((p, i) => ({ p, i, r: rank(p) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ p, r }) => ({ p, mine: r < 2 }));
  }

  /** 考過的卷（新的在上）：點了重開那一份的成績單；題目已經不在題庫裡的不能重開 */
  function renderHistory() {
    const papers = [...(ctx.state.examPapers ?? [])].reverse();
    $('#exam-history').hidden = !papers.length;
    const jump = $('#exam-history-jump');
    jump.hidden = !papers.length;
    jump.textContent = `考過的卷（${papers.length}）↓`;
    $('#exam-past').innerHTML = papers
      .map((p) => {
        const paper = PAPER_BY_ID[p.paper];
        if (!paper) return '';
        const status = paperStatus(p, byId);
        const color = SUBJECT_BY_ID[paper.subjects[0]].color;
        const score = status.ok ? gradeExam(p, byId) : null;
        const when = `${md(p.at)} ${new Date(p.at).toTimeString().slice(0, 5)}・用時 ${clock(p.elapsed)}`;
        return `<li><button type="button" data-at="${p.at}" style="--c:${color}"${status.ok ? '' : ' disabled'}>
          <span class="exam-past-name">${paper.name}</span>
          <span class="exam-past-when">${status.ok ? when : '題目改版後已不在題庫，不能重開'}</span>
          <span class="exam-past-score">${score ? `${pct(score.points, score.total)}%` : '—'}</span>
        </button></li>`;
      })
      .join('');
  }

  $('#exam-history-jump').addEventListener('click', () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#exam-history').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    $('#exam-past button:not(:disabled)')?.focus({ preventScroll: true });
  });

  $('#exam-past').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-at]');
    if (btn && !btn.disabled) reopen(Number(btn.dataset.at));
  });

  /** 重開存著的卷：成績單照當時的作答重算（不再寫進排程與今日題數），跟前一次同一張卷比 */
  function reopen(at) {
    const saved = (ctx.state.examPapers ?? []).find((p) => p.at === at);
    const status = saved && paperStatus(saved, byId);
    if (!status?.ok) return renderPicker();
    const paper = PAPER_BY_ID[saved.paper];
    const prev = [...(ctx.state.examLog ?? [])].reverse().find((e) => e.paper === saved.paper && e.at < at) ?? null;
    closeSheet(sheet);
    showReport(paper, gradeExam(saved, byId), prev, false, { at, changed: status.changed });
  }

  $('#exam-papers').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-paper]');
    if (btn && !btn.disabled) start(btn.dataset.paper);
  });
  $('#exam-continue').addEventListener('click', () => {
    if (!savedExam()) return renderPicker();
    closeSheet(sheet);
    enter();
  });
  $('#exam-drop').addEventListener('click', () => {
    ctx.state.exam = null;
    ctx.save();
    ctx.scratch.forgetExams();
    renderPicker();
    ctx.refreshHome?.();
    ctx.toast('已放棄這份考卷，作答不會記錄');
  });
  $('#exam-close').addEventListener('click', () => closeSheet(sheet));
  sheet.addEventListener('sheet-close', () => closeSheet(sheet));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet(sheet);
  });

  function start(paperId) {
    const paper = PAPER_BY_ID[paperId];
    const { excludedUnits } = ctx.state.settings;
    const picked = buildPaper(ctx.bank, paper, { excludedUnits, flags: ctx.state.flags });
    if (!picked.ids.length) {
      ctx.toast('這張考卷的科目都沒有可以出的題目');
      return;
    }
    if (picked.ids.length < paper.size) ctx.toast(`題目不夠，這份只有 ${picked.ids.length} 題`);
    // 之前沒考完就換卷的草稿不要了
    ctx.scratch.forgetExams();
    ctx.state.exam = newExam(paper, picked, Date.now());
    ctx.save();
    closeSheet(sheet);
    enter();
  }

  // ── 作答 ─────────────────────────────────────────────
  function enter() {
    exam = ctx.state.exam;
    confirmSubmit = false;
    play.classList.add('exam');
    ctx.scratch.start();
    ctx.show('play');
    showQuestion();
    lastT = performance.now();
    sinceSave = 0;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);
    renderClock();
  }

  /** 離開作答畫面（暫停或交卷）：停止計時，作答畫面還原成一般模式 */
  function leave() {
    clearInterval(tickTimer);
    clearTimeout(autoNext);
    play.classList.remove('exam');
    ctx.world.setFocusSubject(null);
    exam = null;
  }

  const current = () => byId.get(exam.ids[exam.index]);
  /** 目前這題是選填題：不給選項，用數字鍵填數值 */
  const isFill = () => !!exam?.fills?.[exam.index];

  function showQuestion() {
    clearTimeout(autoNext);
    const q = current();
    const i = exam.index;
    const n = exam.ids.length;
    const subj = SUBJECT_BY_ID[q.subject];
    el.card.style.setProperty('--c', subj.color);
    el.subject.textContent = subj.name;
    // 學測不會告訴你考哪個單元：不顯示單元名稱，只標出多選題、選填題（試卷上分開標）與題組
    const pos = groupPosition(
      exam.ids.map((id) => byId.get(id)),
      i,
    );
    const where = pos ? `題組 ${pos.k}／${pos.n}` : '';
    // 兩段各自不換行（和作答畫面一樣，題型的標記不會被拆成兩行）
    el.topic.innerHTML = [q.type === 'ms' ? '多選題' : isFill() ? '選填題' : '', where]
      .filter(Boolean)
      .map((t) => `<span class="topic-fixed">${t}</span>`)
      .join('・');
    showPassage(el.passage, q, where);
    el.text.innerHTML = stemHTML(q);
    addFigZoom(el.text, q.fig);
    el.progress.textContent = `${i + 1} / ${n}`;
    el.prev.disabled = i === 0;
    el.next.textContent = i === n - 1 ? '檢查並交卷' : '下一題 ›';
    renderAnswers(q);
    renderMark();
    el.card.classList.remove('enter');
    void el.card.offsetWidth;
    el.card.classList.add('enter');
    el.status.textContent = '';
    ctx.fitCard();
    // 每題一頁：回到這題（上一題、題號一覽、離開後接著考）時草稿還在
    ctx.scratch.newPage(q, `exam-${exam.at}-${i}`);
    ctx.world.setFocusSubject(q.subject);
  }

  /** 這個選項（原始索引）現在有沒有選：多選題的作答是陣列 */
  const isOn = (answer, orig) => (Array.isArray(answer) ? answer.includes(orig) : answer === orig);

  function renderAnswers(q) {
    if (isFill()) return renderFill(q);
    const order = exam.orders[exam.index];
    const chosen = exam.answers[exam.index];
    el.answers.className = q.type === 'mc' ? choicesClass(q) : `answers ${q.type}`;
    el.answers.innerHTML = '';
    order.forEach((orig, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer';
      btn.setAttribute('aria-pressed', String(isOn(chosen, orig)));
      btn.innerHTML = `<span class="key" aria-hidden="true">${i + 1}</span><span class="answer-text">${richHTML(q.choices[orig])}</span>`;
      // 有公式的選項改念 plainText 轉出來的文字（同作答畫面）
      const text = btn.querySelector('.answer-text');
      if (text.querySelector('math')) {
        const said = document.createElement('span');
        said.className = 'sr-only';
        said.textContent = plainText(text);
        text.setAttribute('aria-hidden', 'true');
        btn.append(said);
      }
      btn.addEventListener('click', () => choose(orig));
      btn._orig = orig;
      el.answers.append(btn);
    });
    // 共用選項：同組別的空格自己已經選了的選項標出來（像在考卷上刪去）
    const filled = exam.ids.map((id, k) => ({ q: byId.get(id), value: exam.answers[k] }));
    markUsed(el.answers, usedOptions(q, filled), (b) => b._orig, 'picked');
  }

  /**
   * 選答案；再按一次同一個就取消。單選題第一次選了答案就自動換下一題（最後一題不換）；
   * 多選題點選項只是切換要不要選，不知道選完了沒，所以不自動換題
   */
  function choose(orig) {
    if (!exam) return;
    const i = exam.index;
    const order = exam.orders[i];
    const multi = current().type === 'ms';
    const was = exam.answers[i];
    if (multi) {
      const set = new Set(was ?? []);
      if (!set.delete(orig)) set.add(orig);
      exam.answers[i] = set.size ? [...set].sort((a, b) => a - b) : null;
    } else exam.answers[i] = was === orig ? null : orig;
    const now = exam.answers[i];
    for (const b of el.answers.children) b.setAttribute('aria-pressed', String(isOn(now, b._orig)));
    const nth = (list) => list.map((o) => order.indexOf(o) + 1).sort((a, b) => a - b).join('、');
    el.status.textContent = now === null ? '已取消作答' : `已選第 ${nth(multi ? now : [now])} 個選項`;
    ctx.save();
    if (!multi && was === null && now !== null && i < exam.ids.length - 1) {
      clearTimeout(autoNext);
      autoNext = setTimeout(() => go(1), AUTO_NEXT);
    }
  }

  // ── 選填題：和學測一樣不給選項，算出數值用數字鍵填進去；填的字隨時存著，可以回頭改 ─────
  function renderFill(q) {
    fillText = exam.answers[exam.index] ?? '';
    el.answers.className = 'answers fill';
    el.answers.innerHTML = fillHTML({ exam: true });
    el.answers.querySelector('.fill-unit').textContent = fillUnit(q);
    const keys = el.answers.querySelector('.fill-keys');
    keys.addEventListener('click', (e) => {
      const key = e.target.closest('[data-k]');
      if (key) typeKey(key.dataset.k);
    });
    // 用滑鼠點數字鍵不搶焦點：接著按實體鍵盤的 Enter 是「填好了」，不會重按剛剛點的那顆鍵
    keys.addEventListener('mousedown', (e) => e.preventDefault());
    renderFillValue();
    // 回到一題上次沒填完的（例如只填了「1/」）：直接說缺什麼
    showFillHint(fillProblem(fillText));
  }

  function renderFillValue() {
    const out = el.answers.querySelector('.fill-value');
    out.textContent = fillText || '算出答案後填入';
    out.classList.toggle('empty', !fillText);
  }

  /** 填答框下面看得到的提示（沒填完時說缺什麼）；null 是收起來 */
  function showFillHint(text) {
    let hint = el.answers.querySelector('.fill-hint');
    if (!text) return hint?.remove();
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'fill-hint';
      el.answers.querySelector('.fill-box').after(hint);
    }
    hint.textContent = text;
  }

  /** 選填題填了字但不是完整的數（「1/」「2.」）：算已作答但會是答錯，題號一覽與交卷時另外提醒 */
  const unfinished = (i) => !!exam.fills?.[i] && fillProblem(exam.answers[i]) !== null;

  /** 按一個填答鍵（字串怎麼變見 play-fill.js）：有數字就算作答、馬上存；刪到沒有數字就是沒作答 */
  function typeKey(k) {
    if (!exam || !isFill()) return;
    if (k === 'ok') return fillDone();
    const t = typeFillKey(fillText, k);
    if (t === null) return;
    fillText = t;
    exam.answers[exam.index] = /\d/.test(t) ? t : null;
    renderFillValue();
    showFillHint(null);
    ctx.save();
  }

  /** 「填好了」（或 Enter）：填的是完整的數就換下一題（最後一題不換）；還沒填好時提示格式 */
  function fillDone() {
    const text = exam.answers[exam.index];
    if (text === null || parseTyped(text) === null) {
      const problem = fillProblem(text);
      showFillHint(problem ? `${problem}：填整數、小數或分數，例如 -3、2.5、7/4` : '先填入答案：整數、小數或分數，例如 -3、2.5、7/4');
      el.status.textContent = '先填入答案：整數、小數或分數，例如 -3、2.5、7/4';
      const box = el.answers.querySelector('.fill-box');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      return;
    }
    el.status.textContent = `已填 ${text}`;
    if (exam.index < exam.ids.length - 1) {
      clearTimeout(autoNext);
      autoNext = setTimeout(() => go(1), AUTO_NEXT);
    }
  }

  function go(delta) {
    if (!exam) return;
    const to = exam.index + delta;
    if (to < 0) return;
    if (to >= exam.ids.length) return openIndex();
    exam.index = to;
    ctx.save();
    showQuestion();
    // 選填題沒有選項可以聚焦：移到題目（數字直接用鍵盤打），不讓焦點掉回頁首
    if (document.activeElement?.closest?.('#answers') || document.activeElement === document.body) {
      const target = el.answers.querySelector('.answer') ?? document.querySelector('#q-text');
      if (target && !target.matches('.answer') && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      target?.focus({ preventScroll: true });
    }
  }

  function renderMark() {
    el.mark.setAttribute('aria-pressed', String(!!exam.marks[exam.index]));
  }

  el.mark.addEventListener('click', () => {
    if (!exam) return;
    exam.marks[exam.index] = !exam.marks[exam.index];
    renderMark();
    ctx.save();
  });
  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));

  // ── 計時：切到背景時暫停；時間到自動交卷 ──────────────────
  function tick() {
    const t = performance.now();
    const dt = Math.min((t - lastT) / 1000, 1);
    lastT = t;
    if (!exam || document.hidden) return;
    const before = exam.limit - exam.elapsed;
    exam.elapsed += dt;
    exam.spent[exam.index] += dt;
    const left = exam.limit - exam.elapsed;
    for (const w of WARN) if (before > w && left <= w) el.status.textContent = `剩 ${w / 60} 分鐘`;
    renderClock();
    sinceSave += dt;
    if (sinceSave >= SAVE_EVERY) {
      sinceSave = 0;
      ctx.save();
    }
    if (left <= 0) submit(true);
  }

  function renderClock() {
    if (!exam) return;
    const left = exam.limit - exam.elapsed;
    el.clock.textContent = clock(left);
    el.clock.classList.toggle('low', left <= WARN[0]);
  }

  document.addEventListener('visibilitychange', () => {
    if (exam && document.hidden) ctx.save();
    lastT = performance.now();
  });

  // ── 題號一覽、先離開、交卷 ──────────────────────────────
  function openIndex() {
    if (!exam) return;
    confirmSubmit = false;
    renderIndex();
    openSheet(indexSheet, { focus: $('#exam-submit') });
  }

  function renderIndex() {
    const n = exam.ids.length;
    const half = exam.ids.map((_, i) => unfinished(i));
    const halves = half.filter(Boolean).length;
    const answered = exam.answers.filter((a) => a !== null).length - halves;
    const marked = exam.marks.filter(Boolean).length;
    const blank = n - answered - halves;
    $('#exam-index-sum').textContent =
      `已作答 ${answered}／${n} 題${marked ? `，標記 ${marked} 題` : ''}，還剩 ${clock(exam.limit - exam.elapsed)}。` +
      (blank ? `還有 ${blank} 題沒作答。` : halves ? '' : '全部都作答了。') +
      (halves ? `${halves} 題選填沒填完（像是分數少了分母），照這樣交卷算答錯。` : '') +
      '點題號可以跳過去。';
    $('#exam-grid').innerHTML = exam.ids
      .map((_, i) => {
        const done = exam.answers[i] !== null && !half[i];
        const mark = exam.marks[i];
        const label = `第 ${i + 1} 題，${half[i] ? '沒填完' : done ? '已作答' : '沒作答'}${mark ? '，標記' : ''}${i === exam.index ? '，目前這題' : ''}`;
        return `<li><button type="button" class="cell${done ? ' done' : ''}${half[i] ? ' half' : ''}${mark ? ' marked' : ''}${i === exam.index ? ' current' : ''}" data-at="${i}" aria-label="${label}">${i + 1}</button></li>`;
      })
      .join('');
    $('#exam-legend-half').hidden = !halves;
    const left = [blank ? `${blank} 題沒作答` : '', halves ? `${halves} 題沒填完` : ''].filter(Boolean).join('、');
    $('#exam-submit').textContent = confirmSubmit ? `還有 ${left}，確定交卷` : '交卷';
  }

  $('#exam-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-at]');
    if (!btn || !exam) return;
    exam.index = Number(btn.dataset.at);
    ctx.save();
    closeSheet(indexSheet);
    showQuestion();
  });
  $('#exam-index-btn').addEventListener('click', openIndex);
  $('#exam-index-close').addEventListener('click', () => closeSheet(indexSheet));
  indexSheet.addEventListener('sheet-close', () => closeSheet(indexSheet));
  indexSheet.addEventListener('click', (e) => {
    if (e.target === indexSheet) closeSheet(indexSheet);
  });
  $('#exam-submit').addEventListener('click', () => {
    if (!exam) return;
    const blank = exam.answers.filter((a, i) => a === null || unfinished(i)).length;
    // 還有沒作答（或選填沒填完）的：按第二次才交卷
    if (blank && !confirmSubmit) {
      confirmSubmit = true;
      renderIndex();
      return;
    }
    closeSheet(indexSheet);
    submit(false);
  });

  /** 先離開：計時停止，回首頁；之後從「模擬考」接著考 */
  function pause() {
    if (!exam) return;
    ctx.save();
    if (!indexSheet.hidden) closeSheet(indexSheet);
    leave();
    ctx.goHome();
    ctx.toast('先存起來了，首頁的「模擬考」可以接著考');
  }
  $('#exam-pause').addEventListener('click', pause);
  $('#exam-quit').addEventListener('click', pause);

  // 鍵盤：1–4（多選題 1–5）選答案、←／→ 換題、M 標記、Esc 打開題號一覽；
  // 選填題直接打數字、小數點、負號、分數線，Backspace 刪除、Enter 填好了（焦點在按鈕上時 Enter 交給那個按鈕）
  document.addEventListener('keydown', (e) => {
    if (!exam || play.hidden || topSheet() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = isFill() ? fillKeyFor(e.key) : null;
    if (k && !(k === 'ok' && e.target.closest?.('button'))) {
      e.preventDefault();
      return typeKey(k);
    }
    const order = exam.orders[exam.index];
    if (k) return;
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= order.length) choose(order[Number(e.key) - 1]);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'm' || e.key === 'M') el.mark.click();
    else if (e.key === 'Escape') openIndex();
    else return;
    e.preventDefault();
  });

  // ── 交卷、成績單 ───────────────────────────────────────
  function submit(timeUp) {
    if (!exam) return;
    const done = exam;
    const paper = PAPER_BY_ID[done.paper];
    const result = gradeExam(done, byId);
    // 作答寫進排程與每日題數：答錯的、想過但沒作答的進錯題複習；答對但標記過的算不太確定（見 examOutcome）
    const now = Date.now();
    for (const it of result.items) {
      const outcome = examOutcome(it);
      if (!outcome) continue;
      const before = ctx.state.cards[it.id];
      // 抽查（見 srs.js）：同考點前幾天第一次就答對、等著抽查的那題，這題沒答對就拉回來隔天再確認
      const spot = before ? null : spotSourceFor(ctx.bank, ctx.state.cards, byId.get(it.id), now);
      ctx.state.cards[it.id] = schedule(before, outcome, now, { confirm: needsConfirm(byId.get(it.id)) });
      if (spot && outcome !== 'right') ctx.state.cards[spot] = doubtCard(ctx.state.cards[spot], now);
      recordAnswer(ctx.state, outcome, now);
    }
    const prev = logExam(ctx.state, paper.id, result, now);
    keepPaper(ctx.state, done, byId, now);
    ctx.state.exam = null;
    ctx.save();
    ctx.scratch.forgetExams();
    leave();
    showReport(paper, result, prev, timeUp);
    ctx.cloudSync?.();
    ctx.reminder?.sync();
  }

  /**
   * @param {{ at: number, changed: Set<string> } | null} past 重開考過的卷：哪一天考的、考完之後修正過的題目
   */
  function showReport(paper, result, prev, timeUp, past = null) {
    report = { paper, result, changed: past?.changed ?? new Set() };
    const { total, right, points, blank, secs, limit } = result;
    // 有多選題的卷照學測部分給分：大字是得分，不是答對題數
    const hasMs = result.items.some((it) => it.q.type === 'ms');
    $('#x-paper').textContent = `${paper.name}模擬考${past ? `・${md(past.at)} 考的` : timeUp ? '・時間到，自動交卷' : ''}`;
    $('#x-big').textContent = `${fmt(points)} / ${total}`;
    $('#x-acc').textContent = `${pct(points, total)}%`;
    $('#x-acc-label').textContent = hasMs ? '得分率' : '答對率';
    // 多選部分給分會出現 0.2 這種分數：欄名寫得分，不寫答對題數
    $('#x-units-label').textContent = hasMs ? '得分／滿分・平均每題秒數' : '答對／題數・平均每題秒數';
    $('#x-time').textContent = clock(secs);
    $('#x-time-label').textContent = `用時／${paper.minutes} 分`;
    $('#x-blank').textContent = String(blank);
    const partial = points - right;
    const diff = prev ? pct(points, total) - pct(examPoints(prev), prev.total) : null;
    $('#x-cheer').textContent =
      (partial > 0 ? `全對 ${right} 題，多選題照學測規則部分給分，另得 ${fmt(partial)} 分。` : '') +
      (diff === null ? '' : `比上次（${md(prev.at)}）${diff === 0 ? '一樣' : diff > 0 ? `高 ${diff} 個百分點` : `低 ${-diff} 個百分點`}。`) +
      cheer(points / total);

    // 合科試卷：每科先列一行小計，再列這科的各單元
    const multi = paper.subjects.length > 1;
    $('#x-units').innerHTML = result.units
      .map((u, i) => {
        const subj = SUBJECT_BY_ID[u.subject];
        const p = pct(u.points, u.total);
        let head = '';
        if (multi && result.units[i - 1]?.subject !== u.subject) {
          const mine = result.units.filter((x) => x.subject === u.subject);
          const sum = (k) => mine.reduce((a, x) => a + x[k], 0);
          head = `<li class="x-subject" style="--c:${subj.color}"><span class="tag">${subj.name}</span><span class="x-unit-name">小計</span><b class="x-unit-score">${fmt(sum('points'))}/${sum('total')}</b><span class="x-unit-secs">${Math.round(sum('secs') / sum('total'))} 秒</span></li>`;
        }
        return `${head}<li style="--c:${subj.color}">
          <span class="tag">${subj.name}</span>
          <span class="x-unit-name">${u.unit}</span>
          <b class="x-unit-score">${fmt(u.points)}/${u.total}</b>
          <span class="x-unit-secs">${Math.round(u.secs / u.total)} 秒</span>
          <span class="unit-meter" role="img" aria-label="${hasMs ? '得分率' : '答對'} ${p}%"><i style="width:${p}%"></i></span>
        </li>`;
      })
      .join('');

    const per = Math.round(limit / total);
    const avg = Math.round(secs / total);
    const r = (x) => (x === null ? null : Math.round(x));
    $('#x-pace').textContent =
      `平均每題 ${avg} 秒（這份卷每題約有 ${per} 秒）。` +
      (r(result.avgRight) !== null && r(result.avgWrong) !== null ? `答對的題平均 ${r(result.avgRight)} 秒，答錯的 ${r(result.avgWrong)} 秒。` : '') +
      (blank ? `有 ${blank} 題沒作答：先把會的做完，卡住的標記起來，最後再回頭做。` : '') +
      (result.avgWrong !== null && result.avgRight !== null && result.avgWrong > result.avgRight * 1.5 && result.avgWrong > per
        ? '答錯的題目花的時間明顯比較多：想超過一分鐘還沒頭緒的題目，先標記跳過。'
        : '');
    const slow = [...result.items].sort((a, b) => b.secs - a.secs).slice(0, SLOW_SHOWN);
    $('#x-slow').innerHTML = slow
      .map((it) => {
        // 多選題沒全對但拿到部分分數的，標出得幾分
        const [cls, state] = it.blank ? ['blank', '沒作答'] : it.right ? ['right', '答對'] : it.score > 0 ? ['partial', `得 ${fmt(it.score)} 分`] : ['wrong', '答錯'];
        return `<li><button type="button" class="x-slow-item" data-at="${it.n - 1}">
          <span class="x-slow-n">第 ${it.n} 題</span>
          <span class="x-slow-unit">${SUBJECT_BY_ID[it.q.subject].name}・${it.q.topic}</span>
          <span class="x-slow-secs">${Math.round(it.secs)} 秒</span>
          <span class="x-slow-state ${cls}">${state}</span>
        </button></li>`;
      })
      .join('');

    const misses = missed();
    const tried = result.items.some((it) => it.blank && examOutcome(it));
    $('#x-review-title').textContent = misses.length
      ? `答錯、沒作答與標記過的題目（${misses.length} 題；答錯的${tried ? '和想過但沒作答的' : ''}已加入錯題複習）`
      : '全對！這份卷沒有錯題';
    const { flags, stars } = ctx.state;
    $('#x-list').innerHTML = misses.map((it, i) => reviewItem(it.q, { index: i, flagged: !!flags[it.id], starred: !!stars[it.id], note: mine(it) })).join('');
    fillConceptTags($('#x-list'));
    // 練的就是上面列的那些：答錯、沒作答，以及答對但標記過（沒把握）的
    $('#x-train').textContent = misses.length ? `練這份的錯題（${misses.length} 題）` : '再考一份';

    ctx.world.setCast(paper.subjects);
    ctx.show('exam-report');
    $('#exam-report .result-scroll').scrollTop = 0;
    // 重開考過的卷是回頭訂正，不再放交卷的音效與慶祝
    if (past) return;
    sfx.finish();
    if (points / total >= 0.9) ctx.world.celebrate();
  }

  /** 成績單下面要再看一眼的題目：答錯（多選題沒全對）、沒作答，以及答對但標記過的 */
  const missed = () => report.result.items.filter((it) => !it.right || it.marked);

  function mine(it) {
    // 重開考過的卷時，考完之後修正過的題目要標出來：現在看到的題目和當時不完全一樣
    const fixed = report.changed.has(it.id) ? '<span class="r-mine skip">這題在你考完之後修正過，題目與當時略有不同</span>' : '';
    if (it.blank) return `<span class="r-mine skip">沒作答</span>${fixed}`;
    if (it.right) return `<span class="r-mine skip">答對了，但你標記了這題</span>${fixed}`;
    const note = it.q.type === 'ms' ? `<span class="r-mine skip">${msNote(it.q, it.answer)}</span>` : '';
    return `<span class="r-mine">${mineHTML(it.q, entryOf(it))}</span>${note}${fixed}`;
  }

  /** 這題在成績單上的作答紀錄（回看、複製題目用；選項照當時的順序；選填題附上填的字） */
  const entryOf = (it) => ({
    outcome: it.blank ? 'blank' : it.right ? 'right' : 'wrong',
    chosen: it.answer,
    order: it.order,
    ...(it.typed === undefined ? {} : { typed: it.typed }),
  });

  $('#x-slow').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-at]');
    if (!btn || !report) return;
    const list = report.result.items.map((it) => ({ q: it.q, entry: entryOf(it), n: it.n }));
    ctx.openPast(list, { start: Number(btn.dataset.at), backLabel: '回到成績單', timed: false, onClose: () => {} });
  });

  $('#x-list').addEventListener('click', (e) => {
    if (!report) return;
    const items = missed();
    if (openKeypointsFrom(ctx, e.target) || practiceConceptFrom(ctx, e.target) || speakItem(e.target, items.map((it) => it.q))) return;
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const it = items[Number(copy.dataset.copy)];
      copyQuestion(questionPrompt(it.q, entryOf(it)), ctx.toast);
      return;
    }
    toggleMark(ctx, e.target);
  });

  $('#x-home').addEventListener('click', () => ctx.goHome());
  $('#x-train').addEventListener('click', () => {
    const ids = report ? missed().map((it) => it.id) : [];
    if (ids.length) ctx.startRound('exam', { ids });
    else {
      ctx.goHome();
      ctx.openExam();
    }
  });

  /** 首頁按鈕下面的小字：考到一半的、上次的成績 */
  ctx.examSummary = () => {
    const saved = ctx.state.exam;
    if (saved && PAPER_BY_ID[saved.paper] && Array.isArray(saved.answers)) {
      const answered = saved.answers.filter((a) => a !== null).length;
      return `${PAPER_BY_ID[saved.paper].name}考到一半・${answered}/${saved.ids.length} 題`;
    }
    const last = ctx.state.examLog?.at(-1);
    return last && PAPER_BY_ID[last.paper] ? `上次${PAPER_BY_ID[last.paper].name} ${pct(examPoints(last), last.total)}%` : '照學測配分出一份卷・整卷計時';
  };
}

function cheer(acc) {
  if (acc >= 0.9) return '非常穩，考試就照這個節奏！';
  if (acc >= 0.75) return '不錯！把錯的單元補起來就更穩了。';
  if (acc >= 0.5) return '過半了，看看哪些單元掉分最多，先補那幾個。';
  return '先別急，從錯最多的單元開始，用弱點加強一個一個補。';
}
