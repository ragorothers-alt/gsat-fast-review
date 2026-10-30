// 設定裡的「關於與診斷」：版本、離線快取、進度保護、通知權限、最近的錯誤。
// 出問題時按「複製診斷資訊」貼給開發者，不用描述手機的狀況也看得出原因。
import { cloudOn } from '../cloud.js';
import { recentErrors } from '../errors.js';
import { BUILT_AT, VERSION } from '../version.js';
import { copyText } from './clipboard.js';
import { isIOS, isStandalone } from './install.js';

/** 收集診斷資訊：[標題, 內容] 的清單；瀏覽器不支援的項目寫「不支援」 */
async function collect(ctx) {
  const rows = [];
  const built = BUILT_AT ? new Date(BUILT_AT) : null;
  rows.push(['版本', built ? `${VERSION}（${built.getMonth() + 1}/${built.getDate()} 建置）` : VERSION]);
  rows.push(['題庫', `${ctx.bank.length} 題，作答過 ${Object.keys(ctx.state.cards).length} 題`]);

  let offline = '不支援';
  if ('serviceWorker' in navigator) {
    const keys = (await globalThis.caches?.keys().catch(() => [])) ?? [];
    const cache = keys.find((k) => k.startsWith('gsat-'));
    offline = navigator.serviceWorker.controller ? `已就緒${cache ? `（${cache}）` : ''}` : '還沒就緒（第一次開啟時會在背景下載）';
  }
  rows.push(['離線使用', offline]);

  let persisted = '不支援';
  try {
    if (navigator.storage?.persisted) persisted = (await navigator.storage.persisted()) ? '瀏覽器已同意保留進度' : '空間不足時可能被清除';
  } catch {
    // 不支援就維持「不支援」
  }
  if (isIOS() && !isStandalone()) persisted += '；iPhone 沒加入主畫面時，7 天沒開會被 Safari 清除';
  rows.push(['進度保護', persisted]);

  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) rows.push(['已用空間', est.usage < 1048576 ? `${Math.ceil(est.usage / 1024)} KB` : `${(est.usage / 1048576).toFixed(1)} MB`]);
  } catch {
    // 略過
  }
  rows.push(['開啟方式', isStandalone() ? 'App（主畫面）' : '瀏覽器']);
  const perm = typeof Notification === 'undefined' ? '不支援' : { granted: '允許', denied: '封鎖', default: '還沒問過' }[Notification.permission];
  rows.push(['通知權限', perm]);
  rows.push(['線上同步', cloudOn(ctx.state) ? '開啟' : '關閉']);
  rows.push(['畫面', `${innerWidth}×${innerHeight}，${devicePixelRatio || 1}x`]);
  rows.push(['瀏覽器', navigator.userAgent]);
  return rows;
}

function errorLines(now) {
  return recentErrors().map((e) => {
    const min = Math.round((now - e.at) / 60_000);
    const when = min < 1 ? '剛剛' : min < 60 ? `${min} 分鐘前` : min < 1440 ? `${Math.round(min / 60)} 小時前` : `${Math.round(min / 1440)} 天前`;
    return `${when}：${e.message}${e.source ? `（${e.source}）` : ''}`;
  });
}

export function initAbout(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const list = $('#about-list');
  const errors = $('#about-errors');

  ctx.renderAbout = async () => {
    const rows = await collect(ctx);
    // 瀏覽器那一行太長，畫面上不列，複製時才附上
    const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
    list.replaceChildren(
      ...rows
        .filter(([k]) => k !== '瀏覽器')
        .map(([k, v]) => {
          const row = document.createElement('div');
          row.append(el('dt', k), el('dd', v));
          return row;
        }),
    );
    const lines = errorLines(Date.now());
    errors.hidden = !lines.length;
    errors.querySelector('ul').replaceChildren(
      ...lines.slice(0, 3).map((t) => Object.assign(document.createElement('li'), { textContent: t })),
    );
  };

  $('#about-copy').addEventListener('click', async () => {
    const rows = await collect(ctx);
    const lines = errorLines(Date.now());
    const text = [
      '學測快問快答・診斷資訊',
      ...rows.map(([k, v]) => `${k}：${v}`),
      `最近的錯誤：${lines.length ? '' : '沒有'}`,
      ...lines.map((t) => `- ${t}`),
    ].join('\n');
    ctx.toast((await copyText(text)) ? '已複製診斷資訊，貼給開發者就好' : '沒辦法自動複製，請截圖這一區');
  });
}
