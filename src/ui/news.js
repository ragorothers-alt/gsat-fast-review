// 更新說明面板：開機時列這台裝置還沒看過的更新（看過就記下，不再跳）；設定的「更新紀錄」打開全部。
// 要列哪些、資料在 ../news.js
import { NEWS, NEWS_KEY, latestNews, newsToShow } from '../news.js';
import { closeSheet, openSheet } from './sheet.js';

const readSeen = () => {
  try {
    return localStorage.getItem(NEWS_KEY);
  } catch {
    return latestNews(); // 讀不到 localStorage（被封鎖）：也記不住看過了，就不跳
  }
};

const markSeen = () => {
  try {
    localStorage.setItem(NEWS_KEY, latestNews());
  } catch {
    // 存不了就算了：下次開啟可能再看到一次
  }
};

/** '2026-11-13-2' → '11/13' */
const shortDate = (id) => {
  const [, m, d] = id.split('-').map(Number);
  return `${m}/${d}`;
};

export function initNews(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#news-sheet');
  const list = $('#news-list');

  // 新使用者（還沒有作答紀錄）：以前的更新跟他無關，直接記成看過了，之後只會看到新的
  if (readSeen() === null && !Object.keys(ctx.state.cards).length) markSeen();

  function render(items, tip) {
    $('#news-tip').textContent = tip;
    list.replaceChildren(
      ...items.map((n) => {
        const box = document.createElement('section');
        box.className = 'news-item';
        const h = document.createElement('h3');
        const date = document.createElement('small');
        date.textContent = shortDate(n.id);
        h.append(date, n.title);
        const ul = document.createElement('ul');
        for (const t of n.items) ul.append(Object.assign(document.createElement('li'), { textContent: t }));
        box.append(h, ul);
        return box;
      }),
    );
    $('#news-scroll').scrollTop = 0;
  }

  function close() {
    markSeen();
    closeSheet(sheet);
  }

  $('#news-ok').addEventListener('click', close);
  $('#news-close').addEventListener('click', close);
  sheet.addEventListener('sheet-close', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  $('#open-news').addEventListener('click', () => {
    render(NEWS, '最近的更新，新的在上面。');
    openSheet(sheet);
  });

  ctx.news = {
    /** 開機、首頁出現後呼叫：有沒看過的更新就打開面板。回傳有沒有打開 */
    open() {
      const items = newsToShow(ctx.state, readSeen(), Date.now());
      if (!items.length) return false;
      render(items, items.length > 1 ? `上次打開後更新了 ${items.length} 次：` : '這次更新了：');
      openSheet(sheet);
      return true;
    },
  };
}
