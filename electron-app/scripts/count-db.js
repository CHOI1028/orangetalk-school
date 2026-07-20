/* Electron 환경에서 실행: cd electron-app && npx electron scripts/count-db.js */
const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

app.whenReady().then(() => {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'MyHealthDiary'));
    const dbPath = path.join(app.getPath('userData'), 'data', 'my_health_diary.sqlite3');
    console.log('DB path:', dbPath);
    const db = new Database(dbPath, { readonly: true });
    const counts = {
      students: db.prepare('SELECT COUNT(*) c FROM students').get().c,
      students_info: db.prepare('SELECT COUNT(*) c FROM students_info').get().c,
      staff: db.prepare('SELECT COUNT(*) c FROM staff').get().c,
      daily_records: db.prepare('SELECT COUNT(*) c FROM daily_records').get().c,
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      emergency_records: db.prepare('SELECT COUNT(*) c FROM emergency_records').get().c,
      _tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),
      schema_meta: db.prepare('SELECT * FROM schema_meta').all(),
    };
    console.log(JSON.stringify(counts, null, 2));
    /* 학생 첫 3건 샘플 */
    const sample = db.prepare('SELECT uid, name, gender FROM students LIMIT 3').all();
    console.log('sample students:', JSON.stringify(sample));
    const sampleInfo = db.prepare('SELECT uid, school_year, grade, class_num, student_num FROM students_info LIMIT 3').all();
    console.log('sample info:', JSON.stringify(sampleInfo));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    app.quit();
  }
});
