// 作答畫面：出題、點選／滑動作答、回饋、計時、收藏與回報題目
import { weakUnits } from '../analysis.js';
import { SUBJECT_BY_ID, SUBJECTS } from '../subjects.js';
import { buildQueue, schedule, shuffle } from '../srs.js';
import { MODES, advance, createSession, current, extend, isCorrect, markLast, submit, tick, multiplier } from '../session.js';
import { currentUnit, followUp, pathProgress, pathUnits, settleRuns } from '../path.js';
import { questionPrompt } from '../prompt.js';
import { relatedQuestions, relatedQueue } from '../related.js';
import { adjustRight, recordAnswer, today } from '../stats.js';
import { setFlag, setStar } from '../sync.js';
import { isUnitOff, topicLabel, unitKey } from '../units.js';
import { copyQuestion } from './clipboard.js';
import { icon } from './icons.js';
import { plainText, richHTML, visibleLength } from './rich.js';
import { sfx } from './feedback.js';
import { canSpeak, speak, speechText, stopSpeaking } from './speech.js';

/** 答對後多久自動換題：留一點時間給玩家按「猜對的」「不太確定」 */
const RIGHT_DELAY = 1400;
/** 自動換題的模式裡按了「猜對的／不太確定」，稍等一下讓按鈕狀態看得見再換題 */
const MARK_DELAY = 350;
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
    star: $('#star'),
    speak: $('#speak'),
    copy: $('#copy-q'),
    related: $('#related'),
    more: $('#card-more'),
    certain: $('#certain'),
    guess: $('#guess'),
    unsure: $('#unsure'),
  };
  const byId = new Map(ctx.bank.map((x) => [x.id, x]));

  let s = null;
  let q = null;
  let order = null; // 單選題：畫面上第 i 個按鈕 → 原始選項索引
  let pendingRelated = []; // 這題答錯後可以接著練的類似題
  let lastRight = null; // 剛答對的那題 { id, before, at }：標成猜的時，從答題前的紀錄重新排程
  let phase = 'idle'; // idle | answering | feedback
  let autoNext = 0;
  let raf = 0;
  let lastT = 0;

  /**
   * 依目前選的單元組一批題目。被回報的題目一律先不出。
   * @param {{ subjects?: string[], units?: string[] | null, exclude?: string[], allUnits?: boolean }} [opts]
   *   units：只出這些單元（弱點加強用）；exclude：這批先不出的題目 id；allUnits：不管首頁關掉的單元（錯題本用）
   */
  function queueFor(mode, { subjects = ctx.state.settings.subjects, units = null, exclude = [], allUnits = false } = {}) {
    const cfg = MODES[mode];
    return buildQueue(ctx.bank, ctx.state.cards, {
      subjects,
      excludedUnits: allUnits ? [] : ctx.state.settings.excludedUnits,
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

  /** 指定的題目（收藏、搜尋結果）：打亂後取一輪的量，被回報的不出 */
  function pickedQueue(mode, ids) {
    const qs = ids.map((id) => byId.get(id)).filter((x) => x && !ctx.state.flags[x.id]);
    return shuffle(qs).slice(0, MODES[mode].size);
  }

  /**
   * @param {string} mode
   * @param {{ units?: string[], seeds?: string[], subjects?: string[], ids?: string[] }} [opts]
   *   units：指定要練的單元（從學習分析點單元進來時）；seeds：錯題延伸要從哪幾題錯題找類似題；
   *   subjects：只出這幾科、而且不管首頁關掉的單元（從錯題本進來時）；ids：只出這幾題（收藏、搜尋結果）
   */
  ctx.startRound = (mode, opts = {}) => {
    if (mode === 'path') return startPath(opts);
    let units = opts.units ?? null;
    if (mode === 'weak' && !units) {
      const { subjects, excludedUnits } = ctx.state.settings;
      units = weakUnits(ctx.bank, ctx.state.cards, { subjects, excludedUnits }).map((u) => u.key);
      if (!units.length) {
        ctx.toast('作答紀錄還不夠，先多練幾輪就找得出弱點單元');
        return;
      }
    }
    let queue = opts.ids
      ? pickedQueue(mode, opts.ids)
      : mode === 'related'
        ? relatedQueue(ctx.bank, opts.seeds.map((id) => byId.get(id)).filter(Boolean), {
            size: MODES.related.size,
            exclude: avoidIds(Date.now()),
          })
        : queueFor(mode, opts.subjects ? { units, subjects: opts.subjects, allUnits: true } : { units });
    if (!queue.length && mode === 'formula') {
      queue = queueFor(mode, { subjects: SUBJECTS.map((x) => x.id) });
      if (queue.length) ctx.toast('選的科目沒有公式題，改出全部科目的公式題');
    }
    if (!queue.length) {
      ctx.toast(
        opts.ids
          ? '這些題目都回報過了，先不出'
          : mode === 'review'
            ? '目前沒有待練的錯題，太穩了！'
            : mode === 'related'
              ? '類似的題目剛剛都練過了，晚點再來'
              : '選到的單元沒有題目',
      );
      return;
    }
    // 「再來一輪」時沿用：指定的單元、錯題延伸的錯題（剛練過的類似題會自動避開）；從首頁進來的弱點加強則重新找
    begin(mode, queue, opts);
  };

  /**
   * 單元闖關：開始（或接著做）這科現在該闖的關。
   * @param {{ subject?: string, unit?: string }} opts unit：指定要闖（或重闖已過關）的單元，做到一半就接著做
   */
  function startPath({ subject = ctx.state.pathLast ?? ctx.state.settings.subjects[0] ?? SUBJECTS[0].id, unit } = {}) {
    const units = pathUnits(subject, ctx.state.settings.excludedUnits);
    const prog = pathProgress(ctx.state, subject);
    settleRuns(prog);
    const target = unit ?? currentUnit(units, prog);
    if (!target) {
      ctx.toast('這科全部過關了！可以挑一關重新挑戰');
      ctx.openPath?.(subject);
      return;
    }
    const run = prog.runs[target];
    let queue = run ? run.ids.map((id) => byId.get(id)).filter((x) => x && !ctx.state.flags[x.id]) : [];
    let index = run ? Math.min(run.index, queue.length) : 0;
    if (index >= queue.length) {
      queue = queueFor('path', { subjects: [subject], units: [unitKey(subject, target)] });
      index = 0;
    }
    if (!queue.length) {
      ctx.toast('這個單元沒有可以出的題目');
      return;
    }
    ctx.state.pathLast = subject;
    begin('path', queue, { subject, unit: target }, { index, extra: run && index ? run.extra : [], path: { subject, unit: target } });
    // 先存下這關的題目順序，中途離開也能接著做
    savePath(index);
    ctx.save();
  }

  /** 闖關：記下這關的題目順序與下一題的位置 */
  function savePath(nextIndex) {
    pathProgress(ctx.state, s.path.subject).runs[s.path.unit] = {
      ids: s.queue.map((x) => x.id),
      index: nextIndex,
      extra: [...s.extra],
    };
  }

  /** 闖關答錯（或看解答、標成猜的）：在這關最後補一題類似題；回傳補進來的題目 */
  function addFollowUp(missed) {
    const off = new Set(ctx.state.settings.excludedUnits);
    const avoid = Object.keys(ctx.state.flags);
    // 跨單元題結合了被關掉的單元時也不出
    if (missed.links) for (const x of ctx.bank) if (x.links && isUnitOff(x, off)) avoid.push(x.id);
    const pick = followUp(ctx.bank, missed, s.queue.map((x) => x.id), avoid);
    s.queue.push(pick);
    if (pick !== missed) s.extra.add(pick.id);
    return pick;
  }

  /**
   * @param {{ index?: number, extra?: string[], path?: { subject: string, unit: string } }} [resume]
   *   闖關接續上次：從第 index 題開始，extra 是之前補進來的類似題
   */
  function begin(mode, queue, opts, { index = 0, extra = [], path = null } = {}) {
    s = createSession(mode, queue);
    s.index = index;
    s.opts = opts;
    // 作答中按「練 3 題類似題」、闖關答錯補進來的題目
    s.extra = new Set(extra);
    s.path = path;
    // 闖關裡答對後標成猜的，補進來的題目：取消標記時要拿掉
    s.followUps = new Map();
    el.timer.hidden = s.timeLeft === null;
    el.score.textContent = '0';
    renderCombo();
    ctx.show('play');
    showQuestion();
    if (s.timeLeft !== null) {
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

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
    el.topic.innerHTML = s.extra.has(q.id) ? `${icon('loop')}${topicLabel(q)}・類似題` : topicLabel(q);
    el.text.innerHTML = richHTML(q.q);
    el.explain.hidden = true;
    el.next.hidden = true;
    el.related.hidden = true;
    el.certain.hidden = true;
    pendingRelated = [];
    lastRight = null;
    el.skip.hidden = false;
    const counted = s.timeLeft === null && !MODES[s.mode].endless;
    el.progress.textContent = counted ? `${s.index + 1} / ${s.queue.length}` : `第 ${s.index + 1} 題`;
    el.card.classList.toggle('swipeable', q.type === 'tf');
    renderMarks();
    stopSpeaking();
    el.speak.hidden = !canSpeak(q);
    resetCardDrag();
    restartAnimation(el.card, 'enter');
    renderAnswers();
    fitCard();
    ctx.scratch.newPage();
    ctx.world.setFocusSubject(q.subject);
    if (s.timeLeft !== null) renderTimer();
  }

  function renderAnswers() {
    el.answers.innerHTML = '';
    if (q.type === 'tf') {
      el.answers.className = 'answers tf';
      // 與滑動方向一致：左錯右對
      el.answers.append(answerButton(`${icon('ng')}錯`, false, '←', true), answerButton(`${icon('ok')}對`, true, '→', true));
      return;
    }
    order = shuffle([0, 1, 2, 3]);
    const short = q.choices.every((c) => visibleLength(c) <= 10);
    el.answers.className = `answers mc${short ? ' grid-2' : ''}`;
    order.forEach((orig, i) => el.answers.append(answerButton(richHTML(q.choices[orig]), i, String(i + 1), true)));
  }

  // ── 小螢幕：題目卡放不下 ─────────────────────────────
  // 先把題目字縮小一級；還是放不下就在卡片底部提示「往下還有」，免得沒看完題目就作答
  function overflowing() {
    return el.card.scrollHeight - el.card.clientHeight > 2;
  }

  function fitCard() {
    el.card.scrollTop = 0;
    el.text.classList.remove('compact');
    if (overflowing()) el.text.classList.add('compact');
    updateMore();
  }

  function updateMore() {
    el.more.hidden = el.card.scrollHeight - el.card.clientHeight - el.card.scrollTop <= 6;
  }

  el.card.addEventListener('scroll', updateMore, { passive: true });
  window.addEventListener('resize', () => {
    if (q && !$('#play').hidden) updateMore();
  });
  el.more.addEventListener('click', () => el.card.scrollBy({ top: el.card.clientHeight * 0.7, behavior: 'smooth' }));

  function answerButton(label, value, key, isHTML = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer';
    btn.innerHTML = `<span class="key" aria-hidden="true">${key}</span><span class="answer-text"></span>`;
    const text = btn.querySelector('.answer-text');
    if (isHTML) text.innerHTML = label;
    else text.textContent = label;
    // 有公式的選項改念 plainText 轉出來的文字，螢幕閱讀器才念得出來；
    // 不用 aria-label，名稱才會跟著按鈕內容走（axe 的 label-in-name 規則）
    if (text.querySelector('math')) {
      const said = document.createElement('span');
      said.className = 'sr-only';
      said.textContent = plainText(text);
      text.setAttribute('aria-hidden', 'true');
      btn.append(said);
    }
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
    const card = ctx.state.cards[q.id];
    ctx.state.cards[q.id] = schedule(card, outcome, now);
    lastRight = outcome === 'right' ? { id: q.id, before: card, at: now } : null;
    const before = today(ctx.state, now).answered;
    recordAnswer(ctx.state, outcome, now);
    const points = submit(s, outcome, chosen);
    if (s.path) {
      if (outcome !== 'right') addFollowUp(q);
      savePath(s.index + 1);
      el.progress.textContent = `${s.index + 1} / ${s.queue.length}`;
    }
    ctx.save();

    const goal = ctx.state.settings.goal;
    if (before < goal && today(ctx.state, now).answered >= goal) ctx.toast(`今日 ${goal} 題目標達成！`);

    const correctValue = q.type === 'mc' ? order.indexOf(q.answer) : q.answer;
    // 除了紅綠底色，再像老師批改一樣蓋上圈叉：分不出紅綠的人也看得出對錯
    for (const b of el.answers.children) {
      b.disabled = true;
      if (b._value === correctValue) {
        b.classList.add('correct');
        b.insertAdjacentHTML('beforeend', icon('ok', 'mark'));
      } else if (b._value === displayValue) {
        b.classList.add('wrong');
        b.insertAdjacentHTML('beforeend', icon('ng', 'mark'));
      } else b.classList.add('dim');
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
      showCertainty();
      if (!MODES[s.mode].explainAlways) {
        el.skip.hidden = true;
        el.next.hidden = false;
        autoNext = setTimeout(next, RIGHT_DELAY);
        return;
      }
    } else if (outcome === 'wrong') {
      ctx.world.shake();
      sfx.wrong();
      restartAnimation(el.flash, 'on');
      restartAnimation(el.card, 'shake');
    }
    el.explain.innerHTML = `<b>${icon('bulb')}${outcome === 'skip' ? '解答' : '解析'}</b>${richHTML(q.explain)}`;
    if (s.path && outcome !== 'right') el.explain.insertAdjacentHTML('beforeend', `<span class="path-note">${icon('loop')}這關最後補了一題類似題</span>`);
    el.explain.hidden = false;
    // 小螢幕上題目長時，解析可能在卡片可視範圍外
    el.explain.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateMore();
    el.skip.hidden = true;
    // 答錯或不會：可以馬上再練幾題同單元的類似題（快閃模式在計時，不打斷）
    offerRelated(outcome !== 'right');
    el.next.hidden = false;
    el.next.focus({ preventScroll: true });
  }

  /** 答錯、看解答或標成猜的之後，提供「練 3 題類似題」；快閃在計時、闖關會自動補題，都不另外提供 */
  function offerRelated(on) {
    pendingRelated =
      on && s.timeLeft === null && !s.path ? relatedQuestions(ctx.bank, q, { count: RELATED_COUNT, exclude: avoidIds(Date.now()) }) : [];
    el.related.hidden = !pendingRelated.length;
    el.related.innerHTML = `${icon('loop')}練<span class="related-n"> ${pendingRelated.length} 題</span>類似題`;
  }

  // ── 答對後：其實是猜的、不太確定 ─────────────────────────
  function showCertainty() {
    el.certain.hidden = false;
    renderCertainty();
  }

  function renderCertainty() {
    const mark = s.log[s.log.length - 1]?.mark;
    el.guess.setAttribute('aria-pressed', String(mark === 'guess'));
    el.unsure.setAttribute('aria-pressed', String(mark === 'unsure'));
    // 標了其中一個就收起另一個，騰出位置給「練類似題」；再按一次取消
    el.certain.classList.toggle('marked', !!mark);
  }

  /**
   * 剛答對的題目標成「猜的」或「不太確定」；再按一次同一個就取消。
   * 排程從答題前的紀錄重算，當天的答對數扣回來；闖關裡還會在這關最後補一題類似題。
   */
  function setCertainty(kind) {
    if (phase !== 'feedback' || !lastRight) return;
    const was = s.log[s.log.length - 1].mark ?? null;
    const mark = was === kind ? null : kind;
    const now = Date.now();
    ctx.state.cards[lastRight.id] = schedule(lastRight.before, mark ?? 'right', now);
    if (!was && mark) adjustRight(ctx.state, -1, lastRight.at);
    if (was && !mark) adjustRight(ctx.state, 1, lastRight.at);
    markLast(s, mark);
    if (s.path) {
      if (mark && !was) s.followUps.set(q.id, addFollowUp(q));
      if (!mark && was) {
        // 補進來的題還沒做到就拿掉
        const added = s.followUps.get(q.id);
        const at = s.queue.lastIndexOf(added);
        if (at > s.index) s.queue.splice(at, 1);
        s.extra.delete(added?.id);
        s.followUps.delete(q.id);
      }
      savePath(s.index + 1);
      el.progress.textContent = `${s.index + 1} / ${s.queue.length}`;
    }
    ctx.save();
    renderCertainty();
    if (MODES[s.mode].explainAlways) {
      offerRelated(!!mark);
      return;
    }
    // 自動換題的模式：標好就換下一題；取消標記則照原本的節奏
    clearTimeout(autoNext);
    autoNext = setTimeout(next, mark ? MARK_DELAY : RIGHT_DELAY);
  }

  el.guess.addEventListener('click', () => setCertainty('guess'));
  el.unsure.addEventListener('click', () => setCertainty('unsure'));

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

  // ── 收藏、回報題目 ─────────────────────────────────────
  function renderMarks() {
    el.flag.setAttribute('aria-pressed', String(!!ctx.state.flags[q.id]));
    el.star.setAttribute('aria-pressed', String(!!ctx.state.stars[q.id]));
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
    renderMarks();
    ctx.toast(flags[q.id] ? '已回報這題，之後先不出；清單在首頁的設定裡' : '已取消回報');
  });

  // 英文題：作答前念題目（空格停頓），作答後念填好正解的句子
  el.speak.addEventListener('click', () => {
    if (q) speak(speechText(q, { filled: phase === 'feedback' }));
  });

  el.star.addEventListener('click', () => {
    if (!q) return;
    const { stars } = ctx.state;
    setStar(ctx.state, q.id, !stars[q.id], Date.now());
    ctx.save();
    renderMarks();
    ctx.toast(stars[q.id] ? '已收藏，在錯題本的「收藏」找得到' : '已取消收藏');
  });

  function finish() {
    stopSpeaking();
    cancelAnimationFrame(raf);
    clearTimeout(autoNext);
    phase = 'idle';
    ctx.world.setFocusSubject(null);
    if (s.path) {
      // 這關的題目都答完（最後補的類似題也答對了）就過關，結算畫面接著帶到下一關；沒做完就接著做這關
      const { subject, unit } = s.path;
      const prog = pathProgress(ctx.state, subject);
      settleRuns(prog);
      const run = prog.runs[unit];
      s.path.done = !run;
      s.path.left = run ? run.ids.length - run.index : 0;
      s.path.next = currentUnit(pathUnits(subject, ctx.state.settings.excludedUnits), prog);
      s.opts = run ? { subject, unit } : { subject };
      ctx.save();
    }
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
      stopSpeaking();
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
    // 卡片上的按鈕（複製、回報）不能被滑動手勢搶走指標，否則點不到
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
    if (phase === 'feedback' && lastRight && (e.key === 'g' || e.key === 'u')) return setCertainty(e.key === 'g' ? 'guess' : 'unsure');
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
