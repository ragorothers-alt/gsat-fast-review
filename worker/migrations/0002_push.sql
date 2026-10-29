-- 每日提醒的推播訂閱（push.js）。不綁同步碼：只有推播服務的網址與金鑰、提醒時刻、時區與 App 回報的今日進度
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  hour INTEGER NOT NULL,       -- 當地時間幾點提醒
  tz INTEGER NOT NULL,         -- UTC 偏移（分鐘），台灣是 480
  day TEXT,                    -- 最後回報進度的當地日期
  answered INTEGER NOT NULL DEFAULT 0,
  goal INTEGER NOT NULL DEFAULT 30,
  streak INTEGER NOT NULL DEFAULT 0,
  sent_day TEXT,               -- 最後一次提醒的當地日期（一天只提醒一次）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX push_subs_hour ON push_subs (hour);
