// 作答畫面：出題、點選／滑動作答、回饋、計時、回報題目
import { weakUnits } from '../analysis.js';
import { SUBJECT_BY_ID, SUBJECTS } from '../subjects.js';
import { buildQueue, schedule, shuffle } from '../srs.js';
import { MODES, advance, createSession, current, extend, isCorrect, submit, tick, multiplier } from '../session.js';
import { questionPrompt } from '../prompt.js';
import { relatedQuestions, relatedQueue } from '../related.js';
import { recordAnswer, today } from '../stats.js';
import { setFlag } from '../sync.js';
import { copyQuestion } from './clipboard.js';
import { richHTML, visibleLength } from './rich.js';
import { sfx } from './feedback.js';

const RIGHT_DELAY = 650;
const SWIPE_THRESHOLD = 80;
/** 自由練習補題時，最近答過的幾題先不出 */
const RECENT = 8;
/** 找類似題時，這段時間內答過的題目先不出 */
const RECENT_MS = 30 * 60_000;
/** 答錯後「練類似題」一次插入幾題 */
const RELATED_COUNT = 3;

export function initPlay(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const el = {
    card: $('#card'),
    subject: $('#q-subject'),
    topic: $('#q-topic'),
    text: $('#q-text'),
    explain: $('#q-explain'),
    answers: $('#answers'),
    skip: $('#skip'),
    next: $('#next'),
    progress: $('#play-progress'),
    combo: $('#combo'),
    score: $('#score'),
    pop: $('#score-pop'),
    timer: $('#timer'),
    timerFill: $('#timer-fill'),
    flash: $('#flash'),
    flag: $('#flag'),
    copy: $('#copy-q'),
    related: $('#related'),
  };
  const byId = new Map(ctx.bank.map((x) => [x.id, x]));

  let s = null;
  let q = null;
  let order = null; // 單選題：畫面上第 i 個按鈕 → 原始選項索引
  let pendingRelated = []; // 這題答錯後可以接著練的類似題
  let phase = 'idle'; // idle | answering | feedback
  let autoNext = 0;
  let raf = 0;
  let lastT = 0;

  /**
   * 依目前選的單元組一批題目。被回報的題目一律先不出。
   * @param {{ subjects?: string[], units?: string[] | null, exclude?: string[] }} [opts]
   *   units：只出這些單元（弱點加強用）；exclude：這批先不出的題目 id
   */
  function queueFor(mode, { subjects = ctx.state.settings.subjects, units = null, exclude = [] } = {}) {
    const cfg = MODES[mode];
    return buildQueue(ctx.bank, ctx.state.cards, {
      subjects,
      excludedUnits: ctx.state.settings.excludedUnits,
      onlyUnits: units,
      exclude: [...exclude, ...Object.keys(ctx.state.flags)],
      formulaOnly: cfg.formulaOnly,
      weakOnly: cfg.weakOnly,
      size: cfg.size,
      now: Date.now(),
    });
  }

  /** 不出的題目：被回報的，以及剛答過的（找類似題時才不會又抽到剛做完的） */
  function avoidIds(now) {
    const ids = Object.keys(ctx.state.flags);
    for (const [id, c] of Object.entries(ctx.state.cards)) if (c.last > now - RECENT_MS) ids.push(id);
    return ids;
  }

  /**
   * @param {string} mode
   * @param {{ units?: string[], seeds?: string[] }} [opts]
   *   units：指定要練的單元（從學習分析點單元進來時）；seeds：錯題延伸要從哪幾題錯題找類似題
   */
  ctx.startRound = (mode, opts = {}) => {
    let units = opts.units ?? null;
    if (mode === 'weak' && !units) {
      const { subjects, excludedUnits } = ctx.state.settings;
      units = weakUnits(ctx.bank, ctx.state.cards, { subjects, excludedUnits }).map((u) => u.key);
      if (!units.length) {
        ctx.toast('作答紀錄還不夠，先多練幾輪就找得出弱點單元');
        return;
      }
    }
    let queue =
      mode === 'related'
        ? relatedQueue(ctx.bank, opts.seeds.map((id) => byId.get(id)).filter(Boolean), {
            size: MODES.related.size,
            exclude: avoidIds(Date.now()),
          })
        : queueFor(mode, { units });
    if (!queue.length && mode === 'formula') {
      queue = queueFor(mode, { subjects: SUBJECTS.map((x) => x.id) });
      if (queue.length) ctx.toast('選的科目沒有公式題，改出全部科目的公式題');
    }
    if (!queue.length) {
      ctx.toast(
        mode === 'review' ? '目前沒有待練的錯題，太穩了 🎉' : mode === 'related' ? '類似的題目剛剛都練過了，晚點再來' : '選到的單元沒有題目',
      );
      return;
    }
    s = createSession(mode, queue);
    // 「再來一輪」時沿用：指定的單元、錯題延伸的錯題（剛練過的類似題會自動避開）；從首頁進來的弱點加強則重新找
    s.opts = opts;
    // 作答中按「練 3 題類似題」插進來的題目
    s.extra = new Set();
    el.timer.hidden = s.timeLeft === null;
    el.score.textContent = '0';
    renderCombo();
    ctx.show('play');
    showQuestion();
    if (s.timeLeft !== null) {
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };

  function loop(t) {
    const dt = (t - lastT) / 1000;
    lastT = t;
    // 看解答、動畫期間與切到背景時不扣時間；上限 1 秒是為了切回前景的第一幀，卡頓的手機仍照實扣時
    if (phase === 'answering' && !document.hidden) {
      tick(s, Math.min(dt, 1));
      renderTimer();
      if (s.timeLeft <= 0) return finish();
    }
    raf = requestAnimationFrame(loop);
  }

  function renderTimer() {
    const ratio = s.timeLeft / MODES[s.mode].timeLimit;
    el.timerFill.style.transform = `scaleX(${ratio})`;
    el.timer.classList.toggle('low', s.timeLeft <= 10);
  }

  function showQuestion() {
    q = current(s);
    phase = 'answering';
    const subj = SUBJECT_BY_ID[q.subject];
    el.card.style.setProperty('--c', subj.color);
    el.subject.textContent = subj.name;
    el.topic.textContent = s.extra.has(q.id) ? `🔁 ${q.topic}・類似題` : q.topic;
    el.text.innerHTML = richHTML(q.q);
    el.explain.hidden = true;
    el.next.hidden = true;
    el.related.hidden = true;
    pendingRelated = [];
    el.skip.hidden = false;
    const counted = s.timeLeft === null && !MODES[s.mode].endless;
    el.progress.textContent = counted ? `${s.index + 1} / ${s.queue.length}` : `第 ${s.index + 1} 題`;
    el.card.classList.toggle('swipeable', q.type === 'tf');
    renderFlag();
    resetCardDrag();
    restartAnimation(el.card, 'enter');
    renderAnswers();
    ctx.scratch.newPage();
    ctx.world.setFocusSubject(q.subject);
    if (s.timeLeft !== null) renderTimer();
  }

  function renderAnswers() {
    el.answers.innerHTML = '';
    if (q.type === 'tf') {
      el.answers.className = 'answers tf';
      // 與滑動方向一致：左錯右對
      el.answers.append(answerButton('❌ 錯', false, '←'), answerButton('⭕ 對', true, '→'));
      return;
    }
    order = shuffle([0, 1, 2, 3]);
    const short = q.choices.every((c) => visibleLength(c) <= 10);
    el.answers.className = `answers mc${short ? ' grid-2' : ''}`;
    order.forEach((orig, i) => el.answers.append(answerButton(richHTML(q.choices[orig]), i, String(i + 1), true)));
  }

  function answerButton(label, value, key, isHTML = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer';
    btn.innerHTML = `<span class="key" aria-hidden="true">${key}</span><span class="answer-text"></span>`;
    const text = btn.querySelector('.answer-text');
    if (isHTML) text.innerHTML = label;
    else text.textContent = label;
    btn.addEventListener('click', () => choose(value));
    btn._value = value;
    return btn;
  }

  function buttonFor(value) {
    return [...el.answers.children].find((b) => b._value === value);
  }

  function choose(value) {
    if (phase !== 'answering') return null;
    const chosen = q.type === 'mc' ? order[value] : value;
    const outcome = isCorrect(q, chosen) ? 'right' : 'wrong';
    resolve(outcome, value, chosen);
    return outcome;
  }

  /** @param {'right'|'wrong'|'skip'} outcome  @param displayValue 被點的按鈕值（skip 為 null） */
  function resolve(outcome, displayValue, chosen) {
    phase = 'feedback';
    const now = Date.now();
    ctx.state.cards[q.id] = schedule(ctx.state.cards[q.id], outcome, now);
    const before = today(ctx.state, now).answered;
    recordAnswer(ctx.state, outcome, now);
    const points = submit(s, outcome, chosen);
    ctx.save();

    const goal = ctx.state.settings.goal;
    if (before < goal && today(ctx.state, now).answered >= goal) ctx.toast(`🎯 今日 ${goal} 題目標達成！`);

    const correctValue = q.type === 'mc' ? order.indexOf(q.answer) : q.answer;
    for (const b of el.answers.children) {
      b.disabled = true;
      if (b._value === correctValue) b.classList.add('correct');
      else if (b._value === displayValue) b.classList.add('wrong');
      else b.classList.add('dim');
    }
    el.score.textContent = s.score;
    renderCombo();
    ctx.world.setCombo(s.combo);

    const color = SUBJECT_BY_ID[q.subject].color;
    ctx.world.react(outcome);
    ctx.scratch.answered();
    if (outcome === 'right') {
      const rect = buttonFor(correctValue).getBoundingClientRect();
      ctx.world.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 30 + Math.min(s.combo, 10) * 4);
      sfx.right(s.combo);
      showPop(`+${points}`);
      if (!MODES[s.mode].explainAlways) {
        el.skip.hidden = true;
        autoNext = setTimeout(next, RIGHT_DELAY);
        return;
      }
    } else if (outcome === 'wrong') {
      ctx.world.shake();
      sfx.wrong();
      restartAnimation(el.flash, 'on');
      restartAnimation(el.card, 'shake');
    }
    el.explain.innerHTML = `<b>💡 ${outcome === 'skip' ? '解答' : '解析'}</b>${richHTML(q.explain)}`;
    el.explain.hidden = false;
    // 小螢幕上題目長時，解析可能在卡片可視範圍外
    el.explain.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.skip.hidden = true;
    // 答錯或不會：可以馬上再練幾題同單元的類似題（快閃模式在計時，不打斷）
    pendingRelated =
      outcome === 'right' || s.timeLeft !== null
        ? []
        : relatedQuestions(ctx.bank, q, { count: RELATED_COUNT, exclude: avoidIds(now) });
    el.related.hidden = !pendingRelated.length;
    el.related.textContent = `🔁 練 ${pendingRelated.length} 題類似題`;
    el.next.hidden = false;
    el.next.focus({ preventScroll: true });
  }

  el.related.addEventListener('click', () => {
    if (phase !== 'feedback' || !pendingRelated.length) return;
    const ids = new Set(pendingRelated.map((x) => x.id));
    // 已經排在後面的就提前，不重複出
    const rest = s.queue.slice(s.index + 1).filter((x) => !ids.has(x.id));
    s.queue.splice(s.index + 1, Infinity, ...pendingRelated, ...rest);
    for (const id of ids) s.extra.add(id);
    pendingRelated = [];
    next();
  });

  function next() {
    clearTimeout(autoNext);
    if (phase !== 'feedback') return;
    if (MODES[s.mode].endless && s.index + 1 >= s.queue.length) refill();
    if (!advance(s)) return finish();
    showQuestion();
  }

  /** 自由練習：出完一批就再組一批；剛答過的先不出，題目太少時才允許重複 */
  function refill() {
    const more = queueFor(s.mode, { exclude: s.log.slice(-RECENT).map((e) => e.id) });
    extend(s, more.length ? more : queueFor(s.mode));
  }

  // ── 回報題目 ─────────────────────────────────────────
  function renderFlag() {
    el.flag.setAttribute('aria-pressed', String(!!ctx.state.flags[q.id]));
  }

  // ── 複製題目給 AI 家教 ────────────────────────────────
  el.copy.addEventListener('click', () => {
    if (!q) return;
    // 作答後附上自己的答案、正解與解析；作答前只給題目，請它教怎麼解
    const entry = phase === 'feedback' ? s.log[s.log.length - 1] : null;
    copyQuestion(questionPrompt(q, { order: q.type === 'mc' ? order : undefined, ...entry }), ctx.toast);
  });

  el.flag.addEventListener('click', () => {
    if (!q) return;
    const { flags } = ctx.state;
    setFlag(ctx.state, q.id, !flags[q.id], Date.now());
    ctx.save();
    renderFlag();
    ctx.toast(flags[q.id] ? '已回報這題，之後先不出；清單在首頁 ⚙️ 設定裡' : '已取消回報');
  });

  function finish() {
    cancelAnimationFrame(raf);
    clearTimeout(autoNext);
    phase = 'idle';
    ctx.world.setFocusSubject(null);
    ctx.showResult(s);
  }

  function renderCombo() {
    const on = s.combo >= 3;
    el.combo.hidden = !on;
    if (on) {
      el.combo.textContent = `${s.combo} 連擊 ×${multiplier(s.combo)}`;
      restartAnimation(el.combo, 'bump');
    }
  }

  function showPop(text) {
    el.pop.textContent = text;
    restartAnimation(el.pop, 'show');
  }

  el.next.addEventListener('click', next);
  el.skip.addEventListener('click', () => {
    if (phase === 'answering') resolve('skip', null, null);
  });
  $('#quit').addEventListener('click', () => {
    if (!s) return;
    if (s.log.length) finish();
    else {
      cancelAnimationFrame(raf);
      clearTimeout(autoNext);
      phase = 'idle';
      ctx.world.setFocusSubject(null);
      ctx.goHome();
    }
  });

  // ── 是非題：卡片左右滑 ────────────────────────────────
  let drag = null;
  el.card.addEventListener('pointerdown', (e) => {
    // 卡片上的按鈕（🚩）不能被滑動手勢搶走指標，否則點不到
    if (phase !== 'answering' || q.type !== 'tf' || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, dx: 0, active: false };
    el.card.setPointerCapture(e.pointerId);
  });
  el.card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    // 主要是垂直移動時當作捲動，不算滑動作答
    if (!drag.active && Math.abs(drag.dx) > 8 && Math.abs(drag.dx) > Math.abs(e.clientY - drag.y)) drag.active = true;
    if (!drag.active) return;
    el.card.classList.add('dragging');
    el.card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 22}deg)`;
    el.card.style.setProperty('--yes', String(Math.max(0, Math.min(1, drag.dx / SWIPE_THRESHOLD))));
    el.card.style.setProperty('--no', String(Math.max(0, Math.min(1, -drag.dx / SWIPE_THRESHOLD))));
  });
  const endDrag = () => {
    if (!drag) return;
    const { dx, active } = drag;
    drag = null;
    if (active && Math.abs(dx) >= SWIPE_THRESHOLD && phase === 'answering') {
      const outcome = choose(dx > 0);
      el.card.classList.remove('dragging');
      // 答對且馬上換題就讓卡片順勢飛出；要看解析的拉回中間
      const dir = Math.sign(dx);
      const flyOut = outcome === 'right' && !MODES[s.mode].explainAlways;
      el.card.style.transform = flyOut ? `translateX(${dir * 120}%) rotate(${dir * 16}deg)` : '';
    } else resetCardDrag();
  };
  el.card.addEventListener('pointerup', endDrag);
  el.card.addEventListener('pointercancel', endDrag);

  function resetCardDrag() {
    el.card.classList.remove('dragging');
    el.card.style.transform = '';
    el.card.style.setProperty('--yes', '0');
    el.card.style.setProperty('--no', '0');
  }

  // ── 鍵盤（桌機） ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('#play').hidden || !s) return;
    if (e.key === 'Escape') return $('#quit').click();
    if (phase === 'feedback' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return next();
    }
    if (phase !== 'answering') return;
    if (q.type === 'mc' && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
    else if (q.type === 'tf' && e.key === 'ArrowLeft') choose(false);
    else if (q.type === 'tf' && e.key === 'ArrowRight') choose(true);
    else if (e.key === '?' || e.key === '0') el.skip.click();
  });
}

function restartAnimation(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
