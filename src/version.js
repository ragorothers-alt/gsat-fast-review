// 建置時由 vite.config.js 寫入：版本是 git commit 的前 7 碼，另附建置時間；直接跑原始碼（測試）時是 dev
/* global __APP_VERSION__, __BUILD_TIME__ */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILT_AT = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
