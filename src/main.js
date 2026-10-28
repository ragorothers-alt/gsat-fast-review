import 'katex/dist/katex.min.css';
import './styles.css';
import { loadBank } from './data/bank.js';
import { createWorld } from './scene.js';
import { loadState, saveState, requestPersistence } from './storage.js';
import { initHome } from './ui/home.js';
import { initPlay } from './ui/play.js';
import { initResult } from './ui/result.js';
import { initScratch } from './ui/scratch.js';
import { initStats } from './ui/stats.js';

const UPDATED_KEY = 'gsat-quiz:updated';

const state = loadState();
// 貓咪在各畫面要對齊的位置：首頁書架區、題目卡上緣、成績卡上緣、學習分析的概況卡上緣
const world = createWorld(document.querySelector('#world'), {
  home: () => document.querySelector('#home .stage').getBoundingClientRect(),
  play: () => document.querySelector('#card').getBoundingClientRect(),
  result: () => document.querySelector('#result .result-head').getBoundingClientRect(),
  stats: () => document.querySelector('#stats .stats-head').getBoundingClientRect(),
});
const screens = [...document.querySelectorAll('.screen')];
const toastEl = document.querySelector('#toast');
let toastTimer = 0;

const ctx = {
  state,
  world,
  bank: [],
  save: () => saveState(state),
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
  startRound: null,
  showResult: null,
  showStats: null,
  scratch: null,
};

function start(bank) {
  ctx.bank = bank;
  initScratch(ctx);
  initHome(ctx);
  initPlay(ctx);
  initResult(ctx);
  initStats(ctx);
  ctx.goHome();
  document.querySelector('#boot').hidden = true;

  try {
    if (sessionStorage.getItem(UPDATED_KEY)) {
      sessionStorage.removeItem(UPDATED_KEY);
      ctx.toast('已更新到最新版本 ✨');
    }
  } catch {
    // 私密瀏覽等情況讀不到 sessionStorage，略過提示
  }
}

// 題庫要先下載（裝成 App 後從快取讀，幾乎是瞬間）；第一次開又剛好斷線時，讓玩家可以重試
function boot() {
  const box = document.querySelector('#boot');
  box.classList.remove('failed');
  loadBank().then(start, () => box.classList.add('failed'));
}
document.querySelector('#boot-retry').addEventListener('click', boot);
boot();
requestPersistence();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // 新版 sw 下載完並接手後：在首頁（沒開面板）就直接換新版，作答中等回首頁再換
  const hadController = !!navigator.serviceWorker.controller;
  const atRest = () => !document.querySelector('#home').hidden && [...document.querySelectorAll('.sheet')].every((s) => s.hidden);
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
