// 結算畫面與錯題本共用的題目卡：科目、單元、複製與回報按鈕、題目、正解與解析
import { SUBJECT_BY_ID } from '../subjects.js';
import { icon } from './icons.js';
import { richHTML } from './rich.js';

/** 是非題的答案：手繪圈叉加字 */
export const tfLabel = (v) => (v ? `${icon('ok')}對` : `${icon('ng')}錯`);

/**
 * @param {object} q 題目
 * @param {{ index: number, flagged: boolean, note: string }} opts
 *   index：複製按鈕對應的位置；note：正解前面那一段（你選了什麼、錯過幾次…）的 HTML
 */
export function reviewItem(q, { index, flagged, note }) {
  const subj = SUBJECT_BY_ID[q.subject];
  const answer = q.type === 'tf' ? tfLabel(q.answer) : richHTML(q.choices[q.answer]);
  return `<li class="r-item" style="--c:${subj.color}">
    <div class="card-tag"><span class="tag">${subj.name}</span><span class="topic">${q.topic}</span><button type="button" class="copy-btn" data-copy="${index}" aria-label="複製題目（可以貼給 ChatGPT 問）">${icon('copy')}</button><button type="button" class="flag-btn" data-flag="${q.id}" aria-pressed="${flagged}" aria-label="回報這題有問題">${icon('flag')}</button></div>
    <div class="r-q">${richHTML(q.q)}</div>
    <div class="r-ans">${note}<span class="r-right">正解：${answer}</span></div>
    <div class="r-explain">${richHTML(q.explain)}</div>
  </li>`;
}
