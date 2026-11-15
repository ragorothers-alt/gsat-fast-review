// 模擬考：依 111–115 學測各單元的出題占比抽一份卷，整卷計時，交卷後才對答案。純邏輯，不碰 DOM。
import { SUBJECT_ITEMS, UNIT_SHARE } from './blueprint.js';
import { bundles, groupKind, isBank } from './groups.js';
import { fillable, matchTyped, parseTyped } from './numeric.js';
import { isCorrect, msScore } from './session.js';
import { shuffle } from './srs.js';
import { UNITS, isUnitOff, unitKey } from './units.js';

export { UNIT_SHARE };

/** @typedef {{ id: string, name: string, subjects: string[], size: number, minutes: number, groups?: number, groupName?: string }} Paper */

/**
 * 學測的五張考卷。題庫的題目比學測短（免紙筆、單題），題數和時間也照比例縮小：
 * 平均每題國文 50 秒、英文 40 秒、數學 72 秒、自然 60 秒、社會 45 秒。出單選與多選題（學測沒有是非題）。
 * 另外抽幾組題組（groups 組，算在 size 裡）：國文、英文是閱讀題組，數學是一個情境連問幾題的混合題，
 * 自然是讀一段實驗或科學短文連答幾題的題組，社會是讀一段史料、地理資料或生活情境連答幾題的題組；每組多給約 1–2 分鐘讀文章或情境
 * @type {Paper[]}
 */
export const PAPERS = [
  { id: 'chinese', name: '國文', subjects: ['chinese'], size: 30, minutes: 31, groups: 3, groupName: '閱讀題組' },
  { id: 'english', name: '英文', subjects: ['english'], size: 30, minutes: 27, groups: 3, groupName: '閱讀題組' },
  { id: 'math', name: '數學', subjects: ['math'], size: 25, minutes: 32, groups: 1, groupName: '混合題組' },
  { id: 'science', name: '自然', subjects: ['physics', 'chemistry', 'biology', 'earth'], size: 40, minutes: 44, groups: 3, groupName: '題組' },
  { id: 'social', name: '社會', subjects: ['history', 'geography', 'civics'], size: 40, minutes: 34, groups: 3, groupName: '題組' },
];
export const PAPER_BY_ID = Object.fromEntries(PAPERS.map((p) => [p.id, p]));

/** 各張考卷裡多選題約占幾成（111–115 學測的選擇題裡多選的比例）；題庫的多選題不夠時用單選補 */
export const MS_SHARE = { chinese: 0.2, math: 0.3, science: 0.4 };

/**
 * 各張考卷裡選填題約占幾成：學測數學的選擇（填）題除了單選、多選，還有不給選項、自己算出數值填進去的選填題。
 * 題庫裡能填答的演算題（選項都是同單位的數值，見 numeric.js 的 fillable）在這張卷上一律不給選項；其他科沒有選填題
 */
export const FILL_SHARE = { math: 0.25 };

/** 選填題填的字換成選項：填的數值等於哪個選項的值就當成選了那個（原始索引）；不是完整的數、或不等於任何選項是 null */
export function fillChoice(q, text) {
  const value = parseTyped(text);
  const m = value === null ? -1 : matchTyped(q, value);
  return m >= 0 ? m : null;
}

/** 選填題存下來的作答：只用填答鍵打得出來的字，至少有一個數字（只按了負號不算作答） */
const isFillText = (a) => typeof a === 'string' && a.length <= 16 && /^-?[\d./]+$/.test(a) && /\d/.test(a);

/**
 * 把 n 題依權重分給各項（最大餘數法）：先給整數部分，剩下的依小數部分由大到小補一題
 * @param {Record<string, number>} weights
 * @param {number} n
 * @returns {Record<string, number>}
 */
export function allocate(weights, n) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (!total) return {};
  /** @type {[string, number][]} */
  const raw = entries.map(([k, w]) => [k, (w / total) * n]);
  const out = Object.fromEntries(raw.map(([k, x]) => [k, Math.floor(x)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const [k] of [...raw].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left-- <= 0) break;
    out[k]++;
  }
  return out;
}

/** 這張考卷各單元（unitKey）的出題權重：合科試卷先乘上各科的比重；關掉的單元不出 */
export function paperWeights(paper, excludedUnits = []) {
  const off = new Set(excludedUnits);
  const weights = {};
  for (const subject of paper.subjects) {
    const sw = SUBJECT_ITEMS[subject] ?? 1;
    for (const unit of UNITS[subject] ?? []) {
      const key = unitKey(subject, unit);
      const share = UNIT_SHARE[subject]?.[unit] ?? 0;
      if (share && !off.has(key)) weights[key] = sw * share;
    }
  }
  return weights;
}

