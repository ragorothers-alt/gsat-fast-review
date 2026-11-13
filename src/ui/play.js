// 作答畫面：出題、點選／滑動作答、回饋、計時、收藏與回報題目
import { conceptTodo, weakUnits } from '../analysis.js';
import { SUBJECT_BY_ID, SUBJECTS } from '../subjects.js';
import { buildQueue, examStart, isLeech, missCount, needsConfirm, neverMissed, schedule, shuffle } from '../srs.js';
import { recordPace } from '../pace.js';
import { reportQuestion } from '../report.js';
import { MODES, advance, createSession, current, extend, isCorrect, markLast, msNote, openNote, quickOnlyFor, submit, tick, multiplier } from '../session.js';
import { fillUnit, fillable, matchTyped, parseTyped } from '../numeric.js';
import { currentUnit, followUp, markCleared, pathProgress, pathUnits, resumeRun, settleRuns } from '../path.js';
import { bundles, isBank, takeBundles, usedOptions } from '../groups.js';
import { questionPrompt } from '../prompt.js';
import { relatedQuestions, relatedQueue } from '../related.js';
import { adjustRight, recordAnswer, today } from '../stats.js';
import { setFlag, setStar } from '../sync.js';
import { isUnitOff, topicLabel, unitKey } from '../units.js';
import { copyQuestion } from './clipboard.js';
import { openKeypointsFrom } from './keypoints.js';
import { lvTag, openRefHTML } from './review-item.js';
import { conceptOf, loadConcepts } from '../data/concepts.js';
import { icon } from './icons.js';
import { plainText, richHTML, stemHTML } from './rich.js';
import { sfx } from './feedback.js';
import { choicesClass, groupPosition, initReadFull, markUsed, showPassage } from './passage.js';
import { answerButton as createAnswerButton, markChoices, markMultiChoices, markOpenPoints } from './play-answers.js';
import { initCardFit, initCardSwipe, topicHTML } from './play-card.js';
import { fillHTML, fillKeyFor, typeFillKey } from './play-fill.js';
import { canSpeak, speak, speechText, stopSpeaking } from './speech.js';
import { topSheet } from './sheet.js';

