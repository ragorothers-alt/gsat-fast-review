// 觸控筆的側鍵（三星 S Pen 等）。各瀏覽器回報的方式不同，這裡統一成三件事：按下、放開時是「按一下」還是「按住」。
//
// Android 上的 Chrome（三星平板、手機；Chromium 原始碼與實機紀錄都是這樣）：
// - 筆懸空時按側鍵：沒有 pointerdown，只有懸空的 pointermove 上 buttons 從 0 變成非 0（多半是 1，有的機型是 2 或 3），
//   放開時變回 0。
// - 筆尖碰著螢幕時 buttons 一律是 1：寫到一半按側鍵，網頁看不出來（crbug.com/816504）。
// - 按住側鍵再碰螢幕：Chrome 拿去「用筆選字」，網頁收不到這次觸控；點一下只會收到一個 contextmenu。
// 電腦上的繪圖筆（Wacom、Surface 等，照 Pointer Events 規格）：懸空按側鍵是一個 pointerdown，buttons 2、沒有碰著螢幕的位元 1。
// 有的瀏覽器會照常送來按住側鍵時的下筆（側鍵先在懸空時按下）：這種情形放開時回報「按住」。

/** 按下到放開不超過這麼久（ms）、中間沒碰過螢幕，才算按一下 */
export const CLICK_MS = 700;

/** 懸空按側鍵的 pointerdown（電腦上的繪圖筆）：不是下筆，不要畫 */
export const isAirPress = (e) => e.pointerType === 'pen' && (e.buttons & 2) !== 0 && (e.buttons & 1) === 0;

/**
 * 側鍵偵測：畫布上的 pointerdown、pointermove、pointerup、pointercancel 與 contextmenu 依序餵給 handle()，回傳
 * 'press'（懸空按下側鍵）、'click'（放開：按了一下）、'hold'（放開：按著時碰過螢幕或按太久）或 null。
 * 筆移出畫布時看不到側鍵放開，等筆回到畫布上的第一個事件再算。
 */
export function createPenButton() {
  /** 側鍵按著：t 按下的時間；spent 已經不算按一下；viaDown 是 pointerdown 開始的（電腦上的繪圖筆），等 pointerup 才放開 */
  let press = null;
  /** 筆尖碰著螢幕 */
  let touching = false;

  const begin = (e, viaDown) => {
    if (press) return null;
    press = { t: e.timeStamp, spent: false, viaDown };
    return 'press';
  };

  const end = (e) => {
    const p = press;
    press = null;
    if (!p) return null;
    return !p.spent && e.timeStamp - p.t <= CLICK_MS ? 'click' : 'hold';
  };

  return {
    handle(e) {
      // 按住側鍵點螢幕：Chrome 拿去選字，只送 pointerType 是空字串的 contextmenu，這次不算按一下。
      // pointerType 是 pen 的不算：電腦上的繪圖筆按側鍵本身就會送（當成右鍵），筆尖長按則已經下筆了
      if (e.type === 'contextmenu') {
        if (press && e.pointerType !== 'pen') press.spent = true;
        return null;
      }
      if (e.pointerType !== 'pen') return null;
      switch (e.type) {
        case 'pointerdown':
          if (isAirPress(e)) return begin(e, true);
          touching = true;
          if (press) press.spent = true;
          return null;
        case 'pointerup':
        case 'pointercancel':
          if (touching) {
            touching = false;
            return null;
          }
          return press?.viaDown ? end(e) : null;
        case 'pointermove':
          if (touching) {
            // 碰著螢幕時看不出側鍵。漏了 pointerup 的話，懸空又沒按鍵的移動表示筆已經離開螢幕
            if (e.buttons !== 0) return null;
            touching = false;
          }
          if (press?.viaDown) {
            if (e.buttons & 1) press.spent = true;
            return null;
          }
          return e.buttons !== 0 ? begin(e, false) : end(e);
        default:
          return null;
      }
    },
  };
}