/** 題組在考卷上的順序：學測英文先考綜合測驗（克漏字），再文意選填、篇章結構（共用選項），最後閱讀測驗 */
const KIND_ORDER = ['cloze', 'bank', 'reading'];

/**
 * 抽 count 組題組：克漏字、共用選項、閱讀測驗輪流抽，合科試卷（自然）盡量每組不同科，再照學測的順序排。
 * 組裡有題目被回報或單元被關掉時只出剩下的，剩不到 2 題的整組不出。
 */
function pickGroups(questions, count, rng) {
  if (!count) return [];
  const packs = shuffle(bundles(questions).filter((p) => p.length >= 2), rng);
  const lists = KIND_ORDER.map((k) => packs.filter((p) => groupKind(p[0]) === k)).filter((l) => l.length);
  const out = [];
  const used = new Set();
  for (let i = 0; out.length < count && lists.some((l) => l.length); i++) {
    const list = lists[i % lists.length];
    if (!list.length) continue;
    const k = list.findIndex((p) => !used.has(p[0].subject));
    const [pack] = list.splice(Math.max(0, k), 1);
    used.add(pack[0].subject);
    out.push(pack);
  }
  return out.sort((a, b) => KIND_ORDER.indexOf(groupKind(a[0])) - KIND_ORDER.indexOf(groupKind(b[0])));
}

/**
 * 抽一份考卷：先抽 paper.groups 組題組（題庫沒有題組時就全出單題）；其餘題數依各單元占比分配，
 * 每個單元的配額裡約 MS_SHARE 出多選題、FILL_SHARE 出選填題、其餘出單選題；單元題目不夠時從同一張卷的其他單元補。
 * 題目照科目排（合科試卷先物理再化學…），同一科裡單題打亂、題組整組排在單題後面；每題的選項順序也先打亂、整場固定。
 * @param {Question[]} bank
 * @param {Paper} paper PAPERS 裡的一張考卷
 * @param {{ excludedUnits?: string[], flags?: Record<string, unknown>, rng?: () => number }} [opts] 被回報的題目不出
 * @returns {{ ids: string[], orders: number[][], fills: boolean[] }} fills：這題是不是選填題（不給選項，自己填數值）
 */
export function buildPaper(bank, paper, { excludedUnits = [], flags = {}, rng = Math.random } = {}) {
  const off = new Set(excludedUnits);
  const usable = (q) => (q.type === 'mc' || q.type === 'ms') && !flags[q.id] && !isUnitOff(q, off);
  const fillShare = FILL_SHARE[paper.id] ?? 0;
  const asFill = (q) => fillShare > 0 && fillable(q);
  const groups = pickGroups(
    bank.filter((q) => q.group && paper.subjects.includes(q.subject) && usable(q)),
    paper.groups ?? 0,
    rng,
  );
  const grouped = groups.reduce((a, p) => a + p.length, 0);
  const counts = allocate(paperWeights(paper, excludedUnits), Math.max(0, paper.size - grouped));
  const share = MS_SHARE[paper.id] ?? 0;
  // 有選填題的卷：能填答的單選題另外一堆（fill），單選題那堆只剩要看選項的
  const pools = new Map(Object.keys(counts).map((k) => [k, { mc: [], ms: [], fill: [] }]));
  for (const q of bank) {
    if (q.group || !usable(q)) continue;
    pools.get(unitKey(q.subject, q.topic))?.[asFill(q) ? 'fill' : q.type].push(q);
  }
  const picked = [];
  const spare = [];
  for (const [key, pool] of pools) {
    const n = counts[key];
    shuffle(pool.mc, rng);
    shuffle(pool.ms, rng);
    shuffle(pool.fill, rng);
    // 多選題的題數是 n × MS_SHARE，小數部分用亂數進位，整份卷平均下來才會接近 MS_SHARE；選填題也一樣
    const ms = share ? pool.ms.splice(0, Math.floor(n * share + rng())) : [];
    const fill = fillShare ? pool.fill.splice(0, Math.min(n - ms.length, Math.floor(n * fillShare + rng()))) : [];
    const mc = pool.mc.splice(0, n - ms.length - fill.length);
    // 單選題不夠時用這個單元其他的多選題、選填題補
    if (share) ms.push(...pool.ms.splice(0, n - ms.length - fill.length - mc.length));
    fill.push(...pool.fill.splice(0, n - ms.length - fill.length - mc.length));
    picked.push(...ms, ...fill, ...mc);
    spare.push(...pool.mc, ...(share ? pool.ms : []), ...pool.fill);
  }
  picked.push(...shuffle(spare, rng).slice(0, Math.max(0, paper.size - grouped - picked.length)));
  const ordered = paper.subjects.flatMap((s) => [...shuffle(picked.filter((q) => q.subject === s), rng), ...groups.filter((p) => p[0].subject === s).flat()]);
  // 共用選項（文意選填、篇章結構）整組固定順序，像試卷上的 (A)–(H)
  const orderOf = (q) => (isBank(q) ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i), rng));
  return { ids: ordered.map((q) => q.id), orders: ordered.map(orderOf), fills: ordered.map(asFill) };
}

