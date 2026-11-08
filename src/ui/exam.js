// 模擬考：選考卷、作答、題號一覽與交卷、成績單。
// 作答時借用作答畫面（#play 加上 .exam）：題目卡、選項、草稿區與橫放版面都一樣，只是不對答案，
// 可以跳題、標記、回頭改，整卷計時。考到一半的卷存在 state.exam，離開後可以接著考。
import { PAPERS, PAPER_BY_ID, buildPaper, examOutcome, examPoints, gradeExam, logExam, newExam, validExam } from '../exam.js';
import { usedOptions } from '../groups.js';
import { questionPrompt } from '../prompt.js';
import { msNote } from '../session.js';
import { schedule } from '../srs.js';
import { recordAnswer } from '../stats.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { copyQuestion } from './clipboard.js';
import { sfx } from './feedback.js';
import { openKeypointsFrom } from './keypoints.js';
import { choicesClass, groupPosition, markUsed, showPassage } from './passage.js';
import { plainText, richHTML, stemHTML } from './rich.js';
import { mineHTML, reviewItem, speakItem, toggleMark } from './review-item.js';
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
    $('#exam-papers').innerHTML = PAPERS.map((p) => {
      const last = [...log].reverse().find((e) => e.paper === p.id);
      const subjects = p.subjects.map((s) => SUBJECT_BY_ID[s]);
      return `<li style="--c:${subjects[0].color}">
        <span class="exam-paper-name">${p.name}</span>
        <span class="exam-paper-meta">${p.size} 題・${p.minutes} 分鐘${p.subjects.length > 1 ? `・${subjects.map((s) => s.name).join('、')}` : ''}${p.groups ? `・含 ${p.groups} 組${p.groupName}` : ''}</span>
        <span class="exam-paper-last">${last ? `上次 ${pct(examPoints(last), last.total)}%（${md(last.at)}）` : '還沒考過'}</span>
        <button type="button" class="secondary-btn exam-start" data-paper="${p.id}"${saved ? ' disabled' : ''} aria-label="開始${p.name}模擬考">開始</button>
      </li>`;
    }).join('');
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

  function showQuestion() {
    clearTimeout(autoNext);
    const q = current();
    const i = exam.index;
    const n = exam.ids.length;
    const subj = SUBJECT_BY_ID[q.subject];
    el.card.style.setProperty('--c', subj.color);
    el.subject.textContent = subj.name;
    // 學測不會告訴你考哪個單元：不顯示單元名稱，只標出多選題（試卷上單選、多選分開標）與題組
    const pos = groupPosition(
      exam.ids.map((id) => byId.get(id)),
      i,
    );
    const where = pos ? `題組 ${pos.k}／${pos.n}` : '';
    el.topic.innerHTML = [q.type === 'ms' ? '多選題' : '', where && `<span class="nowrap">${where}</span>`].filter(Boolean).join('・');
    showPassage(el.passage, q, where);
    el.text.innerHTML = stemHTML(q);
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

  function go(delta) {
    if (!exam) return;
    const to = exam.index + delta;
    if (to < 0) return;
    if (to >= exam.ids.length) return openIndex();
    exam.index = to;
    ctx.save();
    showQuestion();
    if (document.activeElement?.closest?.('#answers') || document.activeElement === document.body) el.answers.querySelector('.answer')?.focus({ preventScroll: true });
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
    const answered = exam.answers.filter((a) => a !== null).length;
    const marked = exam.marks.filter(Boolean).length;
    const blank = n - answered;
    $('#exam-index-sum').textContent =
      `已作答 ${answered}／${n} 題${marked ? `，標記 ${marked} 題` : ''}，還剩 ${clock(exam.limit - exam.elapsed)}。` +
      (blank ? `還有 ${blank} 題沒作答。` : '全部都作答了。') +
      '點題號可以跳過去。';
    $('#exam-grid').innerHTML = exam.ids
      .map((_, i) => {
        const done = exam.answers[i] !== null;
        const mark = exam.marks[i];
        const label = `第 ${i + 1} 題，${done ? '已作答' : '沒作答'}${mark ? '，標記' : ''}${i === exam.index ? '，目前這題' : ''}`;
        return `<li><button type="button" class="cell${done ? ' done' : ''}${mark ? ' marked' : ''}${i === exam.index ? ' current' : ''}" data-at="${i}" aria-label="${label}">${i + 1}</button></li>`;
      })
      .join('');
    $('#exam-submit').textContent = confirmSubmit ? `還有 ${blank} 題沒作答，確定交卷` : '交卷';
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
    const blank = exam.answers.filter((a) => a === null).length;
    // 還有沒作答的：按第二次才交卷
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

  // 鍵盤：1–4（多選題 1–5）選答案、←／→ 換題、M 標記、Esc 打開題號一覽
  document.addEventListener('keydown', (e) => {
    if (!exam || play.hidden || topSheet() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const order = exam.orders[exam.index];
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
    // 作答寫進排程與每日題數：答錯的進錯題複習；答對但標記過的算不太確定；沒作答的不記
    const now = Date.now();
    for (const it of result.items) {
      const outcome = examOutcome(it);
      if (!outcome) continue;
      ctx.state.cards[it.id] = schedule(ctx.state.cards[it.id], outcome, now);
      recordAnswer(ctx.state, outcome, now);
    }
    const prev = logExam(ctx.state, paper.id, result, now);
    ctx.state.exam = null;
    ctx.save();
    leave();
    showReport(paper, result, prev, timeUp);
    ctx.cloudSync?.();
    ctx.reminder?.sync();
  }

  function showReport(paper, result, prev, timeUp) {
    report = { paper, result };
    const { total, right, points, blank, secs, limit } = result;
    // 有多選題的卷照學測部分給分：大字是得分，不是答對題數
    const hasMs = result.items.some((it) => it.q.type === 'ms');
    $('#x-paper').textContent = `${paper.name}模擬考${timeUp ? '・時間到，自動交卷' : ''}`;
    $('#x-big').textContent = `${fmt(points)} / ${total}`;
    $('#x-acc').textContent = `${pct(points, total)}%`;
    $('#x-acc-label').textContent = hasMs ? '得分率' : '答對率';
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
    $('#x-review-title').textContent = misses.length
      ? `答錯、沒作答與標記過的題目（${misses.length} 題；答錯的已加入錯題複習）`
      : '全對！這份卷沒有錯題';
    const { flags, stars } = ctx.state;
    $('#x-list').innerHTML = misses.map((it, i) => reviewItem(it.q, { index: i, flagged: !!flags[it.id], starred: !!stars[it.id], note: mine(it) })).join('');
    const train = misses.filter((it) => !it.right);
    $('#x-train').textContent = train.length ? '練這份的錯題' : '再考一份';

    ctx.world.setCast(paper.subjects);
    ctx.show('exam-report');
    $('#exam-report .result-scroll').scrollTop = 0;
    sfx.finish();
    if (points / total >= 0.9) ctx.world.celebrate();
  }

  /** 成績單下面要再看一眼的題目：答錯（多選題沒全對）、沒作答，以及答對但標記過的 */
  const missed = () => report.result.items.filter((it) => !it.right || it.marked);

  function mine(it) {
    if (it.blank) return '<span class="r-mine skip">沒作答</span>';
    if (it.right) return '<span class="r-mine skip">答對了，但你標記了這題</span>';
    const note = it.q.type === 'ms' ? `<span class="r-mine skip">${msNote(it.q, it.answer)}</span>` : '';
    return `<span class="r-mine">${mineHTML(it.q, entryOf(it))}</span>${note}`;
  }

  /** 這題在成績單上的作答紀錄（回看、複製題目用；選項照當時的順序） */
  const entryOf = (it) => ({ outcome: it.blank ? 'blank' : it.right ? 'right' : 'wrong', chosen: it.answer, order: it.order });

  $('#x-slow').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-at]');
    if (!btn || !report) return;
    const list = report.result.items.map((it) => ({ q: it.q, entry: entryOf(it), n: it.n }));
    ctx.openPast(list, { start: Number(btn.dataset.at), backLabel: '回到成績單', timed: false, onClose: () => {} });
  });

  $('#x-list').addEventListener('click', (e) => {
    if (!report) return;
    const items = missed();
    if (openKeypointsFrom(ctx, e.target) || speakItem(e.target, items.map((it) => it.q))) return;
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
    const ids = report ? missed().filter((it) => !it.right).map((it) => it.id) : [];
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
