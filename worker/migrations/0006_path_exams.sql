-- 單元闖關進度：每科每個單元一列。cleared 過關時間（取較大值）；run 做到一半的關（JSON：ids、index、extra），
-- 以 run_at 較晚的為準。unit 是空字串的那列記這科「從第一關重新闖」的時間：比它早的過關與進行中的關都不算
CREATE TABLE path (
  sid INTEGER NOT NULL,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  cleared INTEGER NOT NULL,
  run_at INTEGER NOT NULL,
  run TEXT,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, subject, unit)
) WITHOUT ROWID;
CREATE INDEX path_rev ON path (sid, rev);

-- 模擬考成績：一次一列，寫入後不改（同一時間、同一張卷是同一筆）；每組同步碼只留最近 60 筆
CREATE TABLE exams (
  sid INTEGER NOT NULL,
  at INTEGER NOT NULL,
  paper TEXT NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, at, paper)
) WITHOUT ROWID;
CREATE INDEX exams_rev ON exams (sid, rev);
