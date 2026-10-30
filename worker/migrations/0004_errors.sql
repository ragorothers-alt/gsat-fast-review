-- 前端回報的執行錯誤：同一版本、同一則訊息與出錯位置只記一列，累計次數；最多保留 500 列
CREATE TABLE errors (
  version TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL,
  ua TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (version, message, source)
) WITHOUT ROWID;
CREATE INDEX errors_last ON errors (last_at);
