// 第一次開啟的設定（考哪些科、學測日期、每天想做幾題）要不要顯示、有哪些選項。純邏輯，不碰 DOM；畫面在 ui/welcome.js。
import { SUBJECTS } from './subjects.js';

/** localStorage 的旗標：看過（按了「開始練習」或「之後再說」）就記下時間，之後不再顯示 */
export const WELCOME_KEY = 'gsat-quiz:welcome';

const CORE = ['chinese', 'english', 'math'];
const inGroup = (group) => SUBJECTS.filter((s) => s.group === group).map((s) => s.id);

/** 「考哪些科？」的快速選擇：自然組、社會組都含國英數 */
export const TRACKS = [
  { id: 'science', name: '自然組', subjects: [...CORE, ...inGroup('自然')] },
  { id: 'social', name: '社會組', subjects: [...CORE, ...inGroup('社會')] },
  { id: 'all', name: '全部', subjects: SUBJECTS.map((s) => s.id) },
];

/** 「每天想做幾題？」的選項（設定裡的每日目標還能選到 120 題） */
export const WELCOME_GOALS = [10, 20, 30, 50];

/**
 * 要不要顯示第一次開啟的設定：這台裝置沒有任何作答紀錄，而且沒看過。
 * 已經有紀錄的舊使用者不顯示；從同步碼或匯入還原進度的人，下次開啟時已經有紀錄，也不會顯示。
 * @param {{ cards: Record<string, unknown> }} state
 * @param {boolean} seen 這台裝置記過 WELCOME_KEY
 */
export function needsWelcome(state, seen) {
  return !seen && Object.keys(state.cards ?? {}).length === 0;
}

/** 選的科目剛好是哪一個快速選擇（順序不拘）；都不是就是 null */
export function trackOf(subjects) {
  const picked = new Set(subjects);
  return TRACKS.find((t) => t.subjects.length === picked.size && t.subjects.every((id) => picked.has(id)))?.id ?? null;
}

/** 照科目表的順序排好、去掉不認得的科目（存進設定前整理） */
export function orderSubjects(subjects) {
  const picked = new Set(subjects);
  return SUBJECTS.map((s) => s.id).filter((id) => picked.has(id));
}
