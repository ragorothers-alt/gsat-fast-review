// 測試用的 D1：用 Node 內建的 SQLite 實作 Worker 用到的那幾個方法（prepare/bind/first/run/all、batch）
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    return column ? row[column] : row;
  }
  async run() {
    return this.runSync();
  }
  async all() {
    return this.runSync();
  }
  runSync() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: stmt.all(...this.params) };
    const info = stmt.run(...this.params);
    return { results: [], meta: { changes: Number(info.changes) } };
  }
}

/** 建立一個套用了 worker/migrations 的記憶體資料庫 */
export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../worker/migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    // D1 的 batch 是一個交易：任何一句失敗就整批還原
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
