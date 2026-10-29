// 安裝成 App。iPhone 用 Safari 直接開網頁的話，7 天沒打開就可能被清掉作答紀錄，
// 加入主畫面後才會保留，所以練過一輪回到首頁時提醒一次；Android、電腦的 Chrome 則可以直接跳出安裝視窗。
import { DAY } from '../srs.js';

const KEY = 'gsat-quiz:install-hint';
/** 按「知道了」之後多久再提醒一次 */
const AGAIN_MS = 30 * DAY;
/** 至少練過這麼多題才提醒（剛打開就跳出來太打擾） */
const MIN_CARDS = 10;

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function initInstall(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#install-sheet');
  let prompt = null; // Chrome 的 beforeinstallprompt 事件，留著給設定裡的「安裝」按鈕用
  let nudged = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    prompt = e;
    ctx.refreshSettings?.();
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    ctx.refreshSettings?.();
  });

  function open() {
    sheet.hidden = false;
  }

  function close() {
    sheet.hidden = true;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // 存不了就下次再提醒
    }
  }

  $('#install-close').addEventListener('click', close);
  $('#install-ok').addEventListener('click', close);
  $('#install-sync').addEventListener('click', () => {
    close();
    ctx.openSettings('#cloud-badge');
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  // 設定裡的「安裝成 App」：iPhone 看步驟，Chrome 直接安裝；已經裝好就不顯示
  $('#install-open').addEventListener('click', async () => {
    if (isIOS()) return open();
    if (!prompt) return;
    const e = prompt;
    prompt = null;
    await e.prompt();
    ctx.refreshSettings?.();
  });

  ctx.renderInstall = () => {
    const ios = isIOS();
    const show = !isStandalone() && (ios || !!prompt);
    $('#install-group').hidden = !show;
    if (!show) return;
    $('#install-note').textContent = ios
      ? '用 Safari 開網頁的話，7 天沒打開可能被清掉作答紀錄；加入主畫面就不會，也才收得到每日提醒。'
      : '安裝後可以從桌面直接打開，沒網路也能玩。';
    $('#install-open').textContent = ios ? '看加入主畫面的步驟' : '安裝';
  };

  ctx.install = {
    /** iPhone 上要先加入主畫面才收得到推播 */
    needed: () => isIOS() && !isStandalone(),
    open,
    /** 練過一輪回到首頁時呼叫：iPhone 沒加入主畫面就提醒（每次開 App 最多一次、按掉後 30 天再提醒） */
    nudge() {
      if (nudged || !isIOS() || isStandalone()) return;
      if (Object.keys(ctx.state.cards).length < MIN_CARDS) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(KEY)) || 0;
      } catch {
        // 讀不到就當沒提醒過
      }
      if (Date.now() - last < AGAIN_MS) return;
      nudged = true;
      open();
    },
  };
}