/** 答對後多久自動換題：留一點時間給玩家按「猜對的」「不太確定」 */
const RIGHT_DELAY = 1400;
/** 自動換題的模式裡按了「猜對的／不太確定」，稍等一下讓按鈕狀態看得見再換題 */
const MARK_DELAY = 350;
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
    passage: $('#q-passage'),
    explain: $('#q-explain'),
    answers: $('#answers'),
    back: $('#back'),
    skip: $('#skip'),
    msSend: $('#ms-send'),
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
    status: $('#answer-status'),
  };
  const byId = ctx.byId;
  // 非選擇題借用多選題的送出按鈕、把字換成「送出自評」，多選題要換回來
  const sendLabel = el.msSend.textContent;
  initReadFull();
  // 最近是用鍵盤操作（不是點螢幕）：換題後把焦點放回選項上，不會掉回頁首
  let keyboard = false;
  window.addEventListener('keydown', (e) => (keyboard ||= e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || /^[1-9]$|^Arrow/.test(e.key)), true);
  window.addEventListener('pointerdown', () => (keyboard = false), true);

  let s = null;
  let q = null;
  let rounds = 0; // 開過幾輪：草稿區每輪每題一頁（見 ui/scratch.js）
  let order = null; // 單選、多選題：畫面上第 i 個按鈕 → 原始選項索引
  let picked = new Set(); // 多選題：目前選了畫面上的哪幾個；非選擇題：自評勾了哪幾個要點
  let revealed = false; // 非選擇題：已經看了參考答案（看了才能自評）
  let fill = null; // 演算題填答中：{ text } 是目前填的字；改看選項或作答後為 null
  let useChoices = false; // 這題已經改用選項作答
  let pendingRelated = []; // 這題答錯後可以接著練的類似題
  let lastRight = null; // 剛答對的那題 { id, before, at }：標成猜的時，從答題前的紀錄重新排程
  let phase = 'idle'; // idle | answering | feedback
  let looking = false; // 正在回看剛剛的題目：暫停計時、不能作答
  // 這題花了多久（作答速度，見 pace.js）：切到背景或回看上一題的時間不算
  let shownAt = 0;
  let pausedMs = 0;
  let pauseStart = 0;
  const pauseClock = () => {
    if (!pauseStart) pauseStart = Date.now();
  };
  const resumeClock = () => {
    if (!pauseStart || document.hidden || looking) return;
    pausedMs += Date.now() - pauseStart;
    pauseStart = 0;
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? pauseClock() : resumeClock()));
  let autoNext = 0;
  let raf = 0;
  let lastT = 0;

  /**
   * 依目前選的單元組一批題目。被回報的題目一律先不出。
   * @param {{ subjects?: string[], units?: string[] | null, exclude?: string[], allUnits?: boolean, streak?: number }} [opts]
   *   units：只出這些單元（弱點加強用）；exclude：這批先不出的題目 id；allUnits：不管首頁關掉的單元（錯題本用）
   *   streak：剛連續做了幾題複習（補下一批時接著算，見 buildQueue）
   */
  function queueFor(mode, { subjects = ctx.state.settings.subjects, units = null, exclude = [], allUnits = false, streak = 0 } = {}) {
    const cfg = MODES[mode];
    const build = (quickOnly) =>
      buildQueue(ctx.bank, ctx.state.cards, {
        subjects,
        excludedUnits: allUnits ? [] : ctx.state.settings.excludedUnits,
        onlyUnits: units,
        exclude: [...exclude, ...Object.keys(ctx.state.flags)],
        formulaOnly: cfg.formulaOnly,
        quickOnly,
        weakOnly: cfg.weakOnly,
        streak,
        newEvery: cfg.newEvery,
        examAt: examStart(ctx.state.settings.examDate),
        size: cfg.size,
        now: Date.now(),
      });
    // 設定開了「只出單題」，或還在新手期（作答紀錄不到 20 題）：只出單題
    const quick = quickOnlyFor(mode, { quickOnly: ctx.state.settings.quickOnly, answered: Object.keys(ctx.state.cards).length });
    const queue = build(quick);
    // 選的範圍剛好沒有單題可出（例如待練的錯題都是題組）：照一般方式出，不要變成「沒有題目」。快閃本來就只出單題，不放寬
    return queue.length || !quick || cfg.quickOnly ? queue : build(false);
  }

  /** 不出的題目：被回報的、答對過從沒失手的，以及剛答過的（找類似題時才不會又抽到剛做完的） */
  function avoidIds(now) {
    const ids = Object.keys(ctx.state.flags);
    for (const [id, c] of Object.entries(ctx.state.cards)) if (c.last > now - RECENT_MS || neverMissed(c)) ids.push(id);
    return ids;
  }

  /** 指定的題目（收藏、搜尋結果）：打亂後取一輪的量，被回報的不出；同一個閱讀題組的排在一起 */
  function pickedQueue(mode, ids) {
    const qs = ids.map((id) => byId.get(id)).filter((x) => x && !ctx.state.flags[x.id]);
    return takeBundles(bundles(shuffle(qs)), MODES[mode].size);
  }

  /** 「練這個考點」：錯題本裡的先出、再出沒做過的（conceptTodo）；同一個閱讀題組的排在一起 */
  function conceptQueue(key) {
    const list = conceptTodo(ctx.bank, ctx.state.cards, key, { flags: ctx.state.flags, excludedUnits: ctx.state.settings.excludedUnits });
    return takeBundles(bundles(list), MODES.concept.size);
  }

  /**
   * @param {string} mode
   * @param {{ units?: string[], seeds?: string[], subjects?: string[], ids?: string[], concept?: string }} [opts]
   *   units：指定要練的單元（從學習分析點單元進來時）；seeds：錯題延伸要從哪幾題錯題找類似題；
   *   subjects：只出這幾科、而且不管首頁關掉的單元（從錯題本進來時）；ids：只出這幾題（收藏、搜尋結果）；
   *   concept：只練這個考點（「科目/考點代號」，從重點卡或學習分析的弱點考點進來時）
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
    let queue;
    if (opts.ids) queue = pickedQueue(mode, opts.ids);
    else if (mode === 'concept') queue = conceptQueue(opts.concept);
    else if (mode === 'related') {
      queue = relatedQueue(ctx.bank, opts.seeds.map((id) => byId.get(id)).filter(Boolean), {
        size: MODES.related.size,
        exclude: avoidIds(Date.now()),
      });
    } else queue = queueFor(mode, opts.subjects ? { units, subjects: opts.subjects, allUnits: true } : { units });
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
              ? '類似的題目剛剛練過或答對過了'
              : mode === 'concept'
                ? '這個考點的題目都答對過了'
                : '選到的單元沒有可以出的題目（答對過的不再出）',
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
    // 首頁沒選的科目在背景補載中：等它載好再開始
    if (ctx.bankLoading() && !ctx.bank.some((x) => x.subject === subject)) return ctx.afterBank(() => startPath({ subject, unit }));
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
    const resumed = run ? resumeRun(run, (id) => byId.has(id) && !ctx.state.flags[id]) : { ids: [], index: 0 };
    let queue = resumed.ids.map((id) => byId.get(id));
    let index = resumed.index;
    if (run?.index > 0 && index >= queue.length) {
      // 答過幾題了，剩下的都被回報而略過：這關算做完
      markCleared(prog, target);
      ctx.save();
      ctx.toast(`「${target}」剩下的題目都回報過了，這關算完成`);
      return startPath({ subject });
    }
    if (index >= queue.length) {
      queue = queueFor('path', { subjects: [subject], units: [unitKey(subject, target)] });
      index = 0;
    }
    if (!queue.length) {
      // 單元裡沒回報的題目都答對過、從沒失手：已經會了，算過關，往下一關
      const left = ctx.bank.some((x) => x.subject === subject && x.topic === target && !ctx.state.flags[x.id]);
      if (left && !prog.cleared.includes(target)) {
        markCleared(prog, target);
        ctx.save();
        ctx.toast(`「${target}」的題目都答對過了，直接過關`);
        return startPath({ subject });
      }
      ctx.toast(left ? '這個單元的題目都答對過了' : '這個單元沒有可以出的題目');
      return;
    }
    ctx.state.pathLast = subject;
    begin('path', queue, { subject, unit: target }, { index, extra: run && index ? run.extra : [], path: { subject, unit: target } });
    // 先存下這關的題目順序，中途離開也能接著做
    savePath(index);
    ctx.save();
  }

  /** 闖關：記下這關的題目順序、下一題的位置與時間（同步時以較晚的為準） */
  function savePath(nextIndex) {
    pathProgress(ctx.state, s.path.subject).runs[s.path.unit] = {
      ids: s.queue.map((x) => x.id),
      index: nextIndex,
      extra: [...s.extra],
      at: Date.now(),
    };
  }

  /** 闖關答錯（或看解答、標成猜的）：在這關最後補一題類似題；回傳補進來的題目 */
  function addFollowUp(missed) {
    const off = new Set(ctx.state.settings.excludedUnits);
    const avoid = Object.keys(ctx.state.flags);
    for (const [id, c] of Object.entries(ctx.state.cards)) if (neverMissed(c)) avoid.push(id);
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
    s.round = ++rounds;
    // 作答中按「練 3 題類似題」、闖關答錯補進來的題目
    s.extra = new Set(extra);
    s.path = path;
    // 闖關裡答對後標成猜的，補進來的題目：取消標記時要拿掉
    s.followUps = new Map();
    // 剛連續做了幾題複習（之前做過的題目）：自由練習補下一批時接著算
    s.reviewRun = 0;
    el.timer.hidden = s.timeLeft === null;
    el.score.textContent = '0';
    renderCombo();
    ctx.scratch.start();
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
    // 看解答、回看上一題、動畫期間與切到背景時不扣時間；上限 1 秒是為了切回前景的第一幀，卡頓的手機仍照實扣時
    if (phase === 'answering' && !looking && !document.hidden) {
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
    // 剩餘秒數也給螢幕閱讀器：進度條的數值，以及剩 30、10 秒時念一次
    const secs = Math.max(0, Math.ceil(s.timeLeft));
    if (secs === Number(el.timer.getAttribute('aria-valuenow'))) return;
    el.timer.setAttribute('aria-valuenow', String(secs));
    el.timer.setAttribute('aria-valuetext', `剩 ${secs} 秒`);
    if ((secs === 30 || secs === 10) && phase === 'answering') el.status.textContent = `剩 ${secs} 秒`;
  }

  function showQuestion() {
    q = current(s);
    phase = 'answering';
    shownAt = Date.now();
    pausedMs = 0;
    pauseStart = document.hidden ? shownAt : 0;
    const subj = SUBJECT_BY_ID[q.subject];
    el.card.style.setProperty('--c', subj.color);
    el.subject.textContent = subj.name;
    const pos = groupPosition(s.queue, s.index);
    const where = pos ? `題組 ${pos.k}／${pos.n}` : '';
    // 題組：「題組 2／4」放最前面；單元名稱太長時截斷的是名稱，後面的「・類似題」「・多選」這些標記不拆開（play-card.js）
    const extra = s.extra.has(q.id);
    el.topic.innerHTML = topicHTML({
      where,
      name: `${extra ? icon('loop') : ''}${topicLabel(q)}`,
      kinds: [extra ? '類似題' : '', q.scratch ? '演算題' : q.type === 'ms' ? '多選' : q.type === 'open' ? '非選' : ''],
    });
    useChoices = false;
    showPassage(el.passage, q, where);
    el.text.innerHTML = stemHTML(q);
    // 作答後要標出這題的考點：考點清單先載好（每科一個小檔，載不下來就不標）
    loadConcepts(q.subject).catch(() => {});
    el.explain.hidden = true;
    el.next.hidden = true;
    el.msSend.hidden = true;
    el.related.hidden = true;
    el.certain.hidden = true;
    pendingRelated = [];
    lastRight = null;
    el.back.hidden = !s.log.length;
    el.skip.hidden = false;
    const counted = s.timeLeft === null && !MODES[s.mode].endless;
    el.progress.textContent = counted ? `${s.index + 1} / ${s.queue.length}` : `第 ${s.index + 1} 題`;
    el.card.classList.toggle('swipeable', q.type === 'tf');
    renderMarks();
    stopSpeaking();
    // 非選擇題（中譯英）念的是參考答案：看了參考答案才給發音按鈕
    el.speak.hidden = !canSpeak(q) || q.type === 'open';
    resetCardDrag();
    restartAnimation(el.card, 'enter');
    renderAnswers();
    el.status.textContent = '';
    if (keyboard && !looking) el.answers.querySelector('.answer, .open-reveal')?.focus({ preventScroll: true });
    fitCard();
    ctx.scratch.newPage(q, `play-${s.round}-${s.index}`);
    ctx.world.setFocusSubject(q.subject);
    if (s.timeLeft !== null) renderTimer();
  }

  function renderAnswers() {
    el.answers.innerHTML = '';
    picked = new Set();
    fill = null;
    revealed = false;
    if (q.type === 'open') return renderOpen();
    if (q.type === 'tf') {
      el.answers.className = 'answers tf';
      // 與滑動方向一致：左錯右對
      el.answers.append(answerButton(`${icon('ng')}錯`, false, '←', true), answerButton(`${icon('ok')}對`, true, '→', true));
      return;
    }
    // 共用選項（文意選填、篇章結構）整組固定順序，換格時選項不會跑位置
    order = isBank(q) ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i));
    if (q.type === 'ms') return renderMulti();
    if (fillable(q) && !useChoices) return renderFill();
    renderChoices();
  }

  function renderChoices() {
    el.answers.innerHTML = '';
    el.answers.className = choicesClass(q);
    order.forEach((orig, i) => el.answers.append(answerButton(richHTML(q.choices[orig]), i, String(i + 1), true)));
    // 共用選項：這一輪前面的空格作答後已經公布正解，那些選項標「已用」
    const filled = s.log.map((e) => ({ q: byId.get(e.id), value: byId.get(e.id)?.answer }));
    markUsed(el.answers, usedOptions(q, filled), (b) => order[b._value]);
  }

  // ── 多選題：點選項切換要不要選，選好按底下的「送出」 ───────────────
  function renderMulti() {
    el.answers.className = 'answers ms';
    order.forEach((orig, i) => {
      const btn = answerButton(richHTML(q.choices[orig]), i, String(i + 1), true);
      btn.setAttribute('aria-pressed', 'false');
      el.answers.append(btn);
    });
    el.msSend.textContent = sendLabel;
    el.msSend.hidden = false;
    renderMultiSend();
  }

  /** 多選題一個都還沒選時「送出」按不下去；非選擇題的自評一個要點都沒寫到也可以送出 */
  function renderMultiSend() {
    el.msSend.disabled = q.type === 'ms' && !picked.size;
  }

  el.msSend.addEventListener('click', () => (q?.type === 'open' ? submitOpen() : submitMulti()));

  function toggleMulti(value) {
    if (picked.has(value)) picked.delete(value);
    else picked.add(value);
    buttonFor(value).setAttribute('aria-pressed', String(picked.has(value)));
    renderMultiSend();
  }

  function submitMulti() {
    if (phase !== 'answering' || q.type !== 'ms') return;
    if (!picked.size) {
      el.status.textContent = '先選選項（數字鍵 1–5 或空白鍵），再按 Enter 送出';
      return;
    }
    const chosen = [...picked].map((v) => order[v]).sort((a, b) => a - b);
    resolve(isCorrect(q, chosen) ? 'right' : 'wrong', null, chosen);
  }

  /** 多選題作答後：選對的打圈、選錯的打叉、該選沒選的標「漏選」 */
  function markMulti(outcome, chosen) {
    el.msSend.hidden = true;
    // 按「不會」看解答時沒有作答：正解都標成正解，不算漏選
    const mine = Array.isArray(chosen) ? new Set(chosen) : null;
    markMultiChoices(el.answers.children, order, q.answer, mine);
    const answers = q.answer.map((i) => plainText(buttonFor(order.indexOf(i)).querySelector('.answer-text')));
    el.status.textContent = outcome === 'right' ? '全對！' : `${outcome === 'wrong' ? `${msNote(q, chosen)}。` : ''}正解是：${answers.join('；')}`;
  }

  // ── 非選擇題：先自己寫，看了參考答案再對照評分要點，自己勾寫到了哪幾個 ───────────
  function renderOpen() {
    el.answers.className = 'answers open';
    el.answers.innerHTML = '<p class="open-hint">先在草稿區或紙上寫出答案，再對照參考答案自己評分</p><button type="button" class="open-reveal">看參考答案</button>';
    el.answers.querySelector('.open-reveal').addEventListener('click', revealOpen);
  }

  /** 作答區換成參考答案與評分要點（每個要點一顆按鈕）：按「看參考答案」，或還沒看就按「不會」時 */
  function showOpenAnswer() {
    revealed = true;
    el.answers.innerHTML = `${openRefHTML(q, true)}<p class="open-ask">你寫到了哪幾個要點？</p>`;
    q.points.forEach((p, i) => el.answers.append(answerButton(richHTML(p), i, String(i + 1), true)));
    el.speak.hidden = !canSpeak(q);
  }

  const openRefText = () => plainText(el.answers.querySelector('.open-ref-text'));

  function revealOpen() {
    if (phase !== 'answering' || q.type !== 'open' || revealed) return;
    showOpenAnswer();
    for (const b of el.answers.querySelectorAll('.answer')) b.setAttribute('aria-pressed', 'false');
    el.msSend.textContent = '送出自評';
    el.msSend.hidden = false;
    renderMultiSend();
    fitCard();
    el.status.textContent = `參考答案：${openRefText()}。你寫到了哪幾個要點？`;
    // 「看參考答案」那顆按鈕不見了：用鍵盤操作時焦點接到第一個要點
    if (keyboard) el.answers.querySelector('.answer').focus({ preventScroll: true });
  }

  function submitOpen() {
    if (phase !== 'answering' || q.type !== 'open' || !revealed) return;
    const chosen = [...picked].sort((a, b) => a - b);
    resolve(isCorrect(q, chosen) ? 'right' : 'wrong', null, chosen);
  }

  /** 非選擇題作答後：自評寫到的要點打圈、沒寫到的標「沒寫到」（那正是最該看的，不淡化）；按「不會」時列出參考答案與要點，都不勾 */
  function markOpen(outcome, chosen) {
    el.msSend.hidden = true;
    if (!revealed) showOpenAnswer();
    el.answers.querySelector('.open-ask').textContent = '評分要點';
    markOpenPoints(el.answers.querySelectorAll('.answer'), new Set(chosen ?? []), outcome === 'skip');
    el.answers.scrollTop = 0;
    updateAnswersMore();
    el.status.textContent = outcome === 'skip' ? `參考答案：${openRefText()}` : openNote(q, chosen);
  }

  // ── 演算題填答：先自己算出答案填進去（像學測選填），不先看選項；算不出來可以改看選項 ──
  function renderFill() {
    fill = { text: '' };
    el.answers.className = 'answers fill';
    const unit = fillUnit(q);
    el.answers.innerHTML = fillHTML();
    el.answers.querySelector('.fill-unit').textContent = unit;
    const keys = el.answers.querySelector('.fill-keys');
    keys.addEventListener('click', (e) => {
      const key = e.target.closest('[data-k]');
      if (key) typeKey(key.dataset.k);
    });
    // 用滑鼠點數字鍵不搶焦點：接著按實體鍵盤的 Enter 是送出，不會重按剛剛點的那顆鍵（用 Tab 移過去的照常）
    keys.addEventListener('mousedown', (e) => e.preventDefault());
    el.answers.querySelector('.fill-switch').addEventListener('click', () => {
      if (phase !== 'answering') return;
      fill = null;
      useChoices = true;
      renderChoices();
      fitCard();
      if (keyboard) el.answers.querySelector('.answer')?.focus({ preventScroll: true });
    });
    renderFillValue();
  }

  function renderFillValue() {
    const out = el.answers.querySelector('.fill-value');
    out.textContent = fill.text || '算出答案後填入';
    out.classList.toggle('empty', !fill.text);
  }

  /** 按一個填答鍵：數字、小數點、負號（切換）、分數線、刪除、送出（字串怎麼變見 play-fill.js） */
  function typeKey(k) {
    if (phase !== 'answering' || !fill) return;
    if (k === 'ok') return submitFill();
    const t = typeFillKey(fill.text, k);
    if (t === null) return;
    fill.text = t;
    renderFillValue();
  }

  function submitFill() {
    if (phase !== 'answering' || !fill) return;
    const value = parseTyped(fill.text);
    if (value === null) {
      el.status.textContent = '先填入答案：整數、小數或分數，例如 -3、2.5、7/4';
      restartAnimation(el.answers.querySelector('.fill-box'), 'shake');
      return;
    }
    const m = matchTyped(q, value);
    resolve(m === q.answer ? 'right' : 'wrong', m >= 0 ? order.indexOf(m) : null, m >= 0 ? m : null, fill.text);
  }

  // ── 小螢幕：題目卡放不下時縮小字級、提示「往下還有」（play-card.js） ─────────────
  const { fitCard, updateMore, updateAnswersMore, updateNeed, showAnswer, foldDim } = initCardFit(
    { card: el.card, text: el.text, answers: el.answers, more: el.more },
    () => !!q && !$('#play').hidden,
  );
  // 模擬考借用同一張題目卡（ui/exam.js）
  ctx.fitCard = fitCard;

  function answerButton(label, value, key, isHTML = false) {
    return createAnswerButton(label, value, key, isHTML, choose);
  }

  function buttonFor(value) {
    return [...el.answers.children].find((b) => b._value === value);
  }

  function choose(value) {
    if (phase !== 'answering') return null;
    // 多選題點選項只是切換選取，按「送出」才作答；非選擇題的評分要點也是
    if (q.type === 'ms' || q.type === 'open') return toggleMulti(value), null;
    const chosen = q.type === 'mc' ? order[value] : value;
    const outcome = isCorrect(q, chosen) ? 'right' : 'wrong';
    resolve(outcome, value, chosen);
    return outcome;
  }

  /**
   * @param {'right'|'wrong'|'skip'} outcome
   * @param displayValue 被點的按鈕值（skip、多選題、非選擇題，以及填的答案不是任何一個選項時為 null）
   * @param chosen 原始選項索引（多選題是陣列；非選擇題是自評寫到的要點索引陣列）
   * @param {string | null} typed 演算題填的答案
   */
  function resolve(outcome, displayValue, chosen, typed = null) {
    phase = 'feedback';
    // 填答（或填答中按「不會」）：作答後換回選項，標出正解與你填的是哪個選項
    if (fill) {
      fill = null;
      renderChoices();
    }
    const now = Date.now();
    const card = ctx.state.cards[q.id];
    s.reviewRun = card ? s.reviewRun + 1 : 0;
    ctx.state.cards[q.id] = schedule(card, outcome, now, { confirm: needsConfirm(q) });
    const open = q.type === 'open';
    // 非選擇題是自評，寫到幾個要點已經表達了把握，不另外問「猜的／不太確定」
    lastRight = outcome === 'right' && !open ? { id: q.id, before: card, at: now } : null;
    const before = today(ctx.state, now).answered;
    recordAnswer(ctx.state, outcome, now);
    recordPace(ctx.state, q, outcome, (now - shownAt - pausedMs - (pauseStart ? now - pauseStart : 0)) / 1000);
    const points = submit(s, outcome, chosen);
    // 記下當時的選項順序：回看上一題、複製題目時 (A)–(D) 跟畫面一致
    const entry = s.log[s.log.length - 1];
    if (q.type !== 'tf' && !open) entry.order = order;
    if (typed !== null) entry.typed = typed;
    el.back.hidden = true;
    if (s.path) {
      if (outcome !== 'right') addFollowUp(q);
      savePath(s.index + 1);
      el.progress.textContent = `${s.index + 1} / ${s.queue.length}`;
    }
    ctx.save();

    const goal = ctx.state.settings.goal;
    if (before < goal && today(ctx.state, now).answered >= goal) ctx.toast(`今日 ${goal} 題目標達成！`);

    const correctValue = open ? null : q.type === 'tf' ? q.answer : order.indexOf(q.type === 'ms' ? q.answer[0] : q.answer);
    if (open) markOpen(outcome, chosen);
    else if (q.type === 'ms') markMulti(outcome, chosen);
    else {
      markChoices(el.answers.children, correctValue, displayValue, typed !== null);
      showAnswer(buttonFor(correctValue));
      const said = plainText(buttonFor(correctValue)).replace(/（正解）$/, '');
      const mine = typed !== null && outcome === 'wrong' ? `你填 ${typed}，` : '';
      el.status.textContent = outcome === 'right' ? '答對！' : `${outcome === 'wrong' ? '答錯。' : ''}${mine}正解是：${said}`;
    }
    el.score.textContent = s.score;
    renderCombo();
    ctx.world.setCombo(s.combo);

    const color = SUBJECT_BY_ID[q.subject].color;
    ctx.world.react(outcome);
    ctx.scratch.answered();
    if (outcome === 'right') {
      // 非選擇題沒有正解按鈕：特效從作答區中間噴出來
      const rect = (open ? el.answers : buttonFor(correctValue)).getBoundingClientRect();
      ctx.world.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 30 + Math.min(s.combo, 10) * 4);
      sfx.right(s.combo);
      showPop(`+${points}`);
      if (!open) showCertainty();
      if (!MODES[s.mode].explainAlways) {
        el.skip.hidden = true;
        el.next.hidden = false;
        // 用鍵盤作答時焦點移到「繼續」（作答按鈕都停用了，焦點不能留在上面）
        if (keyboard) el.next.focus({ preventScroll: true });
        autoNext = setTimeout(next, RIGHT_DELAY);
        return;
      }
    } else if (outcome === 'wrong') {
      ctx.world.shake();
      sfx.wrong();
      restartAnimation(el.flash, 'on');
      restartAnimation(el.card, 'shake');
    }
    el.explain.innerHTML = `<b>${icon('bulb')}${outcome === 'skip' ? '解答' : '解析'}${lvTag(q)}</b>${richHTML(q.explain)}`;
    // 多選題答錯：照學測規則這題還拿得到幾分（只錯一個選項也有部分分數）
    if (q.type === 'ms' && outcome === 'wrong') el.explain.insertAdjacentHTML('afterbegin', `<span class="ms-score">${msNote(q, chosen)}</span>`);
    if (typed !== null && outcome === 'wrong' && displayValue === null) el.explain.insertAdjacentHTML('afterbegin', `<span class="ms-score">你填的 ${typed} 不是任何一個選項的值</span>`);
    if (s.path && outcome !== 'right') el.explain.insertAdjacentHTML('beforeend', `<span class="path-note">${icon('loop')}這關最後補了一題類似題</span>`);
    // 卡關：同一題失手好幾次了，多半是背了答案又忘。提醒先回頭看這個單元的重點（快閃在計時，不打斷）
    const after = ctx.state.cards[q.id];
    if (outcome !== 'right' && s.timeLeft === null && isLeech(after)) {
      el.explain.insertAdjacentHTML(
        'beforeend',
        `<span class="leech-note">這題已經失手 ${missCount(after)} 次。只記答案很快又會忘，先<button type="button" class="link-btn" data-kp="${q.subject}/${q.topic}">看這個單元的重點</button>，或練幾題類似題，換個角度弄懂。</span>`,
      );
    }
    showConcept(outcome !== 'right');
    el.explain.hidden = false;
    // 題目卡多了解析，需要的高度變了（非選擇題的版面用得到，見 play-card.js）
    updateNeed();
    // 小螢幕：加了解析後題目卡放不下，就把沒選到的錯誤選項各收成一行，高度讓給題目卡（點一下展開）。
    // 多選題、共用選項、非選擇題的要點每一個都要對照著看，是非題只有一列，都不收
    if (q.type === 'mc' && !isBank(q)) foldDim();
    // 小螢幕上題目長時，解析可能在卡片可視範圍外
    el.explain.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateMore();
    // 題目卡加了解析會長高，作答區（非選擇題的要點、篇章結構的長句）可能變成要捲動：底部的淡出提示重算一次
    updateAnswersMore();
    el.skip.hidden = true;
    // 答錯或不會：可以馬上再練幾題同單元的類似題（快閃模式在計時，不打斷）
    offerRelated(outcome !== 'right');
    el.next.hidden = false;
    el.next.focus({ preventScroll: true });
  }

  /**
   * 解析標題旁標出這題的考點。作答前不顯示：考點名稱常常就是解題的提示（「餘式定理」「轉折與讓步」）。
   * 答錯或看解答時，解析後面再加一句這個考點的重點（該記住的規則、公式或事實），放在補題、卡關提示之前。
   * 考點清單還在下載就等它好了再補上（還停在同一題的解析才補）
   * @param {boolean} missed 答錯或看解答
   */
  function showConcept(missed) {
    const asked = q;
    const put = () => {
      const c = conceptOf(asked);
      const head = el.explain.querySelector('b');
      if (!c || q !== asked || phase !== 'feedback' || !head || head.querySelector('.kp-tag')) return false;
      const tag = document.createElement('span');
      tag.className = 'kp-tag';
      tag.textContent = `考點：${c.name}`;
      head.append(tag);
      if (missed && c.note) {
        const note = document.createElement('span');
        note.className = 'kp-note';
        note.innerHTML = `<b class="kp-note-h">考點重點</b>${richHTML(c.note)}`;
        el.explain.insertBefore(note, el.explain.querySelector('.path-note, .leech-note'));
      }
      return true;
    };
    if (put() || conceptOf(asked)) return;
    loadConcepts(asked.subject).then(
      () => put() && updateNeed(),
      () => {},
    );
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
    ctx.state.cards[lastRight.id] = schedule(lastRight.before, mark ?? 'right', now, { confirm: needsConfirm(q) });
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

  /** 自由練習：出完一批就再組一批；剛答過的先不出，題目太少時才允許重複。上一批最後連續的複習接著算 */
  function refill() {
    const streak = s.reviewRun;
    const more = queueFor(s.mode, { exclude: s.log.slice(-RECENT).map((e) => e.id), streak });
    extend(s, more.length ? more : queueFor(s.mode, { streak }));
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
    copyQuestion(questionPrompt(q, { order: q.type === 'tf' || q.type === 'open' ? undefined : order, ...entry }), ctx.toast);
  });

  el.flag.addEventListener('click', () => {
    if (!q) return;
    const { flags } = ctx.state;
    setFlag(ctx.state, q.id, !flags[q.id], Date.now());
    if (flags[q.id]) reportQuestion(q.id);
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

  // 回看這輪剛做過的題目：關掉後回到原本這題，收藏、回報可能在面板裡改過，重畫一次
  el.back.addEventListener('click', () => {
    if (phase !== 'answering' || !s.log.length) return;
    looking = true;
    pauseClock();
    stopSpeaking();
    // 紀錄和題號一對一，闖關接著做時第一筆不是第 1 題
    const first = s.index - s.log.length;
    const list = s.log.map((entry, i) => ({ q: byId.get(entry.id), entry, n: first + i + 1 }));
    ctx.openPast(list, {
      current: s.index + 1,
      timed: s.timeLeft !== null,
      onClose: () => {
        looking = false;
        resumeClock();
        renderMarks();
      },
    });
  });

  // 解析裡的「看這個單元的重點」（卡關提示）
  el.explain.addEventListener('click', (e) => {
    openKeypointsFrom(ctx, e.target);
  });
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

  // ── 是非題：卡片左右滑（play-card.js） ────────────────────
  const resetCardDrag = initCardSwipe(el.card, {
    canStart: () => phase === 'answering' && q.type === 'tf',
    onSwipe: (right) => {
      if (phase !== 'answering') return null;
      // 答對且馬上換題就讓卡片順勢飛出；要看解析的拉回中間
      return choose(right) === 'right' && !MODES[s.mode].explainAlways;
    },
  });

  // ── 鍵盤（桌機） ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // 面板開著（重點卡、回看上一題…）時快捷鍵不穿過去；組字中、按著修飾鍵的也不算；模擬考有自己的快捷鍵（ui/exam.js）
    const screen = document.querySelector('#play');
    if (screen.hidden || screen.classList.contains('exam') || !s || looking || topSheet() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') return $('#quit').click();
    if (phase === 'feedback' && (e.key === 'Enter' || e.key === ' ')) {
      // 焦點在別的按鈕上（猜對的、練類似題、收藏…）：讓那個按鈕自己作用，不要直接換題
      if (e.target.closest?.('button, a, input, select, textarea') && e.target !== el.next) return;
      e.preventDefault();
      return next();
    }
    if (phase === 'feedback' && lastRight && (e.key === 'g' || e.key === 'u')) return setCertainty(e.key === 'g' ? 'guess' : 'unsure');
    if (phase !== 'answering') return;
    // 演算題填答：直接打數字、小數點、負號、分數線，Backspace 刪除、Enter 送出
    if (fill) {
      const k = fillKeyFor(e.key);
      if (k && !(k === 'ok' && e.target.closest?.('button'))) {
        e.preventDefault();
        typeKey(k);
      } else if (e.key === '?') el.skip.click();
      return;
    }
    if (q.type === 'open') {
      if (e.key === '?' || e.key === '0') el.skip.click();
      else if (!revealed) {
        // 還沒看參考答案：Enter、空白鍵就是看；焦點在按鈕上（「看參考答案」本身、收藏、回報…）時交給那個按鈕
        if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest?.('button, a, input, select, textarea')) {
          e.preventDefault();
          revealOpen();
        }
      } else if (/^[1-4]$/.test(e.key) && Number(e.key) <= q.points.length) choose(Number(e.key) - 1);
      // 看了之後和多選題一樣：數字鍵或空白鍵勾要點，Enter 送出自評（焦點停在要點上也是）
      else if (e.key === 'Enter' && (!e.target.closest?.('button') || e.target.closest('#answers .answer'))) {
        e.preventDefault();
        submitOpen();
      }
      return;
    }
    if (q.type === 'ms') {
      if (/^[1-5]$/.test(e.key)) choose(Number(e.key) - 1);
      // Enter 一律是送出，焦點停在選項上也是（切換選項用數字鍵或空白鍵）；焦點在收藏、回報等其他按鈕上時交給那個按鈕
      else if (e.key === 'Enter' && (!e.target.closest?.('button') || e.target.closest('#answers .answer'))) {
        e.preventDefault();
        submitMulti();
      } else if (e.key === '?' || e.key === '0') el.skip.click();
      return;
    }
    // 單選題 1–4；共用選項最多 8 個，按 1–8
    if (q.type === 'mc' && /^[1-9]$/.test(e.key) && Number(e.key) <= q.choices.length) choose(Number(e.key) - 1);
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