/**
 * 開考：作答（原始選項索引；多選題是選了的索引、由小到大；選填題是填的字；沒作答是 null）、標記稍後回看、每題花的秒數都從空白開始。
 * fills：哪幾題是選填題（沒給就是都看選項作答）
 */
export function newExam(paper, { ids, orders, fills = ids.map(() => false) }, now) {
  return {
    paper: paper.id,
    ids,
    orders,
    fills,
    answers: ids.map(() => null),
    marks: ids.map(() => false),
    spent: ids.map(() => 0),
    elapsed: 0,
    limit: paper.minutes * 60,
    index: 0,
    at: now,
  };
}

/** 存檔裡的考卷還能不能接著考：格式對、題目都還在題庫裡 */
export function validExam(exam, byId) {
  if (!exam || typeof exam !== 'object' || !PAPER_BY_ID[exam.paper] || !Array.isArray(exam.ids)) return false;
  const n = exam.ids.length;
  const qs = exam.ids.map((id) => byId.get(id));
  const isPerm = (o, k) => Array.isArray(o) && o.length === k && [...Array(k).keys()].every((i) => o.includes(i));
  const isChoice = (q, i) => Number.isInteger(i) && i >= 0 && i < q.choices.length;
  // 選填題的功能上線前存的卷沒有 fills：都是看選項作答
  const fills = exam.fills ?? exam.ids.map(() => false);
  // 單選題答一個選項；多選題答幾個不重複的選項（取消到一個都不選就是沒作答 null）；選填題是填的字
  const isAnswer = (q, a, fill) =>
    a === null ||
    (fill ? isFillText(a) : q.type === 'ms' ? Array.isArray(a) && a.length > 0 && new Set(a).size === a.length && a.every((i) => isChoice(q, i)) : isChoice(q, a));
  return (
    n > 0 &&
    ['orders', 'answers', 'marks', 'spent'].every((k) => Array.isArray(exam[k]) && exam[k].length === n) &&
    qs.every((q) => q?.type === 'mc' || q?.type === 'ms') &&
    Array.isArray(fills) &&
    fills.length === n &&
    fills.every((f, i) => f === false || (f === true && qs[i].type === 'mc')) &&
    exam.orders.every((o, i) => isPerm(o, qs[i].choices.length)) &&
    exam.answers.every((a, i) => isAnswer(qs[i], a, fills[i])) &&
    Number.isFinite(exam.elapsed) &&
    Number.isFinite(exam.limit) &&
    Number.isInteger(exam.index) &&
    exam.index >= 0 &&
    exam.index < n
  );
}

/** 沒作答的題目看了這麼多秒以上，算是想過但做不出來 */
export const TRIED_SECS = 20;

/**
 * 交卷後寫進排程的結果：答錯就是答錯；答對但標記過的（沒把握、想回頭看）算「不太確定」；
 * 沒作答的：想過做不出來（看了 TRIED_SECS 秒以上，或標記過）當成看了解答、進錯題複習，只瞄一眼或時間到還沒看到的不記
 * @returns {'right' | 'wrong' | 'unsure' | 'skip' | null}
 */
export function examOutcome(item) {
  if (item.blank) return item.marked || item.secs >= TRIED_SECS ? 'skip' : null;
  if (!item.right) return 'wrong';
  return item.marked ? 'unsure' : 'right';
}

/** 分數取到小數第二位（多選題的部分分數是 0.2 的倍數，加起來會有浮點誤差） */
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 對答案：每題的結果與得分、各單元的得分與用時、答對與答錯的題平均花幾秒。
 * 每題 1 分：單選題答對得分；多選題照學測規則部分給分（n 個選項錯 k 個得 (n−2k)/n，最低 0 分），全對才算答對；
 * 選填題填的數值等於正解的值才得分（typed 是填的字，answer 是填的值對到的選項，都對不到是 null）
 * @returns {{ total: number, right: number, wrong: number, blank: number, points: number, secs: number, limit: number,
 *   items: { id: string, q: Question, answer: number | number[] | null, typed?: string, right: boolean, blank: boolean, score: number, marked: boolean, secs: number, order: number[], n: number }[],
 *   units: { subject: string, unit: string, total: number, right: number, points: number, secs: number }[],
 *   avgRight: number | null, avgWrong: number | null }}
 */
