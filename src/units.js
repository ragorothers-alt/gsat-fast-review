// 各科單元：題目的 topic 必須是該科清單裡的名稱，清單順序就是畫面上的排列順序。
// 跟 subjects.js 一樣不能依賴瀏覽器 API，驗證腳本會在 Node 端 import 它。

/** 每個單元至少要有幾題，驗證器會擋下不足的單元 */
export const MIN_PER_UNIT = 100;

/** 跨單元題的單元：題目另外用 links 標出結合了同科哪幾個單元 */
export const CROSS_UNIT = '跨單元綜合';
/** 自然科學探究與實作（部定必修）：各科各自用自己的實驗情境出題 */
const INQUIRY_UNIT = '探究與實作';
const MATH_B_UNIT = '數B 專屬主題';

export const UNITS = {
  chinese: ['字音字形', '成語與詞語運用', '文言字詞', '修辭', '核心古文', '論孟選讀', '詩詞曲', '文學常識', '應用文與語文常識', CROSS_UNIT],
  english: [
    '核心單字',
    '進階單字',
    '片語與搭配詞',
    '詞性與構詞',
    '時態與語態',
    '子句與連接詞',
    '不定詞、動名詞與分詞',
    '假設語氣與特殊句構',
    '轉折語與篇章',
    CROSS_UNIT,
  ],
  math: [
    '數與式',
    '多項式函數',
    '直線與圓',
    '數列與級數',
    '排列組合',
    '機率',
    '數據分析',
    '三角比',
    '三角函數',
    '指數與對數',
    '平面向量',
    '空間向量與平面直線',
    '矩陣',
    // 學測數學 B 才考的內容（11 年級 B 類），只考數學 A 的人可以關掉
    MATH_B_UNIT,
    CROSS_UNIT,
  ],
  physics: [
    '科學方法與單位',
    '牛頓運動定律',
    '克卜勒定律與萬有引力',
    '基本交互作用',
    '電與磁',
    '波動與光',
    '能量與能量守恆',
    '質能互換與核能',
    '量子現象',
    INQUIRY_UNIT,
    CROSS_UNIT,
  ],
  chemistry: [
    '物質的分類與組成',
    '原子結構與同位素',
    '週期表與元素性質',
    '化學鍵與分子',
    '莫耳與化學計量',
    '化學反應與能量',
    '溶液與溶解度',
    '酸鹼與 pH',
    '氧化還原',
    '化學與能源及生活',
    INQUIRY_UNIT,
    CROSS_UNIT,
  ],
  biology: ['細胞構造與功能', '細胞與能量', '細胞分裂', '孟德爾遺傳', 'DNA 與生物技術', '演化', '生物多樣性與分類', '生態', INQUIRY_UNIT, CROSS_UNIT],
  earth: [
    '宇宙與恆星',
    '太陽系與天文現象',
    '地球構造與板塊',
    '岩石與地質作用',
    '大氣與天氣',
    '海洋',
    '氣候變遷',
    '天然災害與防災',
    INQUIRY_UNIT,
    CROSS_UNIT,
  ],
  history: [
    // 課綱第一冊開頭的「如何認識過去」：史料、立場與歷史解釋
    '史料與歷史解釋',
    '臺灣史前與原住民族',
    '荷西與鄭氏時期',
    '清領臺灣',
    '日治臺灣',
    '戰後臺灣',
    '中國與東亞的國家與社會',
    '東亞的交流與近代化',
    '東亞的戰爭與冷戰',
    '古代與中古世界',
    '近代世界的變革',
    '帝國主義與世界大戰',
    '戰後世界',
    CROSS_UNIT,
  ],
  geography: ['地理技能', '地形', '氣候與水文', '人口', '聚落與都市', '產業與經濟活動', '全球化與環境議題', '區域地理', CROSS_UNIT],
  civics: [
    '公民身分與人權',
    '社會與文化',
    '民主政治與參與',
    '政府與憲政',
    '民法與生活',
    '刑法與行政法',
    '市場與價格',
    '市場失靈與政府',
    '國民所得與國際貿易',
    CROSS_UNIT,
  ],
};

/** 單元的唯一鍵，存檔裡用它記住哪些單元被關掉 */
export const unitKey = (subject, unit) => `${subject}/${unit}`;

/** 畫面上的單元名稱：跨單元題列出結合了哪幾個單元 */
export const topicLabel = (q) => (q.links?.length ? `跨單元：${q.links.join('＋')}` : q.topic);

/**
 * 這題是不是因為單元被關掉而不出（off 是 unitKey 的 Set）。
 * 跨單元題結合的單元有一個被關掉也不出（多半是還沒學到）；
 * 但這科只留「跨單元綜合」時就是想專練跨單元題，全部照出。
 */
export function isUnitOff(q, off) {
  if (off.has(unitKey(q.subject, q.topic))) return true;
  if (!q.links) return false;
  const others = UNITS[q.subject].filter((u) => u !== CROSS_UNIT);
  if (others.every((u) => off.has(unitKey(q.subject, u)))) return false;
  return q.links.some((u) => off.has(unitKey(q.subject, u)));
}
