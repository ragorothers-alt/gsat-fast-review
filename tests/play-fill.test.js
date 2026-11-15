import { describe, expect, it } from 'vitest';
import { FILL_MAX, fillHTML, fillKeyFor, fillProblem, typeFillKey } from '../src/ui/play-fill.js';

/** 從空白開始依序按這些鍵；超過字數的那一鍵不算 */
const type = (...keys) => keys.reduce((t, k) => typeFillKey(t, k) ?? t, '');

describe('演算題填答：按鍵之後的答案字串', () => {
  it('數字照打，刪除去掉最後一個字', () => {
    expect(type('1', '2', '3')).toBe('123');
    expect(type('1', '2', 'back')).toBe('1');
    expect(type('back')).toBe('');
  });

  it('負號是切換：再按一次拿掉，隨時可以按', () => {
    expect(type('-')).toBe('-');
    expect(type('3', '-')).toBe('-3');
    expect(type('3', '-', '-')).toBe('3');
    expect(type('7', '/', '4', '-')).toBe('-7/4');
  });

  it('分數線前面要有數字，而且只能有一條', () => {
    expect(type('/')).toBe('');
    expect(type('-', '/')).toBe('-');
    expect(type('7', '/')).toBe('7/');
    expect(type('7', '/', '/')).toBe('7/');
    expect(type('7', '/', '4', '/')).toBe('7/4');
    expect(type('2', '.', '/')).toBe('2.');
  });

  it('小數點：分子、分母各自最多一個，還沒有數字就補 0', () => {
    expect(type('.')).toBe('0.');
    expect(type('-', '.')).toBe('-0.');
    expect(type('2', '.', '5', '.')).toBe('2.5');
    expect(type('1', '.', '5', '/', '.', '5')).toBe('1.5/0.5');
    expect(type('1', '/', '2', '.', '.')).toBe('1/2.');
  });

  it(`最多 ${FILL_MAX} 個字：超過的那一鍵回傳 null，刪除還是可以`, () => {
    const full = '1'.repeat(FILL_MAX);
    expect(typeFillKey(full, '2')).toBeNull();
    expect(typeFillKey(full, '-')).toBeNull();
    expect(typeFillKey(full, 'back')).toBe(full.slice(0, -1));
    expect(typeFillKey(full.slice(0, -1), '2')).toBe(`${full.slice(0, -1)}2`);
    // 還沒有數字時小數點一次補兩個字（0.）
    expect(typeFillKey(`${'1'.repeat(FILL_MAX - 2)}/`, '.')).toBeNull();
  });

  it('不認得的鍵不改變內容', () => {
    expect(typeFillKey('12', 'ok')).toBe('12');
    expect(typeFillKey('12', 'a')).toBe('12');
  });
});

describe('演算題填答：沒填完時缺什麼', () => {
  it('空的、只有負號、完整的數都不提示；分數少分母、小數點後沒數字、分母是 0 各有說法', () => {
    for (const t of [null, '', '-', '3', '-2.5', '7/4', '0.5/2']) expect(fillProblem(t)).toBeNull();
    expect(fillProblem('1/')).toBe('分數還缺分母');
    expect(fillProblem('-7/')).toBe('分數還缺分母');
    expect(fillProblem('2.')).toBe('小數點後面還沒填');
    expect(fillProblem('1/2.')).toBe('小數點後面還沒填');
    expect(fillProblem('3/0')).toBe('分母不能是 0');
    expect(fillProblem('3/0.0')).toBe('分母不能是 0');
  });
});

describe('演算題填答：實體鍵盤', () => {
  it('數字、小數點、負號、分數線照打，Backspace 刪除、Enter 送出', () => {
    for (const k of ['0', '9', '.', '-', '/']) expect(fillKeyFor(k)).toBe(k);
    expect(fillKeyFor('Backspace')).toBe('back');
    expect(fillKeyFor('Enter')).toBe('ok');
  });

  it('其他的鍵不是填答用的', () => {
    for (const k of ['a', '?', ' ', 'Tab', 'ArrowLeft', '10', 'Delete']) expect(fillKeyFor(k)).toBeNull();
  });
});

describe('演算題填答：鍵盤的 HTML', () => {
  it('十個數字、小數點、負號、分數線、刪除與送出各一顆，符號鍵有給螢幕閱讀器的名稱', () => {
    const html = fillHTML();
    const keys = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...'0123456789', '.', '-', '/', 'back', 'ok'].sort());
    for (const name of ['刪除', '負號', '分數線', '小數點']) expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain('class="fill-value"');
    expect(html).toContain('class="fill-switch"');
  });

  it('模擬考的選填題：同一組按鍵，但沒有「改用選項作答」，送出鍵寫「填好了」', () => {
    const html = fillHTML({ exam: true });
    const keys = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...'0123456789', '.', '-', '/', 'back', 'ok'].sort());
    expect(html).not.toContain('fill-switch');
    expect(html).toContain('data-k="ok">填好了<');
    expect(fillHTML()).toContain('data-k="ok">送出<');
  });
});
