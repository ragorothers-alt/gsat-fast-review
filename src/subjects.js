// 科目設定：題庫檔名 = `src/data/questions/<id>.json`，題目 id 以 `<id>-` 開頭。
// 這個檔案不能依賴瀏覽器 API，驗證腳本也會在 Node 端 import 它。
export const SUBJECTS = [
  { id: 'chinese', name: '國文', group: '語文', color: '#ff7b6b' },
  { id: 'english', name: '英文', group: '語文', color: '#38d6ff' },
  { id: 'math', name: '數學', group: '數學', color: '#ffd166' },
  { id: 'physics', name: '物理', group: '自然', color: '#a78bfa' },
  { id: 'chemistry', name: '化學', group: '自然', color: '#2dd4bf' },
  { id: 'biology', name: '生物', group: '自然', color: '#86d96b' },
  { id: 'earth', name: '地科', group: '自然', color: '#f4a259' },
  { id: 'history', name: '歷史', group: '社會', color: '#f472b6' },
  { id: 'geography', name: '地理', group: '社會', color: '#6d8bff' },
  { id: 'civics', name: '公民', group: '社會', color: '#e2e8f0' },
];

export const SUBJECT_BY_ID = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
