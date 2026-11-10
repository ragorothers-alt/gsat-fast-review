import 'katex/dist/katex.min.css';
import './styles.css';
import { BANK_SUBJECTS, loadBank, sortBank } from './data/bank.js';
import { initErrorReporting, setErrorReporting } from './errors.js';
import { setQuestionReporting } from './report.js';
import { KEY, absorbState, loadState, saveState, requestPersistence } from './storage.js';
import { initAbout } from './ui/about.js';
import { applyAppearance, watchSystemTheme } from './ui/appearance.js';
import { initCloud } from './ui/cloud.js';
import { initExam } from './ui/exam.js';
import { initHome } from './ui/home.js';
import { initInstall } from './ui/install.js';
import { initKeypoints } from './ui/keypoints.js';
import { initNotebook } from './ui/notebook.js';
import { initPast } from './ui/past.js';
import { initPlay } from './ui/play.js';
import { initReminder } from './ui/reminder.js';
import { initResult } from './ui/result.js';
import { initScratch } from './ui/scratch.js';
import { topSheet } from './ui/sheet.js';
import { initStats } from './ui/stats.js';
import { initWelcome } from './ui/welcome.js';

const UPDATED_KEY = 'gsat-quiz:updated';
// Android 長按 App 圖示的捷徑（manifest 的 shortcuts）帶 ?mode= 進來，直接開始這個模式
const SHORTCUT_MODES = new Set(['blitz', 'free', 'review']);

// 最先掛上：開機時（例如題庫載入）出的錯也記得到
initErrorReporting();

const state = loadState();
setErrorReporting(state.settings.reportErrors);
setQuestionReporting(state.settings.reportErrors);
// 貓咪在各畫面要對齊的位置：首頁書架區、題目卡上緣、成績卡上緣（含模擬考）、學習分析的概況卡上緣、錯題本的說明卡上緣
const world = lazyWorld(document.querySelector('#world'), {
  home: () => document.querySelector('#home .stage').getBoundingClientRect(),
  play: () => document.querySelector('#card').getBoundingClientRect(),
  result: () => document.querySelector('#result .result-head').getBoundingClientRect(),
  'exam-report': () => document.querySelector('#exam-report .result-head').getBoundingClientRect(),
  stats: () => document.querySelector('#stats .stats-head').getBoundingClientRect(),
  notebook: () => document.querySelector('#notebook .nb-head').getBoundingClientRect(),
});
applyAppearance(state.settings, world);
watchSystemTheme(state.settings, world);
const screens = [...document.querySelectorAll('.screen')];
const toastEl = document.querySelector('#toast');
let toastTimer = 0;

let saveWarned = false;
let bankFull = false;
let markFull;

const ctx = {
  state,
  world,
  /** 已載入的題目（依科目順序）；開機時只有首頁選的科目，其他科在背景補上 */
  bank: [],
  /** 題目 id → 題目，和 bank 一起更新 */
  byId: new Map(),
  /** 每一科都載入了 */
  bankReady: new Promise((resolve) => (markFull = resolve)),
  /** 其他科還在背景下載中 */
  bankLoading: () => !bankFull && !restFailed,
  /** 等背景下載告一段落（成功或失敗）再做；已經結束就馬上做 */
  afterBank(fn) {
    if (!ctx.bankLoading()) return fn();
    ctx.toast('其他科的題庫還在下載，馬上就好');
    return new Promise((resolve) => restWaiters.push(resolve)).then(fn);
  },
  save() {
    if (saveState(state) || saveWarned) return;
    // 空間不足或被瀏覽器封鎖：照常能玩，但要讓玩家知道進度沒存進去，趁還開著先匯出備份
    saveWarned = true;
    ctx.toast('進度存不進這台裝置（空間不足或被封鎖），請到設定匯出備份');
  },
  show(id) {
    for (const el of screens) el.hidden = el.id !== id;
    world.setScene(id);
  },
  toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  },
  /** 新版已下載完、等待套用 */
  updateReady: false,
  applyUpdate() {
    try {
      sessionStorage.setItem(UPDATED_KEY, '1');
    } catch {
      // 讀寫不了就不顯示「已更新」提示
    }
    location.reload();
  },
  // 由各畫面模組註冊
  goHome: null,
  refreshHome: null,
  refreshSettings: null,
  openSettings: null,
  openUnits: null,
  renderCloud: null,
  renderReminder: null,
  renderInstall: null,
  renderAbout: null,
  cloudSync: null,
  reminder: null,
  install: null,
  welcome: null,
  startRound: null,
  showResult: null,
  showStats: null,
  showNotebook: null,
  openKeypoints: null,
  openExam: null,
  examSummary: null,
  fitCard: null,
  scratch: null,
};

function addToBank(list) {
  ctx.bank.push(...list);
  sortBank(ctx.bank);
  for (const q of list) ctx.byId.set(q.id, q);
}

/** 這一輪背景下載結束（成功或失敗）時呼叫的等待者 */
let restWaiters = [];
let restFailed = false;

/** 首頁沒選的科目在背景補上；斷線失敗就等連上線或過一陣子再試 */
function loadRest() {
  const have = new Set(ctx.bank.map((q) => q.subject));
  loadBank(BANK_SUBJECTS.filter((id) => !have.has(id))).then(
    (list) => {
      addToBank(list);
      bankFull = true;
      restFailed = false;
      markFull();
      if (!document.querySelector('#home').hidden) ctx.refreshHome?.();
    },
    () => {
      restFailed = true;
      const retry = () => (window.removeEventListener('online', retry), clearTimeout(timer), loadRest());
      const timer = setTimeout(retry, 30_000);
      window.addEventListener('online', retry);
    },
  ).finally(() => {
    for (const done of restWaiters) done();
    restWaiters = [];
  });
}

