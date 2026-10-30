-- 收藏與取消收藏：跟回報一樣以較晚的動作為準
CREATE TABLE stars (
  sid INTEGER NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  starred INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (sid, id)
) WITHOUT ROWID;
CREATE INDEX stars_rev ON stars (sid, rev);
