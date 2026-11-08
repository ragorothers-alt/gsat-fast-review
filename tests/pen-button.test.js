import { describe, expect, it } from 'vitest';
import { CLICK_MS, createPenButton, isAirPress } from '../src/pen-button.js';

const pen = (type, buttons, timeStamp) => ({ type, pointerType: 'pen', buttons, timeStamp });
const run = (events) => {
  const b = createPenButton();
  return events.map((e) => b.handle(e)).filter(Boolean);
};

describe('觸控筆側鍵：Android 的 Chrome（懸空時只在 pointermove 的 buttons 看得到）', () => {
  it('懸空按一下：buttons 0 → 1 → 0', () => {
    expect(run([pen('pointermove', 0, 0), pen('pointermove', 1, 10), pen('pointermove', 1, 60), pen('pointermove', 0, 150)])).toEqual(['press', 'click']);
  });

  it('有的機型回報 2 或 3，一樣算', () => {
    expect(run([pen('pointermove', 2, 0), pen('pointermove', 0, 100)])).toEqual(['press', 'click']);
    expect(run([pen('pointermove', 3, 0), pen('pointermove', 3, 50), pen('pointermove', 0, 100)])).toEqual(['press', 'click']);
  });

  it('按太久才放開：算按住', () => {
    expect(run([pen('pointermove', 1, 0), pen('pointermove', 0, CLICK_MS + 1)])).toEqual(['press', 'hold']);
  });

  it('一般下筆：碰著螢幕時的 buttons 1 不是側鍵', () => {
    expect(run([pen('pointermove', 0, 0), pen('pointerdown', 1, 10), pen('pointermove', 1, 20), pen('pointerup', 0, 60), pen('pointermove', 0, 70)])).toEqual([]);
  });

  it('按住側鍵點螢幕：Chrome 只送 contextmenu，放開時算按住', () => {
    const tap = { type: 'contextmenu', pointerType: '', timeStamp: 50 };
    expect(run([pen('pointermove', 1, 0), tap, pen('pointermove', 1, 80), pen('pointermove', 0, 120)])).toEqual(['press', 'hold']);
  });

  it('按住側鍵下筆（照常送來的瀏覽器）：放開時算按住，筆離開螢幕後側鍵還按著也不重算', () => {
    expect(
      run([
        pen('pointermove', 3, 0),
        pen('pointerdown', 1, 30),
        pen('pointermove', 1, 40),
        pen('pointerup', 0, 90),
        pen('pointermove', 3, 100),
        pen('pointermove', 0, 150),
      ]),
    ).toEqual(['press', 'hold']);
  });

  it('漏了 pointerup：懸空又沒按鍵的移動當成筆已經離開螢幕', () => {
    expect(run([pen('pointerdown', 1, 0), pen('pointermove', 0, 50), pen('pointermove', 1, 60), pen('pointermove', 0, 100)])).toEqual(['press', 'click']);
  });
});

describe('觸控筆側鍵：電腦上的繪圖筆（照 Pointer Events 規格）', () => {
  it('懸空按側鍵是 pointerdown（buttons 2、沒有碰著螢幕的位元）', () => {
    expect(isAirPress(pen('pointerdown', 2, 0))).toBe(true);
    expect(run([pen('pointermove', 0, 0), pen('pointerdown', 2, 10), pen('pointermove', 2, 20), pen('pointerup', 0, 100)])).toEqual(['press', 'click']);
  });

  it('側鍵當右鍵送來的 contextmenu（pointerType 是 pen）不影響按一下', () => {
    const menu = { type: 'contextmenu', pointerType: 'pen', timeStamp: 15 };
    expect(run([pen('pointerdown', 2, 10), menu, pen('pointerup', 0, 100)])).toEqual(['press', 'click']);
  });

  it('按著側鍵碰到螢幕（buttons 3）：放開時算按住', () => {
    expect(run([pen('pointerdown', 2, 0), pen('pointermove', 3, 20), pen('pointermove', 2, 60), pen('pointerup', 0, 100)])).toEqual(['press', 'hold']);
  });

  it('下筆、筆尾橡皮擦、沒帶按鍵的合成事件都不是懸空按側鍵', () => {
    expect(isAirPress(pen('pointerdown', 1, 0))).toBe(false);
    expect(isAirPress(pen('pointerdown', 3, 0))).toBe(false);
    expect(isAirPress(pen('pointerdown', 32, 0))).toBe(false);
    expect(isAirPress(pen('pointerdown', 0, 0))).toBe(false);
    expect(isAirPress({ type: 'pointerdown', pointerType: 'mouse', buttons: 2, timeStamp: 0 })).toBe(false);
  });
});

describe('觸控筆側鍵：滑鼠、手指不管', () => {
  it('滑鼠拖曳、手指長按都不算', () => {
    const mouse = (type, buttons, timeStamp) => ({ type, pointerType: 'mouse', buttons, timeStamp });
    expect(run([mouse('pointermove', 0, 0), mouse('pointerdown', 1, 10), mouse('pointermove', 1, 20), mouse('pointerup', 0, 50)])).toEqual([]);
    expect(run([{ type: 'pointerdown', pointerType: 'touch', buttons: 1, timeStamp: 0 }, { type: 'contextmenu', pointerType: 'touch', timeStamp: 500 }])).toEqual([]);
  });
});
