// 把一題整理成可以直接貼給 ChatGPT 等 AI 家教的文字。純邏輯，方便測試。
import { SUBJECT_BY_ID } from './subjects.js';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * @param {object} q 題目
 * @param {{ order?: number[], outcome?: 'right'|'wrong'|'skip'|'review' | null, chosen?: number | boolean | null }} [opts]
 *   order：畫面上第 i 個選項 → 原始選項索引，讓 (A)–(D) 跟玩家看到的一致
 *   outcome / chosen：作答後才有（chosen 為原始選項索引或 true/false），會附上玩家的答案、正解與解析；
 *   review：從錯題本複製，沒有當時選的答案
 */
export function questionPrompt(q, { order = [0, 1, 2, 3], outcome = null, chosen = null } = {}) {
  const subject = SUBJECT_BY_ID[q.subject]?.name ?? q.subject;
  const label = (value) =>
    q.type === 'tf' ? (value ? '正確' : '錯誤') : `(${LETTERS[order.indexOf(value)]}) ${q.choices[value]}`;

  const lines = [`這是一題台灣學測（${subject}・${q.topic}）的${q.type === 'tf' ? '是非題' : '單選題'}：`, ''];
  if (q.type === 'tf') lines.push(`判斷下列敘述是否正確：${q.q}`);
  else lines.push(q.q, ...order.map((orig, i) => `(${LETTERS[i]}) ${q.choices[orig]}`));

  if (!outcome) {
    lines.push('', '請一步一步教我怎麼解這題：先說明用到的觀念，再帶我推出答案。');
    return lines.join('\n');
  }

  lines.push('');
  if (outcome === 'skip') lines.push('我的答案：不會，直接看了解答');
  else if (outcome !== 'review') lines.push(`我的答案：${label(chosen)}`);
  lines.push(`正確答案：${label(q.answer)}`, `題目附的解析：${q.explain}`, '');
  if (outcome === 'right') {
    lines.push(
      q.type === 'tf'
        ? '我答對了，但想確定觀念。請解釋這題的關鍵觀念，並說明這類敘述常見的陷阱。'
        : '我答對了，但想確定觀念。請解釋這題的關鍵觀念，以及其他選項各錯在哪裡。',
    );
  } else if (outcome === 'review') {
    lines.push(`這題我之前答錯過。請一步一步解釋為什麼正確答案是「${label(q.answer)}」，說明這題容易混淆的地方，再給我一個記住它的方法。`);
  } else if (outcome === 'wrong') {
    lines.push(`我答錯了。請一步一步解釋為什麼正確答案是「${label(q.answer)}」，告訴我錯在哪裡，以及下次怎麼避免。`);
  } else {
    lines.push('我不會這題。請一步一步教我怎麼解，說明用到的觀念，再給我一個記住它的方法。');
  }
  return lines.join('\n');
}
