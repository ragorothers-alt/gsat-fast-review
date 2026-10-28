// 一輪遊戲的狀態：計分、連擊、計時。純邏輯，UI 只負責呼叫。

/**
 * endless：題目快用完時由 UI 補下一批，玩家自己按結束才結算
 * explainAlways：答對也停下來看解析，按「繼續」才換題
 */
export const MODES = {
  blitz: { name: '60 秒快閃', size: 80, timeLimit: 60 },
  free: { name: '自由練習', size: 20, endless: true, explainAlways: true },
  ten: { name: '10 題一輪', size: 10 },
  formula: { name: '公式特訓', size: 10, formulaOnly: true },
  review: { name: '錯題複習', size: 15, weakOnly: true },
  weak: { name: '弱點加強', size: 15, explainAlways: true },
};

export function createSession(mode, queue) {
  return {
    mode,
    queue,
    index: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    right: 0,
    wrong: 0,
    skipped: 0,
    log: [],
    timeLeft: MODES[mode].timeLimit ?? null,
  };
}

export function current(s) {
  return s.queue[s.index] ?? null;
}

/** 連擊倍率：每連對 3 題 +1，最多 ×5 */
export function multiplier(combo) {
  return 1 + Math.min(4, Math.floor(Math.max(0, combo - 1) / 3));
}

/**
 * 記錄目前這題的作答結果，回傳得分。
 * @param {'right'|'wrong'|'skip'} outcome
 */
export function submit(s, outcome, chosen = null) {
  const q = current(s);
  let points = 0;
  if (outcome === 'right') {
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.right++;
    points = 10 * multiplier(s.combo);
    s.score += points;
  } else {
    s.combo = 0;
    if (outcome === 'wrong') s.wrong++;
    else s.skipped++;
  }
  s.log.push({ id: q.id, outcome, chosen });
  return points;
}

/** 無盡模式補題：接在佇列最後 */
export function extend(s, questions) {
  s.queue.push(...questions);
}

/** 前進到下一題；回傳是否還有題目可作答 */
export function advance(s) {
  s.index++;
  return !isOver(s);
}

export function isOver(s) {
  return s.index >= s.queue.length || (s.timeLeft !== null && s.timeLeft <= 0);
}

export function tick(s, seconds) {
  if (s.timeLeft !== null) s.timeLeft = Math.max(0, s.timeLeft - seconds);
}

/**
 * 判斷作答是否正確。mc 的 chosen 是原始選項索引（UI 打亂後要換回來）；tf 為 boolean。
 */
export function isCorrect(q, chosen) {
  return chosen === q.answer;
}
