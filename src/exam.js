// 模擬考：依 111–115 學測各單元的出題占比抽一份卷，整卷計時，交卷後才對答案。純邏輯，不碰 DOM。
import { shuffle } from './srs.js';
import { UNITS, isUnitOff, unitKey } from './units.js';

/**
 * 學測的五張考卷。題庫的題目比學測短（免紙筆、單題），題數和時間也照比例縮小：
 * 平均每題國文 50 秒、英文 40 秒、數學 72 秒、自然 60 秒、社會 45 秒。只出單選題（學測沒有是非題）
 */
export const PAPERS = [
  { id: 'chinese', name: '國文', subjects: ['chinese'], size: 30, minutes: 25 },
  { id: 'english', name: '英文', subjects: ['english'], size: 30, minutes: 20 },
  { id: 'math', name: '數學', subjects: ['math'], size: 25, minutes: 30 },
  { id: 'science', name: '自然', subjects: ['physics', 'chemistry', 'biology', 'earth'], size: 40, minutes: 40 },
  { id: 'social', name: '社會', subjects: ['history', 'geography', 'civics'], size: 40, minutes: 30 },
];
export const PAPER_BY_ID = Object.fromEntries(PAPERS.map((p) => [p.id, p]));

/** 合科試卷裡各科的比重：111–115 學測逐題分析時各科的小題數（docs/exam-analysis.md） */
const SUBJECT_ITEMS = { physics: 94, chemistry: 81, biology: 87, earth: 79, history: 109, geography: 109, civics: 116 };

/**
 * 各單元在 111–115 學測的出題占比（%），由 docs/exam-analysis.md 的逐題分析算出：
 * 一題結合幾個單元就平均分給它們；數學含數 A、數 B 兩卷。沒列到的單元（占比 0）不出
 */
export const UNIT_SHARE = {
  chinese: { 字音字形: 5, 成語與詞語運用: 3, 文言字詞: 3, 修辭: 7, 核心古文: 12, 論孟選讀: 4, 詩詞曲: 8, 文學常識: 2, 應用文與語文常識: 6, 跨單元綜合: 52 },
  english: { 核心單字: 14, 進階單字: 21, 片語與搭配詞: 14, 詞性與構詞: 4, 時態與語態: 4, 子句與連接詞: 2, '不定詞、動名詞與分詞': 2, 假設語氣與特殊句構: 1, 轉折語與篇章: 36, 跨單元綜合: 2 },
  math: { 數與式: 6, 多項式函數: 9, 直線與圓: 12, 數列與級數: 7, 排列組合: 6, 機率: 8, 數據分析: 5, 三角比: 9, 三角函數: 5, 指數與對數: 7, 平面向量: 6, 空間向量與平面直線: 9, 矩陣: 6, '數B 專屬主題': 6 },
  physics: { 科學方法與單位: 10, 牛頓運動定律: 8, 克卜勒定律與萬有引力: 2, 基本交互作用: 4, 電與磁: 13, 波動與光: 22, 能量與能量守恆: 20, 質能互換與核能: 5, 量子現象: 7, 探究與實作: 7, 跨單元綜合: 2 },
  chemistry: { 物質的分類與組成: 9, 原子結構與同位素: 4, 週期表與元素性質: 2, 化學鍵與分子: 12, 莫耳與化學計量: 18, 化學反應與能量: 11, 溶液與溶解度: 9, '酸鹼與 pH': 8, 氧化還原: 7, 化學與能源及生活: 8, 探究與實作: 8, 跨單元綜合: 3 },
  biology: { 細胞構造與功能: 17, 細胞與能量: 7, 細胞分裂: 6, 孟德爾遺傳: 8, 'DNA 與生物技術': 20, 演化: 17, 生物多樣性與分類: 8, 生態: 5, 探究與實作: 11, 跨單元綜合: 1 },
  earth: { 宇宙與恆星: 8, 太陽系與天文現象: 16, 地球構造與板塊: 8, 岩石與地質作用: 13, 大氣與天氣: 22, 海洋: 17, 氣候變遷: 10, 天然災害與防災: 4, 探究與實作: 2, 跨單元綜合: 1 },
  history: { 史料與歷史解釋: 8, 臺灣史前與原住民族: 2, 荷西與鄭氏時期: 2, 清領臺灣: 10, 日治臺灣: 11, 戰後臺灣: 4, 中國與東亞的國家與社會: 15, 東亞的交流與近代化: 12, 東亞的戰爭與冷戰: 3, 古代與中古世界: 9, 近代世界的變革: 10, 帝國主義與世界大戰: 11, 戰後世界: 2 },
  geography: { 地理技能: 15, 地形: 9, 氣候與水文: 8, 人口: 8, 聚落與都市: 6, 產業與經濟活動: 21, 全球化與環境議題: 12, 區域地理: 21 },
  civics: { 公民身分與人權: 17, 社會與文化: 18, 民主政治與參與: 9, 政府與憲政: 12, 民法與生活: 6, 刑法與行政法: 11, 市場與價格: 16, 市場失靈與政府: 3, 國民所得與國際貿易: 8 },
};

