// 把 questions/ 底下所有科目題庫打包進來（建置時就決定，不需網路）
import { SUBJECTS } from '../subjects.js';

const modules = import.meta.glob('./questions/*.json', { eager: true, import: 'default' });
const order = new Map(SUBJECTS.map((s, i) => [s.id, i]));

export const BANK = Object.values(modules)
  .flat()
  .sort((a, b) => order.get(a.subject) - order.get(b.subject));
