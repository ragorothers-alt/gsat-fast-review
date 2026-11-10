// 把一題整理成可以直接貼給 ChatGPT 等 AI 家教的文字。純邏輯，方便測試。
import { figureText } from './figure.js';
import { isBank } from './groups.js';
import { SUBJECT_BY_ID } from './subjects.js';
import { topicLabel } from './units.js';

// 共用選項的題組（文意選填、篇章結構）最多 8 個選項
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const KIND = { tf: '是非題', mc: '單選題', ms: '多選題' };
/** 克漏字的空格 __3__ → (3)：貼給 AI 時不會被當成 Markdown 的粗體 */
const blanks = (text) => text.replace(/__(\d+)__/g, '($1)');

/**
 * @param {object} q 題目
 * @param {{ order?: number[], outcome?: 'right'|'wrong'|'skip'|'review' | null, chosen?: number | number[] | boolean | null, typed?: string }} [opts]
 *   order：畫面上第 i 個選項 → 原始選項索引，讓 (A)–(E) 跟玩家看到的一致
 *   outcome / chosen：作答後才有（chosen 為原始選項索引、多選題的索引陣列或 true/false），會附上玩家的答案、正解與解析；
 *   typed：演算題自己填的答案；review：從錯題本複製，沒有當時選的答案
 */
export function questionPrompt(q, { order = q.choices?.map((_, i) => i) ?? [], outcome = null, chosen = null, typed } = {}) {
  const subject = SUBJECT_BY_ID[q.subject]?.name ?? q.subject;
  const one = (value) => `(${LETTERS[order.indexOf(value)]}) ${q.choices[value]}`;
  const label = (value) => {
    if (q.type === 'tf') return value ? '正確' : '錯誤';
    if (q.type === 'ms') return value?.length ? [...value].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(one).join('、') : '沒有選';
    return one(value);
  };

  const lines = [`這是一題台灣學測（${subject}・${topicLabel(q)}）的${KIND[q.type]}${q.type === 'ms' ? '（選出所有正確的選項）' : ''}：`, ''];
  // 閱讀題組：先附上整篇文章（克漏字的空格 __3__ 寫成 (3)），題目才看得懂
  if (q.group) lines.push(`閱讀下文，回答問題${/__\d+__/.test(q.passage) ? '（文中的 (1)、(2)… 是空格）' : ''}：`, blanks(q.passage), '');
  if (isBank(q)) lines.push(`（這組的 ${q.choices.length} 個選項是每一格共用的，每個選項最多填一格，有的選項用不到。）`);
  // 圖表題：AI 看不到圖，把圖裡的數據寫成文字
  const fig = q.fig ? [`（題目附的${figureText(q.fig)}）`] : [];
  if (q.type === 'tf') lines.push(`判斷下列敘述是否正確：${q.q}`, ...fig);
  else if (q.group) lines.push(blanks(q.q), ...fig, ...order.map((orig, i) => `(${LETTERS[i]}) ${q.choices[orig]}`));
  else lines.push(q.q, ...fig, ...order.map((orig, i) => `(${LETTERS[i]}) ${q.choices[orig]}`));

  if (!outcome) {
    lines.push('', '請一步一步教我怎麼解這題：先說明用到的觀念，再帶我推出答案。');
    return lines.join('\n');
  }

  lines.push('');
  if (outcome === 'skip') lines.push('我的答案：不會，直接看了解答');
  else if (outcome !== 'review') lines.push(`我的答案：${typed !== undefined && (chosen === null || chosen === undefined) ? `自己算出 ${typed}（不是任何一個選項）` : label(chosen)}`);
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