/**
 * 把 n 題依權重分給各項（最大餘數法）：先給整數部分，剩下的依小數部分由大到小補一題
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>}
 */
export function allocate(weights, n) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (!total) return {};
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

/**
 * 抽一份考卷：各單元依占比分配題數，單元裡隨機抽單選題；單元題目不夠時從同一張卷的其他單元補。
 * 題目照科目排（合科試卷先物理再化學…），同一科裡打亂；每題的選項順序也先打亂、整場固定。
 * @param {object[]} bank
 * @param {{ excludedUnits?: string[], flags?: Record<string, unknown>, rng?: () => number }} [opts] 被回報的題目不出
 * @returns {{ ids: string[], orders: number[][] }}
 */
export function buildPaper(bank, paper, { excludedUnits = [], flags = {}, rng = Math.random } = {}) {
  const off = new Set(excludedUnits);
  const counts = allocate(paperWeights(paper, excludedUnits), paper.size);
  const pools = new Map(Object.keys(counts).map((k) => [k, []]));
  for (const q of bank) {
    if (q.type !== 'mc' || flags[q.id] || isUnitOff(q, off)) continue;
    pools.get(unitKey(q.subject, q.topic))?.push(q);
  }
  const picked = [];
  const spare = [];
  for (const [key, pool] of pools) {
    shuffle(pool, rng);
    picked.push(...pool.slice(0, counts[key]));
    spare.push(...pool.slice(counts[key]));
  }
  picked.push(...shuffle(spare, rng).slice(0, Math.max(0, paper.size - picked.length)));
  const ids = paper.subjects.flatMap((s) => shuffle(picked.filter((q) => q.subject === s), rng)).map((q) => q.id);
  return { ids, orders: ids.map(() => shuffle([0, 1, 2, 3], rng)) };
}

/** 開考：作答（原始選項索引，沒作答是 null）、標記稍後回看、每題花的秒數都從空白開始 */
export function newExam(paper, { ids, orders }, now) {
  return {
    paper: paper.id,
    ids,
    orders,
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
  if (!exam || typeof exam !== 'object' || !PAPER_BY_ID[exam.paper]) return false;
  const n = exam.ids?.length;
  const isPerm = (o) => Array.isArray(o) && o.length === 4 && [0, 1, 2, 3].every((i) => o.includes(i));
  return (
    n > 0 &&
    ['orders', 'answers', 'marks', 'spent'].every((k) => Array.isArray(exam[k]) && exam[k].length === n) &&
    exam.ids.every((id) => byId.get(id)?.type === 'mc') &&
    exam.orders.every(isPerm) &&
    exam.answers.every((a) => a === null || [0, 1, 2, 3].includes(a)) &&
    Number.isFinite(exam.elapsed) &&
    Number.isFinite(exam.limit) &&
    Number.isInteger(exam.index) &&
    exam.index >= 0 &&
    exam.index < n
  );
}

/**
 * 交卷後寫進排程的結果：答錯就是答錯；答對但標記過的（沒把握、想回頭看）算「不太確定」；沒作答的不記
 * @returns {'right' | 'wrong' | 'unsure' | null}
 */
export function examOutcome(item) {
  if (item.blank) return null;
  if (!item.right) return 'wrong';
  return item.marked ? 'unsure' : 'right';
}

/**
 * 對答案：每題的結果、各單元的得分與用時、答對與答錯的題平均花幾秒
 * @returns {{ total: number, right: number, wrong: number, blank: number, secs: number, limit: number,
 *   items: { id: string, q: object, answer: number | null, right: boolean, blank: boolean, marked: boolean, secs: number, order: number[], n: number }[],
 *   units: { subject: string, unit: string, total: number, right: number, secs: number }[],
 *   avgRight: number | null, avgWrong: number | null }}
 */
export function gradeExam(exam, byId) {
  const items = exam.ids.map((id, i) => {
    const q = byId.get(id);
    const answer = exam.answers[i];
    return { id, q, answer, right: answer === q.answer, blank: answer === null, marked: !!exam.marks[i], secs: exam.spent[i], order: exam.orders[i], n: i + 1 };
  });
  const units = new Map();
  for (const it of items) {
    const key = unitKey(it.q.subject, it.q.topic);
    const u = units.get(key) ?? units.set(key, { subject: it.q.subject, unit: it.q.topic, total: 0, right: 0, secs: 0 }).get(key);
    u.total++;
    u.secs += it.secs;
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
  log.push({ paper: paperId, at: now, total: result.total, right: result.right, blank: result.blank, secs: Math.round(result.secs) });
  if (log.length > KEEP_EXAMS) log.splice(0, log.length - KEEP_EXAMS);
  return prev;
}
