// 科目設定：題庫檔名 = `src/data/questions/<id>.json`，題目 id 以 `<id>-` 開頭。
// 這個檔案不能依賴瀏覽器 API，驗證腳本也會在 Node 端 import 它。
// color 同時是貓咪圍巾的顏色，要在米色紙底上看得清楚。
export const SUBJECTS = [
  { id: 'chinese', name: '國文', group: '語文', color: '#f0705f' },
  { id: 'english', name: '英文', group: '語文', color: '#3aa8d8' },
  { id: 'math', name: '數學', group: '數學', color: '#f2b632' },
  { id: 'physics', name: '物理', group: '自然', color: '#8d72e1' },
  { id: 'chemistry', name: '化學', group: '自然', color: '#22b5a3' },
  { id: 'biology', name: '生物', group: '自然', color: '#6dbf4b' },
  { id: 'earth', name: '地科', group: '自然', color: '#f08a3c' },
  { id: 'history', name: '歷史', group: '社會', color: '#e9649f' },
  { id: 'geography', name: '地理', group: '社會', color: '#5b7fe6' },
  { id: 'civics', name: '公民', group: '社會', color: '#a77b5b' },
];

export const SUBJECT_BY_ID = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
