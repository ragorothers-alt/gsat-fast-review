// 一輪遊戲的狀態：計分、連擊、計時。純邏輯，UI 只負責呼叫。

/**
 * endless：題目快用完時由 UI 補下一批，玩家自己按結束才結算
 * explainAlways：答對也停下來看解析，按「繼續」才換題
 * quickOnly：只出幾秒內答得完的題目：不出要動筆算好幾分鐘的演算題（題目的 scratch）、要逐一判斷五個選項的多選題，
 *   也不出要自己寫出答案的非選擇題
 * newEvery：到期的複習和新題都有時，每幾題留一題給新題（沒寫就是 srs.js 的 NEW_EVERY，每 2 題複習配 1 題新題）。
 *   自由練習是 2：複習和新題一題一題輪流，考前能練到的新題比較多，到期的複習也會清得慢一點
 */
export const MODES = {
  blitz: { name: '60 秒快閃', size: 80, timeLimit: 60, quickOnly: true },
  free: { name: '自由練習', size: 20, endless: true, explainAlways: true, newEvery: 2 },
  ten: { name: '10 題一輪', size: 10 },
  formula: { name: '公式特訓', size: 10, formulaOnly: true },
  review: { name: '錯題複習', size: 15, weakOnly: true },
  weak: { name: '弱點加強', size: 15, explainAlways: true },
  // 從結算畫面的錯題出發，練同單元裡最像的題目
  related: { name: '錯題延伸', size: 15, explainAlways: true },
  // 從錯題本的收藏、搜尋結果出發，練指定的題目（opts.ids）
  starred: { name: '收藏的題目', size: 20, explainAlways: true },
  picked: { name: '搜尋到的題目', size: 20, explainAlways: true },
  // 學習分析「英文單字」的「練這一級」：這一級還沒學會的單字題（opts.ids）
  vocab: { name: '英文單字', size: 20, explainAlways: true },
  // 一科一個單元一個單元過關：每關先出 30 題，答錯就在這關後面補類似題（見 path.js）
  path: { name: '單元闖關', size: 30 },
  // 模擬考成績單的「練這份的錯題」（opts.ids）；模擬考本身見 ui/exam.js
  exam: { name: '模擬考錯題', size: 40, explainAlways: true },
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

/**
 * 剛答對的那題，玩家自己標成「猜的」（guess）或「不太確定」（unsure），kind = null 取消標記。
 * 標了就不算進答對數；分數與連擊照算，不影響遊戲節奏。
 */
export function markLast(s, kind) {
  const e = s.log[s.log.length - 1];
  if (!e || e.outcome !== 'right') return;
  if (!e.mark && kind) s.right--;
  if (e.mark && !kind) s.right++;
  if (kind) e.mark = kind;
  else delete e.mark;
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
 * 判斷作答是否正確。mc 的 chosen 是原始選項索引（UI 打亂後要換回來）；tf 為 boolean；
 * ms（多選）是選了的原始選項索引陣列，要和正解完全一樣才算對；
 * open（非選擇題）是自評寫到的評分要點索引陣列，每個要點都寫到才算對。
 */
export function isCorrect(q, chosen) {
  if (q.type === 'open') return Array.isArray(chosen) && chosen.length === q.points.length;
  if (q.type === 'ms') return Array.isArray(chosen) && chosen.length === q.answer.length && q.answer.every((i) => chosen.includes(i));
  return chosen === q.answer;
}

/** 非選擇題的自評：寫到幾個評分要點（看解答、沒作答算 0 個） */
export function openNote(q, chosen) {
  return `自評：寫到 ${Array.isArray(chosen) ? chosen.length : 0}／${q.points.length} 個要點`;
}

/** 多選題答錯幾個選項：該選沒選、不該選卻選了，各算一個（學測「各選項獨立判定」） */
export function msWrong(q, chosen) {
  const picked = new Set(chosen ?? []);
  return q.choices.reduce((k, _, i) => k + (picked.has(i) !== q.answer.includes(i) ? 1 : 0), 0);
}

/** 多選題照學測計分（這題滿分算 1）：n 個選項答錯 k 個得 (n − 2k)/n，低於 0 或沒作答得 0 */
export function msScore(q, chosen) {
  if (!chosen?.length) return 0;
  const n = q.choices.length;
  return Math.max(0, (n - 2 * msWrong(q, chosen)) / n);
}

/** 多選題沒全對時的計分說明：答錯幾個選項、照學測規則這題可得幾分 */
export function msNote(q, chosen) {
  const k = msWrong(q, chosen);
  const n = q.choices.length;
  return `答錯 ${k} 個選項：${msScore(q, chosen) > 0 ? `學測這題可得 ${n - 2 * k}/${n} 的分數` : '學測這題 0 分'}`;
}
