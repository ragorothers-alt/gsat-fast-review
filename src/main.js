import 'katex/dist/katex.min.css';
import './styles.css';
import { BANK } from './data/bank.js';
import { createWorld } from './scene.js';
import { loadState, saveState, requestPersistence } from './storage.js';
import { initHome } from './ui/home.js';
import { initPlay } from './ui/play.js';
import { initResult } from './ui/result.js';
import { initScratch } from './ui/scratch.js';

const state = loadState();
// 貓咪在各畫面要對齊的位置：首頁書架區、題目卡上緣、成績卡上緣
const world = createWorld(document.querySelector('#world'), {
  home: () => document.querySelector('#home .stage').getBoundingClientRect(),
  play: () => document.querySelector('#card').getBoundingClientRect(),
  result: () => document.querySelector('#result .result-head').getBoundingClientRect(),
});
const screens = [...document.querySelectorAll('.screen')];
const toastEl = document.querySelector('#toast');
let toastTimer = 0;

const ctx = {
  state,
  world,
  bank: BANK,
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
  // 由各畫面模組註冊
  goHome: null,
  startRound: null,
  showResult: null,
  scratch: null,
};

initScratch(ctx);
initHome(ctx);
initPlay(ctx);
initResult(ctx);
ctx.goHome();
requestPersistence();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
