// 每日提醒：用 Web Push 訂閱，到了設定的時間、今天的目標還沒達成，同步後端就會傳通知（worker/src/push.js）。
// App 練完一輪、切到背景時回報今日進度，達標的日子就不提醒。iPhone 要先加入主畫面才能訂閱。
import { CloudError, makeRequest } from '../cloud.js';
import { currentStreak, dayKey, today } from '../stats.js';

/** 要和 worker/wrangler.toml 的 VAPID_PUBLIC 一致 */
export const VAPID_PUBLIC = 'BIbHHfAs_Zww6eLeI2EH4WkZUj-YBsSgwcqL3sFrXRDmiwDqjuJONY4qtcqssfofzR5cS0lU7PzBOqbhITgSQhE';
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00–23:00

function fromB64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function initReminder(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const settings = ctx.state.settings;
  const request = makeRequest();
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const toggle = $('#reminder-toggle');
  const hourSelect = $('#reminder-hour');
  let lastReport = '';
  let busy = false;

  hourSelect.innerHTML = HOURS.map((h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');

  // 離線用的 sw.js 只在正式版註冊；推播也靠它
  const registration = () => navigator.serviceWorker.getRegistration();
  const tz = () => -new Date().getTimezoneOffset();
  const progress = (now = Date.now()) => ({
    day: dayKey(now),
    answered: today(ctx.state, now).answered,
    goal: settings.goal,
    streak: currentStreak(ctx.state, now),
  });

  async function subscribe() {
    const reg = await registration();
    if (!reg) throw new Error('no-sw');
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(VAPID_PUBLIC) }));
    const { endpoint, keys } = sub.toJSON();
    await request('/v1/push/subscribe', { endpoint, keys, hour: settings.reminder.hour, tz: tz(), progress: progress() });
    lastReport = '';
  }

  async function enable() {
    if (ctx.install.needed()) return ctx.install.open();
    // 要在點擊當下就詢問權限（iPhone 規定），前面不能先 await 別的事
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      ctx.toast(permission === 'denied' ? '通知被封鎖了，請到瀏覽器或系統設定允許通知' : '沒有允許通知，提醒沒有開啟');
      return render();
    }
    try {
      await subscribe();
      settings.reminder.on = true;
      ctx.save();
      ctx.toast(`每天 ${settings.reminder.hour} 點，還沒達標就提醒你`);
    } catch (e) {
      ctx.toast(
        e.message === 'no-sw'
          ? '開發版沒有離線程式，正式版才能開啟提醒'
          : e instanceof CloudError && e.status === 0
            ? '連不上網路，稍後再試一次'
            : '開啟提醒失敗，稍後再試一次',
      );
    }
    render();
  }

  async function disable() {
    settings.reminder.on = false;
    ctx.save();
    render();
    try {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (!sub) return;
      await request('/v1/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    } catch {
      // 取消不了也沒關係：後端送出時發現訂閱失效就會刪掉
    }
  }

  toggle.addEventListener('click', async () => {
    if (busy || !supported) return;
    busy = true;
    try {
      await (settings.reminder.on ? disable() : enable());
    } finally {
      busy = false;
    }
  });

  hourSelect.addEventListener('change', async () => {
    settings.reminder.hour = Number(hourSelect.value);
    ctx.save();
    if (!settings.reminder.on) return;
    try {
      await subscribe();
      ctx.toast(`提醒時間改成 ${settings.reminder.hour} 點`);
    } catch {
      ctx.toast('連不上網路，提醒時間稍後會再更新');
      lastReport = '';
    }
  });

  $('#reminder-install').addEventListener('click', () => ctx.install.open());

  function render() {
    const ios = ctx.install.needed();
    const denied = supported && Notification.permission === 'denied';
    const on = supported && settings.reminder.on && !denied;
    toggle.setAttribute('aria-checked', String(on));
    toggle.disabled = !supported;
    hourSelect.value = String(settings.reminder.hour);
    $('#reminder-install').hidden = !ios;
    $('#reminder-note').textContent = !supported
      ? ios
        ? 'iPhone 要先加入主畫面（iOS 16.4 以上），從主畫面打開才收得到提醒。'
        : '這個瀏覽器不支援通知提醒。'
      : ios
        ? 'iPhone 要先加入主畫面，從主畫面打開才收得到提醒。'
        : denied
          ? '通知被封鎖了：請到瀏覽器或系統設定，允許這個網站傳送通知。'
          : '每天到了這個時間，今天的目標還沒達成，就傳通知提醒你。';
  }
  ctx.renderReminder = render;

  ctx.reminder = {
    /** 回報今日進度（內容沒變就不送）；訂閱被瀏覽器註銷時重新訂閱 */
    async sync({ keepalive = false } = {}) {
      if (!supported || !settings.reminder.on || Notification.permission !== 'granted') return;
      try {
        const sub = await (await registration())?.pushManager.getSubscription();
        if (!sub) return await subscribe();
        const body = { endpoint: sub.endpoint, tz: tz(), progress: progress() };
        const key = JSON.stringify(body);
        if (key === lastReport) return;
        await request('/v1/push/progress', body, { keepalive });
        lastReport = key;
      } catch (e) {
        if (e instanceof CloudError && e.status === 404) await subscribe().catch(() => {});
      }
    },
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctx.reminder.sync({ keepalive: true });
  });
}
