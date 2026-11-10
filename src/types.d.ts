// 共用的型別：給 JSDoc 註解用（npm run typecheck），不會被打包，也不影響執行。
// 這個檔案沒有 import／export，所以裡面的宣告都是全域的，各個 .js 的 JSDoc 可以直接寫 {Question}、{Card}。

/** 圖表題的座標軸（docs/question-spec.md〈圖表題〉）。cats 只有長條圖的橫軸有 */
interface FigureAxis {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  cats?: string[];
}

/** 圖表題的一組資料：折線與散布圖用 points，長條圖用 values */
interface FigureSeries {
  name?: string;
  points?: [number, number][];
  values?: number[];
  smooth?: boolean;
  dashed?: boolean;
}

/** 折線圖、散布圖上的標記點 */
interface FigureMark {
  x: number;
  y: number;
  label: string;
}

/**
 * 題目的 fig 欄位：畫成圖或表的資料（src/figure.js）。
 * 各種類用到的欄位不同（line／scatter／bar：x、y、series；climate：temp、rain；table：cols、rows），這裡不細分。
 */
interface Figure {
  type: 'line' | 'scatter' | 'bar' | 'climate' | 'table';
  title?: string;
  x?: FigureAxis;
  y?: FigureAxis;
  series?: FigureSeries[];
  marks?: FigureMark[];
  temp?: number[];
  rain?: number[];
  cols?: string[];
  rows?: (string | number)[][];
}

/** 題庫的一題（欄位說明見 docs/question-spec.md） */
interface Question {
  id: string;
  subject: string;
  topic: string;
  type: 'mc' | 'tf' | 'ms';
  q: string;
  /** mc、ms 才有；tf 沒有 */
  choices?: string[];
  /** mc：正確選項的索引；tf：true／false；ms：正確選項索引的陣列 */
  answer: number | boolean | number[];
  explain: string;
  formula: boolean;
  level: 1 | 2 | 3;
  /** 跨單元綜合題結合的單元 */
  links?: string[];
  /** 演算題 */
  scratch?: true;
  /** 閱讀題組的代號與共用的文章 */
  group?: string;
  passage?: string;
  /** 英文單字題在《高中英文參考詞彙表》的級數 */
  lv?: number;
  /** 圖表題的資料 */
  fig?: Figure;
}

/** 一題的作答紀錄與排程（srs.js 的 schedule）。missed、last 是後來才加的欄位，舊紀錄可能沒有 */
interface Card {
  box: number;
  due: number;
  seen: number;
  right: number;
  wrong: number;
  parked: boolean;
  missed?: number;
  last?: number;
}

/**
 * 存檔的 state（storage.js）。只列出同步、備份會用到的幾個欄位，其餘（settings、path、exam、cloud…）不細分。
 */
interface AppState {
  cards: Record<string, Card>;
  daily: Record<string, { answered: number; right: number }>;
  streak: { count: number; last: string | null };
  best: { blitz: number; [mode: string]: any };
  [key: string]: any;
}

// vite.config.js 的 define：建置時換成字串；直接跑原始碼（測試）時沒有這兩個變數
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

/** Vite 的 import.meta.env；不是透過 Vite 執行時沒有 env */
interface ImportMetaEnv {
  PROD?: boolean;
  DEV?: boolean;
  [key: string]: any;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
