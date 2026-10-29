// 外觀：深淺色主題與題目字體大小。設定存在 state.settings；另外抄一份到獨立的 key，
// 讓 index.html 開頭的小程式在畫面出現前就套用，開 App 時不會先閃一下淺色或跳版面。
const KEY = 'gsat-quiz:appearance';
const PAPER = { light: '#fbf5ea', dark: '#232b28' };
export const FONT_SCALES = [
  [0.9, '小'],
  [1, '標準'],
  [1.12, '大'],
  [1.25, '特大'],
];
export const THEMES = [
  ['auto', '跟著系統'],
  ['light', '淺色'],
  ['dark', '深色'],
];

const systemDark = matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(theme) {
  return theme === 'dark' || (theme !== 'light' && systemDark.matches) ? 'dark' : 'light';
}

/**
 * 套用主題與字體大小；world 是 three.js 場景（夜間時貓咪外框換成粉筆色）。
 * 字體大小只放大題目、選項、解析這些要讀的文字（CSS 的 --fs），首頁按鈕和版面不跟著變，才不會擠壞。
 */
export function applyAppearance(settings, world) {
  const theme = resolveTheme(settings.theme);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--fs', String(settings.fontScale));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[theme]);
  world?.setNight(theme === 'dark');
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme: settings.theme, fontScale: settings.fontScale }));
  } catch {
    // 存不了就只是下次開啟時會先閃一下
  }
}

/** 選「跟著系統」時，系統切換深淺色就跟著換 */
export function watchSystemTheme(settings, world) {
  systemDark.addEventListener('change', () => {
    if (settings.theme === 'auto') applyAppearance(settings, world);
  });
}
