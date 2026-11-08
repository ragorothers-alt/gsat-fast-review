import { describe, expect, it } from 'vitest';
import {
  KEEP_ABOVE,
  addStroke,
  clampScroll,
  clearPage,
  createBook,
  inkBottom,
  maxScroll,
  openPage,
  pathLength,
  redo,
  snapLine,
  undo,
  visible,
} from '../src/scratch-pad.js';

/** 一筆從 (x, y0) 畫到 (x, y1) 的直線，筆寬 w */
const stroke = (y0, y1 = y0, { tool = 'ink', w = 2, x = 10 } = {}) => ({ tool, pts: [{ x, y: y0, w }, { x: x + 5, y: y1, w }], done: true });

describe('草稿區的頁', () => {
  it('每題一頁：回到同一題還是那頁；沒寫東西的頁離開就不留', () => {
    const book = createBook();
    const p1 = openPage(book, 'q1');
    addStroke(p1, stroke(5));
    openPage(book, 'q2');
    const p3 = openPage(book, 'q3');
    expect([...book.pages.keys()]).toEqual(['q1', 'q3']);
    expect(openPage(book, 'q1')).toBe(p1);
    expect(visible(p1)).toHaveLength(1);
    expect(openPage(book, 'q3')).not.toBe(p3);
  });

  it('頁數超過上限時丟掉最久沒翻到的頁，目前這頁不丟', () => {
    const book = createBook(3);
    for (const k of ['a', 'b', 'c']) addStroke(openPage(book, k), stroke(1));
    addStroke(openPage(book, 'a'), stroke(2));
    addStroke(openPage(book, 'd'), stroke(3));
    expect([...book.pages.keys()]).toEqual(['c', 'a', 'd']);
  });

  it('復原、重做：畫新的一筆後就不能重做', () => {
    const page = openPage(createBook(), 'q');
    addStroke(page, stroke(1));
    addStroke(page, stroke(2));
    expect(undo(page)).toBe(true);
    expect(visible(page)).toHaveLength(1);
    expect(redo(page)).toBe(true);
    expect(visible(page)).toHaveLength(2);
    expect(redo(page)).toBe(false);
    undo(page);
    addStroke(page, stroke(3));
    expect(page.redo).toHaveLength(0);
    expect(visible(page).map((s) => s.pts[0].y)).toEqual([1, 3]);
    undo(page);
    undo(page);
    expect(undo(page)).toBe(false);
  });

  it('清空可以復原：回到清空前捲到的位置；空白頁不能清空', () => {
    const page = openPage(createBook(), 'q');
    expect(clearPage(page)).toBe(false);
    addStroke(page, stroke(500));
    page.scroll = 240;
    expect(clearPage(page)).toBe(true);
    expect(visible(page)).toHaveLength(0);
    expect(page.scroll).toBe(0);
    expect(clearPage(page)).toBe(false);
    undo(page);
    expect(visible(page)).toHaveLength(1);
    expect(page.scroll).toBe(240);
    redo(page);
    expect(visible(page)).toHaveLength(0);
    expect(page.scroll).toBe(0);
  });
});

describe('草稿紙往下捲', () => {
  const H = 300;

  it('寫到可視高度一半以下才能捲；最低的筆跡最多捲到畫面上方 30%', () => {
    const page = openPage(createBook(), 'q');
    addStroke(page, stroke(100, 140));
    expect(inkBottom(page)).toBe(141);
    expect(maxScroll(page, H)).toBe(0);
    addStroke(page, stroke(200, 260, { w: 4 }));
    expect(maxScroll(page, H)).toBe(262 - H * KEEP_ABOVE);
  });

  it('橡皮擦不算筆跡；清空後不能捲', () => {
    const page = openPage(createBook(), 'q');
    addStroke(page, stroke(280, 290, { tool: 'eraser', w: 28 }));
    expect(maxScroll(page, H)).toBe(0);
    addStroke(page, stroke(280, 290));
    expect(maxScroll(page, H)).toBeGreaterThan(0);
    clearPage(page);
    expect(maxScroll(page, H)).toBe(0);
  });

  it('捲動不超出範圍；已經在範圍外時（復原掉下面的筆跡）停在原地', () => {
    const page = openPage(createBook(), 'q');
    addStroke(page, stroke(250));
    const max = maxScroll(page, H);
    expect(clampScroll(page, -50, H)).toBe(0);
    expect(clampScroll(page, 9999, H)).toBe(max);
    page.scroll = max;
    undo(page);
    expect(clampScroll(page, 9999, H)).toBe(max);
    expect(clampScroll(page, 10, H)).toBe(10);
  });
});

describe('拉直線', () => {
  it('接近水平、垂直、45° 時對齊，長度不變；其他角度照原樣', () => {
    const a = { x: 0, y: 0 };
    expect(snapLine(a, { x: 100, y: 5 })).toEqual({ x: 100.12, y: 0 });
    expect(snapLine(a, { x: -4, y: 80 })).toEqual({ x: 0, y: 80.1 });
    expect(snapLine(a, { x: 60, y: -57 })).toEqual({ x: 58.52, y: -58.52 });
    expect(snapLine(a, { x: 100, y: 30 })).toEqual({ x: 100, y: 30 });
    expect(snapLine(a, a)).toEqual({ x: 0, y: 0 });
  });

  it('筆劃長度是相鄰點距離的總和', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
  });
});
