// 結算畫面與錯題本共用的題目卡：科目、單元、發音／收藏／複製／回報按鈕、題目、正解與解析
import { SUBJECT_BY_ID } from '../subjects.js';
import { setFlag, setStar } from '../sync.js';
import { icon } from './icons.js';
import { richHTML } from './rich.js';
import { canSpeak, speak, speechText } from './speech.js';

/** 是非題的答案：手繪圈叉加字 */
export const tfLabel = (v) => (v ? `${icon('ok')}對` : `${icon('ng')}錯`);

/**
 * @param {object} q 題目
 * @param {{ index: number, flagged: boolean, starred: boolean, note: string }} opts
 *   index：複製、發音按鈕對應的位置；note：正解前面那一段（你選了什麼、錯過幾次…）的 HTML
 */
export function reviewItem(q, { index, flagged, starred, note }) {
  const subj = SUBJECT_BY_ID[q.subject];
  const answer = q.type === 'tf' ? tfLabel(q.answer) : richHTML(q.choices[q.answer]);
  return `<li class="r-item" style="--c:${subj.color}">
    <div class="card-tag"><span class="tag">${subj.name}</span><button type="button" class="topic topic-link" data-kp="${q.subject}/${q.topic}" title="看這個單元的考前重點">${q.topic}</button>${canSpeak(q) ? `<button type="button" class="speak-btn" data-speak="${index}" aria-label="念出這句英文">${icon('speaker')}</button>` : ''}<button type="button" class="star-btn" data-star="${q.id}" aria-pressed="${starred}" aria-label="收藏這題">${icon('star')}</button><button type="button" class="copy-btn" data-copy="${index}" aria-label="複製題目（可以貼給 ChatGPT 問）">${icon('copy')}</button><button type="button" class="flag-btn" data-flag="${q.id}" aria-pressed="${flagged}" aria-label="回報這題有問題">${icon('flag')}</button></div>
    <div class="r-q">${richHTML(q.q)}</div>
    <div class="r-ans">${note}<span class="r-right">正解：${answer}</span></div>
    <div class="r-explain">${richHTML(q.explain)}</div>
  </li>`;
}

/** 題目卡上的發音按鈕：念出填好正解的英文句子；點到的不是發音按鈕就回傳 false */
export function speakItem(target, items) {
  const btn = target.closest('[data-speak]');
  if (!btn) return false;
  const q = items[Number(btn.dataset.speak)];
  if (q) speak(speechText(q, { filled: true }));
  return true;
}

/**
 * 題目卡上的收藏、回報按鈕：切換標記、存檔、提示。點到的不是這兩種按鈕就回傳 null，
 * 否則回傳 { kind, id, on }，讓呼叫的畫面決定要不要重畫。
 */
export function toggleMark(ctx, target) {
  const btn = target.closest('[data-star], [data-flag]');
  if (!btn) return null;
  const kind = btn.dataset.star ? 'stars' : 'flags';
  const id = btn.dataset.star ?? btn.dataset.flag;
  const on = !ctx.state[kind][id];
  (kind === 'stars' ? setStar : setFlag)(ctx.state, id, on, Date.now());
  ctx.save();
  btn.setAttribute('aria-pressed', String(on));
  if (kind === 'stars') ctx.toast(on ? '已收藏，在錯題本的「收藏」找得到' : '已取消收藏');
  else ctx.toast(on ? '已回報這題，之後先不出' : '已取消回報');
  return { kind, id, on };
}