export function gradeExam(exam, byId) {
  const items = exam.ids.map((id, i) => {
    const q = byId.get(id);
    const raw = exam.answers[i];
    const blank = raw === null;
    const typed = exam.fills?.[i] && !blank ? raw : undefined;
    const answer = typed === undefined ? raw : fillChoice(q, typed);
    const right = !blank && answer !== null && isCorrect(q, answer);
    const score = q.type === 'ms' ? msScore(q, answer) : right ? 1 : 0;
    const item = { id, q, answer, right, blank, score, marked: !!exam.marks[i], secs: exam.spent[i], order: exam.orders[i], n: i + 1 };
    return typed === undefined ? item : { ...item, typed };
  });
  const units = new Map();
  for (const it of items) {
    const key = unitKey(it.q.subject, it.q.topic);
    const u = units.get(key) ?? units.set(key, { subject: it.q.subject, unit: it.q.topic, total: 0, right: 0, points: 0, secs: 0 }).get(key);
    u.total++;
    u.secs += it.secs;
    u.points = round2(u.points + it.score);
    if (it.right) u.right++;
  }
  const avg = (list) => (list.length ? list.reduce((a, it) => a + it.secs, 0) / list.length : null);
  const right = items.filter((it) => it.right);
  const wrong = items.filter((it) => !it.right && !it.blank);
  // 各單元照題庫的單元順序排（科目照考卷順序）
  const subjects = PAPER_BY_ID[exam.paper].subjects;
  const order = (u) => [subjects.indexOf(u.subject), UNITS[u.subject].indexOf(u.unit)];
  return {
    total: items.length,
    right: right.length,
    wrong: wrong.length,
    blank: items.filter((it) => it.blank).length,
    points: round2(items.reduce((a, it) => a + it.score, 0)),
    secs: exam.elapsed,
    limit: exam.limit,
    items,
    units: [...units.values()].sort((a, b) => {
      const [sa, ua] = order(a);
      const [sb, ub] = order(b);
      return sa - sb || ua - ub;
    }),
    avgRight: avg(right),
    avgWrong: avg(wrong),
  };
}

/** 模擬考紀錄只留最近幾次 */
export const KEEP_EXAMS = 30;

/** 記下這次的成績（最新的在最後），回傳上一次同一張卷的成績（沒有則為 null） */
export function logExam(state, paperId, result, now) {
  const log = (state.examLog ||= []);
  const prev = [...log].reverse().find((e) => e.paper === paperId) ?? null;
  log.push({ paper: paperId, at: now, total: result.total, right: result.right, points: result.points, blank: result.blank, secs: Math.round(result.secs) });
  if (log.length > KEEP_EXAMS) log.splice(0, log.length - KEEP_EXAMS);
  return prev;
}

/** 成績紀錄裡合理的一筆（從雲端、另一個分頁讀進來的） */
export function cleanExamEntry(e) {
  const int = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
  if (!e || typeof e !== 'object' || typeof e.paper !== 'string' || !int(e.at, Number.MAX_SAFE_INTEGER)) return null;
  if (!int(e.total, 200) || !e.total || !int(e.right, e.total)) return null;
  const out = { paper: e.paper, at: e.at, total: e.total, right: e.right };
  if (Number.isFinite(e.points)) out.points = e.points;
  for (const k of ['blank', 'secs']) if (int(e[k], 1e5)) out[k] = e[k];
  return out;
}

/**
 * 併進別台的成績（同一時間、同一張卷是同一筆），依時間排好，只留最近 KEEP_EXAMS 次。回傳新增了幾筆。
 * @param {AppState} state
 * @param {unknown[]} incoming
 */
export function mergeExams(state, incoming) {
  const log = (state.examLog ||= []);
  const seen = new Set(log.map((e) => `${e.at}|${e.paper}`));
  let added = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const e = cleanExamEntry(raw);
    if (!e || seen.has(`${e.at}|${e.paper}`)) continue;
    seen.add(`${e.at}|${e.paper}`);
    log.push(e);
    added++;
  }
  if (!added) return 0;
  log.sort((a, b) => a.at - b.at);
  if (log.length > KEEP_EXAMS) log.splice(0, log.length - KEEP_EXAMS);
  return added;
}

/** 一筆成績紀錄的得分（有多選題以前的紀錄沒有 points，那時只有單選題，得分就是答對題數） */
export const examPoints = (entry) => (Number.isFinite(entry.points) ? entry.points : entry.right);
