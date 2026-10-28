// 作答畫面：出題、點選／滑動作答、回饋、計時
import { SUBJECT_BY_ID, SUBJECTS } from '../subjects.js';
import { buildQueue, schedule, shuffle } from '../srs.js';
import { MODES, advance, createSession, current, isCorrect, submit, tick, multiplier } from '../session.js';
import { recordAnswer, today } from '../stats.js';
import { richHTML, visibleLength } from './rich.js';
import { sfx } from './feedback.js';

const RIGHT_DELAY = 650;
const SWIPE_THRESHOLD = 80;

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
  };

  let s = null;
  let q = null;
  let order = null; // 單選題：畫面上第 i 個按鈕 → 原始選項索引
  let phase = 'idle'; // idle | answering | feedback
  let autoNext = 0;
  let raf = 0;
  let lastT = 0;

  ctx.startRound = (mode) => {
    const cfg = MODES[mode];
    const opts = { formulaOnly: cfg.formulaOnly, weakOnly: cfg.weakOnly, size: cfg.size, now: Date.now() };
    let queue = buildQueue(ctx.bank, ctx.state.cards, { ...opts, subjects: ctx.state.settings.subjects });
    if (!queue.length && mode === 'formula') {
      queue = buildQueue(ctx.bank, ctx.state.cards, { ...opts, subjects: SUBJECTS.map((x) => x.id) });
      if (queue.length) ctx.toast('選的科目沒有公式題，改出全部科目的公式題');
    }
    if (!queue.length) {
      ctx.toast(mode === 'review' ? '目前沒有待練的錯題，太穩了 🎉' : '這些科目還沒有題目');
      return;
    }
    s = createSession(mode, queue);
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
    el.topic.textContent = q.topic;
    el.text.innerHTML = richHTML(q.q);
    el.explain.hidden = true;
    el.next.hidden = true;
    el.skip.hidden = false;
    el.progress.textContent = s.timeLeft === null ? `${s.index + 1} / ${s.queue.length}` : `第 ${s.index + 1} 題`;
    el.card.classList.toggle('swipeable', q.type === 'tf');
    resetCardDrag();
    restartAnimation(el.card, 'enter');
    renderAnswers();
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
    if (outcome === 'right') {
      const rect = buttonFor(correctValue).getBoundingClientRect();
      ctx.world.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 30 + Math.min(s.combo, 10) * 4);
      ctx.world.pulse();
      sfx.right(s.combo);
      showPop(`+${points}`);
      el.skip.hidden = true;
      autoNext = setTimeout(next, RIGHT_DELAY);
      return;
    }

    if (outcome === 'wrong') {
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
    el.next.hidden = false;
    el.next.focus({ preventScroll: true });
  }

  function next() {
    clearTimeout(autoNext);
    if (phase !== 'feedback') return;
    if (!advance(s)) return finish();
    showQuestion();
  }

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
    if (phase !== 'answering' || q.type !== 'tf') return;
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
      // 答對就讓卡片順勢飛出；答錯拉回中間看解析
      const dir = Math.sign(dx);
      el.card.style.transform = outcome === 'right' ? `translateX(${dir * 120}%) rotate(${dir * 16}deg)` : '';
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
