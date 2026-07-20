/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class SQLiteAppDataStore {
  constructor(dbPath) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
    this._migrateDedupe();
    this._prepareStatements();
  }

  /** app_data_entries 중복 정리 + year_key NULL → '' 정규화 + VACUUM
   * 배경: _normalizeYear가 'common' scope에 NULL을 반환했고, SQLite는 NULL을 UNIQUE 제약에서
   * 항상 다른 값으로 취급하여 ON CONFLICT UPDATE가 동작하지 않아 중복 행이 쌓였음.
   * 기존 사용자 DB에 대해 1회성 정리 수행. */
  _migrateDedupe() {
    try {
      const needsCleanup = this.db.prepare(
        `SELECT 1 FROM app_data_entries WHERE year_key IS NULL LIMIT 1`
      ).get();
      if (!needsCleanup) return;

      const beforeCount = this.db.prepare('SELECT COUNT(*) AS n FROM app_data_entries').get().n;
      const beforeSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;

      /* 1) 그룹별 최신 행(MAX rowid) 1개만 남기고 나머지 삭제 */
      this.db.exec(`
        DELETE FROM app_data_entries
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM app_data_entries
          GROUP BY scope, key_name, COALESCE(year_key, '')
        );
      `);

      /* 2) year_key NULL → '' 로 통일 (앞으로 PRIMARY KEY 충돌 정상 동작) */
      this.db.exec(`UPDATE app_data_entries SET year_key = '' WHERE year_key IS NULL;`);

      const afterCount = this.db.prepare('SELECT COUNT(*) AS n FROM app_data_entries').get().n;

      /* 3) VACUUM 으로 실제 파일 크기 회수 (트랜잭션 밖에서 실행) */
      this.db.exec('VACUUM;');

      const afterSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
      const removedRows = beforeCount - afterCount;
      const savedMB = ((beforeSize - afterSize) / 1024 / 1024).toFixed(1);
      const beforeMB = (beforeSize / 1024 / 1024).toFixed(1);
      const afterMB = (afterSize / 1024 / 1024).toFixed(1);
      console.log(`[AppDataStore] 중복 정리 완료: ${removedRows}개 행 삭제, ${savedMB} MB 절약 (${beforeMB}MB → ${afterMB}MB)`);
    } catch (err) {
      console.error('[AppDataStore] 중복 정리 실패:', err.message);
    }
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_data_entries (
        scope TEXT NOT NULL,
        key_name TEXT NOT NULL,
        year_key TEXT,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key_name, year_key)
      );

      CREATE TABLE IF NOT EXISTS app_data_meta (
        key_name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        legacy_id TEXT,
        type TEXT NOT NULL DEFAULT 'student',
        name TEXT NOT NULL,
        grade TEXT,
        class_name TEXT,
        number_value TEXT,
        gender TEXT,
        birth_date TEXT,
        status TEXT,
        condition_note TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_records (
        id INTEGER PRIMARY KEY,
        school_year TEXT NOT NULL,
        student_id TEXT,
        visit_date TEXT NOT NULL,
        time_in TEXT,
        time_out TEXT,
        symptoms_json TEXT NOT NULL DEFAULT '[]',
        treatment_json TEXT NOT NULL DEFAULT '[]',
        medication_text TEXT,
        body_temp TEXT,
        blood_pressure TEXT,
        result_code TEXT,
        nurse_name TEXT,
        department_text TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_records_school_year_date
      ON daily_records (school_year, visit_date);

      CREATE TABLE IF NOT EXISTS emergency_records (
        id INTEGER PRIMARY KEY,
        school_year TEXT NOT NULL,
        student_id TEXT,
        occurred_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id)
      );

      CREATE INDEX IF NOT EXISTS idx_emergency_records_school_year
      ON emergency_records (school_year);

      CREATE TABLE IF NOT EXISTS infection_records (
        id INTEGER PRIMARY KEY,
        school_year TEXT NOT NULL,
        student_id TEXT,
        occurred_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id)
      );

      CREATE INDEX IF NOT EXISTS idx_infection_records_school_year
      ON infection_records (school_year);

      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS physical_exam_sessions (
        id TEXT PRIMARY KEY,
        exam_date TEXT,
        relay_url TEXT,
        channel_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS physical_exam_students (
        session_id TEXT NOT NULL,
        class_key TEXT NOT NULL,
        student_key TEXT NOT NULL,
        student_name TEXT,
        number_value TEXT,
        height_value TEXT,
        weight_value TEXT,
        vision_naked_left TEXT,
        vision_naked_right TEXT,
        vision_corrected_left TEXT,
        vision_corrected_right TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, class_key, student_key),
        FOREIGN KEY (session_id) REFERENCES physical_exam_sessions(id)
      );
    `);

    this.db.prepare(`
      INSERT INTO app_data_meta (key_name, value)
      VALUES ('app_data_store_version', '1')
      ON CONFLICT(key_name) DO UPDATE SET value=excluded.value
    `).run();
  }

  _prepareStatements() {
    /* year_key 는 항상 문자열(빈 문자열 또는 연도) — NULL 이 아니므로 = 비교 사용 */
    this.getStmt = this.db.prepare(`
      SELECT value_json, updated_at
      FROM app_data_entries
      WHERE scope = ? AND key_name = ? AND year_key = ?
    `);

    this.setStmt = this.db.prepare(`
      INSERT INTO app_data_entries (scope, key_name, year_key, value_json, updated_at)
      VALUES (@scope, @key_name, @year_key, @value_json, @updated_at)
      ON CONFLICT(scope, key_name, year_key)
      DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM app_data_entries
      WHERE scope = ? AND key_name = ? AND year_key = ?
    `);

    this.exportEntriesStmt = this.db.prepare(`
      SELECT scope, key_name, year_key, value_json, updated_at
      FROM app_data_entries
      ORDER BY scope, key_name, year_key
    `);

    this.clearEntriesStmt = this.db.prepare(`DELETE FROM app_data_entries`);

    this.batchSetTx = this.db.transaction((items) => {
      items.forEach((item) => {
        const normalized = this._normalizeItem(item);
        if (normalized.value_json === null) {
          this.deleteStmt.run(normalized.scope, normalized.key_name, normalized.year_key);
          return;
        }
        this.setStmt.run(normalized);
      });
    });

    this.importBackupTx = this.db.transaction((entries) => {
      this.clearEntriesStmt.run();
      (entries || []).forEach((entry) => {
        this.setStmt.run({
          scope: this._normalizeScope(entry.scope),
          key_name: String(entry.key_name),
          year_key: this._normalizeYear(this._normalizeScope(entry.scope), entry.year_key),
          value_json: String(entry.value_json),
          updated_at: entry.updated_at || new Date().toISOString()
        });
      });
    });
  }

  _normalizeScope(scope) {
    return scope === 'year' ? 'year' : 'common';
  }

  _normalizeYear(scope, year) {
    /* scope='common' 은 빈 문자열(''), scope='year' 는 연도 문자열.
     * NULL 을 쓰면 SQLite UNIQUE 제약에서 중복이 발생하므로 항상 문자열 반환. */
    if (scope !== 'year') return '';
    return String(year || new Date().getFullYear());
  }

  _normalizeItem(item) {
    const scope = this._normalizeScope(item.scope);
    const year_key = this._normalizeYear(scope, item.year);
    const key_name = String(item.key);
    const updated_at = new Date().toISOString();
    const value_json = item.value === undefined ? null : JSON.stringify(item.value === undefined ? null : item.value);

    return { scope, key_name, year_key, value_json, updated_at };
  }

  get(scope, key, year) {
    const normalizedScope = this._normalizeScope(scope);
    const normalizedYear = this._normalizeYear(normalizedScope, year);
    const row = this.getStmt.get(normalizedScope, String(key), normalizedYear);

    if (!row) {
      return { exists: false, data: null };
    }

    return {
      exists: true,
      data: JSON.parse(row.value_json),
      updatedAt: row.updated_at
    };
  }

  set(scope, key, value, year) {
    const normalized = this._normalizeItem({ scope, key, value, year });
    if (normalized.value_json === null) {
      this.deleteStmt.run(normalized.scope, normalized.key_name, normalized.year_key);
      return { success: true, deleted: true };
    }

    this.setStmt.run(normalized);
    return {
      success: true,
      deleted: false,
      updatedAt: normalized.updated_at
    };
  }

  batchSet(items) {
    this.batchSetTx(items || []);
    return { success: true, count: (items || []).length };
  }

  getInfo() {
    return {
      dbPath: this.dbPath,
      exists: fs.existsSync(this.dbPath)
    };
  }

  exportBackup() {
    const entries = this.exportEntriesStmt.all();
    return {
      meta: {
        exportedAt: new Date().toISOString(),
        entryCount: entries.length,
        dbPath: this.dbPath,
        version: '1'
      },
      entries
    };
  }

  importBackup(backup) {
    const entries = Array.isArray(backup && backup.entries) ? backup.entries : [];
    this.importBackupTx(entries);
    return {
      success: true,
      count: entries.length
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

function createAppDataStore(app) {
  const dbPath = path.join(app.getPath('userData'), 'data', 'my_health_diary.sqlite3');
  return new SQLiteAppDataStore(dbPath);
}

module.exports = {
  SQLiteAppDataStore,
  createAppDataStore
};
