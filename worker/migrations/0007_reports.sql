-- 玩家回報有問題的題目：只記題號與次數（不記是誰回報的），題庫維護者照次數排著看；最多保留 3000 列
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  version TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX reports_last ON reports (last_at);
