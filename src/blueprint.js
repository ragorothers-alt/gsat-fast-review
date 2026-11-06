// 學測的出題藍圖：五張考卷各含哪些科目、合科試卷裡各科的比重、各單元的出題占比。
// 模擬考（exam.js）照它組卷，出新題（priority.js）照它決定先練哪些單元。純資料，不碰 DOM。

/** 每張考卷含哪些科目；五張卷的級分各占一份 */
export const PAPER_SUBJECTS = {
  chinese: ['chinese'],
  english: ['english'],
  math: ['math'],
  science: ['physics', 'chemistry', 'biology', 'earth'],
  social: ['history', 'geography', 'civics'],
};

/** 科目屬於哪一張考卷 */
export const PAPER_OF = Object.fromEntries(Object.entries(PAPER_SUBJECTS).flatMap(([paper, subjects]) => subjects.map((s) => [s, paper])));

/** 合科試卷裡各科的比重：111–115 學測逐題分析時各科的小題數（docs/exam-analysis.md） */
export const SUBJECT_ITEMS = { physics: 94, chemistry: 81, biology: 87, earth: 79, history: 109, geography: 109, civics: 116 };

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
 * 選了這幾科時，各科在學測裡的分量：每張考卷一樣重（級分各占一份），合科試卷再依各科小題數分。
 * 例如選了數學和自然四科：數學 1/2，物理、化學、生物、地科合起來 1/2。
 * @returns {Record<string, number>} 合計為 1
 */
export function subjectWeights(subjects) {
  const papers = [...new Set(subjects.map((s) => PAPER_OF[s]).filter(Boolean))];
  const out = {};
  for (const paper of papers) {
    const inPaper = PAPER_SUBJECTS[paper].filter((s) => subjects.includes(s));
    const total = inPaper.reduce((a, s) => a + (SUBJECT_ITEMS[s] ?? 1), 0);
    for (const s of inPaper) out[s] = (SUBJECT_ITEMS[s] ?? 1) / total / papers.length;
  }
  return out;
}