/**
 * 要用到每一科題目的畫面（學習分析、錯題本、重點卡、闖關、選單元），題庫還在補就先等一下；
 * 下載失敗（例如離線）就用已經有的科目先開，不卡住畫面。
 */
function needFullBank(name) {
  const fn = ctx[name];
  ctx[name] = (...args) => ctx.afterBank(() => fn(...args));
}

function start(bank) {
  addToBank(bank);
  initScratch(ctx);
  initHome(ctx);
  initPlay(ctx);
  initExam(ctx);
  initPast(ctx);
  initResult(ctx);
  initStats(ctx);
  initNotebook(ctx);
  initCloud(ctx);
  initInstall(ctx);
  initReminder(ctx);
  initAbout(ctx);
  initKeypoints(ctx);
  initWelcome(ctx);
  for (const name of ['showStats', 'showNotebook', 'openKeypoints', 'openPath', 'openUnits', 'openExam']) needFullBank(name);
  ctx.goHome();
  document.querySelector('#boot').hidden = true;
  ctx.cloudSync();
  ctx.reminder.sync();
  // 第一次開啟（這台還沒有作答紀錄）：先問考哪些科、學測日期與每日目標；從捷徑直接開始一輪的就不打斷
  if (!openShortcut()) ctx.welcome.open();
  loadRest();
  // 首頁能操作了才載入背景場景（three.js 很大，不擋題庫下載與開機）
  world.load();

  try {
    if (sessionStorage.getItem(UPDATED_KEY)) {
      sessionStorage.removeItem(UPDATED_KEY);
      ctx.toast('已更新到最新版本');
    }
  } catch {
    // 私密瀏覽等情況讀不到 sessionStorage，略過提示
  }
}

/** 回傳有沒有直接開始一輪 */
function openShortcut() {
  const mode = new URLSearchParams(location.search).get('mode');
  if (!mode) return false;
  // 網址恢復成首頁，重新整理或更新版本時不會又直接開始一輪
  history.replaceState(null, '', location.pathname);
  if (!SHORTCUT_MODES.has(mode)) return false;
  ctx.startRound(mode);
  return true;
}

// 題庫要先下載（裝成 App 後從快取讀，幾乎是瞬間）：先載首頁選的科目就開始，其他科之後補；
// 第一次開又剛好斷線時，讓玩家可以重試
function boot() {
  const box = document.querySelector('#boot');
  box.classList.remove('failed');
  const picked = BANK_SUBJECTS.filter((id) => state.settings.subjects.includes(id));
  loadBank(picked.length ? picked : BANK_SUBJECTS).then(start, () => box.classList.add('failed'));
}
document.querySelector('#boot-retry').addEventListener('click', boot);
boot();
requestPersistence();

// 另一個分頁（或同時開著的瀏覽器分頁與安裝的 App）存檔了：把它的紀錄併進來，下次存檔才不會整份蓋掉對方。
// 這裡不立刻存回去：兩個分頁互相觸發存檔會沒完沒了
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !absorbState(state, e.newValue)) return;
  if (ctx.bank.length && !document.querySelector('#home').hidden) ctx.refreshHome?.();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // 新版 sw 下載完並接手後：在首頁（沒開面板）就直接換新版，作答中等回首頁再換
  const hadController = !!navigator.serviceWorker.controller;
  const atRest = () => !document.querySelector('#home').hidden && !topSheet();
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // 第一次安裝，不是更新
    ctx.updateReady = true;
    if (atRest()) ctx.applyUpdate();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // 裝成 App 後可能好幾天不會重新開啟，每次回到前景都檢查一次有沒有新版
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) return;
          if (ctx.updateReady && atRest()) ctx.applyUpdate();
          else reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

/**
 * 背景場景（three.js，主程式裡最大的一塊）晚一點才載入：先讓題庫下載、首頁能操作。
 * 載入前的呼叫先記下狀態（在哪個畫面、選了哪些科目、深淺色…），載好後一次補上；作答反應這類一次性的動作就略過。
 * 背景動畫設成「關閉」時完全不載入。
 */
function lazyWorld(canvas, anchors) {
  const STATE = ['setNight', 'setSelected', 'setFocusSubject', 'setCast', 'setCombo', 'setScene'];
  const last = {};
  let real = null;
  let loading = null;
  let wanted = false;
  let tap = null;
  let motion = 'on';
  const world = {
    get onCatTap() {
      return tap;
    },
    set onCatTap(fn) {
      tap = fn;
      if (real) real.onCatTap = fn;
    },
    setMotion(m) {
      motion = m;
      if (real) real.setMotion(m);
      else canvas.hidden = m === 'off';
      if (wanted) load();
    },
    /** 開機完成後呼叫：之後才真的載入 */
    load() {
      wanted = true;
      load();
    },
  };
  for (const name of STATE) world[name] = (...args) => (real ? real[name](...args) : (last[name] = args));
  for (const name of ['react', 'burst', 'shake', 'celebrate']) world[name] = (...args) => real?.[name](...args);

  function load() {
    if (loading || motion === 'off') return;
    loading = import('./scene.js').then(({ createWorld }) => {
      real = createWorld(canvas, anchors, { motion });
      real.onCatTap = tap;
      for (const name of STATE) if (last[name]) real[name](...last[name]);
      real.setMotion(motion);
    });
  }
  return world;
}
