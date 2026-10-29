-- 線上同步的資料表。每個同步碼是一個 space；資料庫只存同步碼的 SHA-256。
-- rev：space 每次寫入就加 1，各列記下最後一次被改時的 rev，裝置只要拉 rev 比自己新的列。

CREATE TABLE spaces (
  sid INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  rev INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 每題的作答紀錄：排程（box、due、parked）以較晚作答（last）的為準，次數取較大值
CREATE TABLE cards (
  sid INTEGER NOT NULL,
  id TEXT NOT NULL,
  box INTEGER NOT NULL,
  due INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  rights INTEGER NOT NULL,
  wrongs INTEGER NOT NULL,
  parked INTEGER NOT NULL,
  last INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, id)
) WITHOUT ROWID;
CREATE INDEX cards_rev ON cards (sid, rev);

-- 每台裝置每天的作答量（相加）；device 為空字串的是開始同步前的舊紀錄（取較大值）
CREATE TABLE daily (
  sid INTEGER NOT NULL,
  device TEXT NOT NULL,
  day TEXT NOT NULL,
  answered INTEGER NOT NULL,
  rights INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, device, day)
) WITHOUT ROWID;
CREATE INDEX daily_rev ON daily (sid, rev);

-- 回報與取消回報：以較晚的動作為準
CREATE TABLE flags (
  sid INTEGER NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  flagged INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, id)
) WITHOUT ROWID;
CREATE INDEX flags_rev ON flags (sid, rev);
