/**
 * База данных на sql.js (pure JS/WASM, без компиляции).
 * Схема соответствует ER-диаграмме:
 *   Специализация → Врач → Записи к врачу → Посещение → Анализы посещения
 *   Пациент → Записи к врачу, Договор → Квитанция → Чек
 *   Услуги ← Анализы посещения, Услуги в квитанции
 */
const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'medcenter.db');

module.exports = async function createDb() {
  const SQL   = await initSqlJs();
  const sqlDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  const save = () => fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));
  const lastId = () => {
    const r = sqlDb.exec('SELECT last_insert_rowid()');
    return r.length ? Number(r[0].values[0][0]) : 0;
  };
  const toArr = (args) => {
    if (!args.length) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return Array.from(args);
  };

  function prepare(sql) {
    return {
      get() {
        const p = toArr(arguments), st = sqlDb.prepare(sql);
        if (p.length) st.bind(p);
        const row = st.step() ? st.getAsObject() : undefined;
        st.free(); return row;
      },
      all() {
        const p = toArr(arguments), st = sqlDb.prepare(sql), rows = [];
        if (p.length) st.bind(p);
        while (st.step()) rows.push(st.getAsObject());
        st.free(); return rows;
      },
      run() {
        const p = toArr(arguments), st = sqlDb.prepare(sql);
        if (p.length) st.bind(p);
        st.step(); st.free();
        const lid = lastId(); save();
        return { lastInsertRowid: lid, changes: sqlDb.getRowsModified() };
      }
    };
  }

  const db = {
    exec(s) { sqlDb.exec(s); save(); return this; },
    prepare,
    save
  };

  // ── Схема ──────────────────────────────────────────────────────────────────
  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      email    TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role     TEXT NOT NULL DEFAULT 'patient',
      phone    TEXT DEFAULT '',
      dob      TEXT DEFAULT '',
      gender   TEXT DEFAULT '',
      address  TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS specializations (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS doctors (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      spec_id INTEGER NOT NULL REFERENCES specializations(id)
    );
    CREATE TABLE IF NOT EXISTS services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      price       REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES users(id),
      doctor_id  INTEGER NOT NULL REFERENCES doctors(id),
      datetime   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'Ожидает',
      notes      TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS visits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
      diagnosis      TEXT DEFAULT '',
      allergy        TEXT DEFAULT '',
      updated_at     TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS visit_analyses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id    INTEGER NOT NULL REFERENCES visits(id),
      service_id  INTEGER NOT NULL REFERENCES services(id),
      date_assigned TEXT NOT NULL,
      result      TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id   INTEGER NOT NULL REFERENCES visits(id),
      patient_id INTEGER NOT NULL REFERENCES users(id),
      total      REAL NOT NULL DEFAULT 0,
      date       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER REFERENCES contracts(id),
      date        TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'Ожидает оплаты'
    );
    CREATE TABLE IF NOT EXISTS receipt_services (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES receipts(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      qty        INTEGER NOT NULL DEFAULT 1,
      price      REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS checks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id     INTEGER NOT NULL REFERENCES receipts(id),
      amount         REAL NOT NULL,
      date           TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Наличные'
    );
  `);
  save();

  // ── Seed ───────────────────────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    // Администратор
    db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)')
      .run('Администратор','admin@medcenter.ru','admin123','admin');

    // Специализации
    ['Терапевт','Кардиолог','Невролог','Хирург','Педиатр','Офтальмолог','Дерматолог']
      .forEach(s => db.prepare('INSERT INTO specializations(name) VALUES(?)').run(s));

    // Услуги
    [
      ['Первичный приём терапевта',   'Консультация врача общей практики', 800],
      ['Первичный приём кардиолога',  'Консультация кардиолога',            900],
      ['Первичный приём невролога',   'Консультация невролога',             900],
      ['Первичный приём хирурга',     'Хирургическая консультация',        1100],
      ['Первичный приём педиатра',    'Приём детского врача',               700],
      ['Первичный приём офтальмолога','Осмотр органов зрения',              850],
      ['Общий анализ крови',          'Клинический анализ крови',           450],
      ['Общий анализ мочи',           'Клинический анализ мочи',            350],
      ['Биохимия крови',              'Биохимический анализ крови',        1200],
      ['ЭКГ',                         'Электрокардиография',                800],
      ['МРТ головного мозга',         'Магнитно-резонансная томография',   4500],
      ['УЗИ органов брюшной полости', 'Ультразвуковое исследование',       2200],
      ['Глюкоза крови',               'Анализ уровня глюкозы',              300],
      ['Проверка остроты зрения',     'Визометрия',                         600],
    ].forEach(([n,d,p]) => db.prepare('INSERT INTO services(name,description,price) VALUES(?,?,?)').run(n,d,p));

    // Врачи
    const docData = [
      ['Иванов Алексей Николаевич',   'ivanov@medcenter.ru',    1],
      ['Смирнова Ольга Петровна',     'smirnova@medcenter.ru',  1],
      ['Петрова Мария Сергеевна',     'petrova@medcenter.ru',   2],
      ['Козлов Дмитрий Валерьевич',  'kozlov@medcenter.ru',    2],
      ['Сидоров Денис Витальевич',    'sidorov@medcenter.ru',   3],
      ['Козлова Ирина Александровна', 'kozlova.i@medcenter.ru', 4],
      ['Новикова Елена Павловна',     'novikova@medcenter.ru',  5],
      ['Смирнов Антон Юрьевич',      'smirnov.a@medcenter.ru', 6],
      ['Морозова Татьяна Ивановна',  'morozova@medcenter.ru',  7],
    ];
    const dIds = docData.map(([name,email,sid]) => {
      const r = db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,'doctor123','doctor');
      return db.prepare('INSERT INTO doctors(user_id,spec_id) VALUES(?,?)').run(r.lastInsertRowid,sid).lastInsertRowid;
    });

    // Пациенты
    const patData = [
      ['Иванов Иван Иванович',          'ivanov.p@mail.ru',    '+7 (999) 123-45-67','01.01.1985','М','ул. Ленина, 1'],
      ['Петрова Мария Сергеевна',       'petrova.m@gmail.com', '+7 (999) 234-56-78','15.06.1992','Ж','ул. Мира, 5'],
      ['Сидоров Дмитрий Павлович',      'sidorov.d@yandex.ru', '+7 (999) 345-67-89','22.03.1978','М','пр. Победы, 10'],
      ['Козлова Ирина Александровна',   'kozlova.ir@mail.ru',  '+7 (999) 456-78-90','08.11.2000','Ж','ул. Садовая, 3'],
      ['Морозов Алексей Юрьевич',       'morozov.a@inbox.ru',  '+7 (999) 567-89-01','30.07.1975','М','ул. Пушкина, 7'],
      ['Новикова Светлана Николаевна',  'novikova.s@gmail.com','+7 (999) 678-90-12','19.09.1988','Ж','ул. Гагарина, 2'],
    ];
    const pIds = patData.map(([name,email,phone,dob,gender,address]) =>
      db.prepare('INSERT INTO users(name,email,password,role,phone,dob,gender,address) VALUES(?,?,?,?,?,?,?,?)')
        .run(name,email,'123456','patient',phone,dob,gender,address).lastInsertRowid
    );

    // Записи к врачу
    const apptData = [
      [pIds[0],dIds[2],'15.03.2026 10:30','Принят', 'Боли в области груди'],
      [pIds[0],dIds[0],'10.03.2026 14:00','Принят', ''],
      [pIds[1],dIds[4],'18.03.2026 09:00','Ожидает','Головные боли'],
      [pIds[2],dIds[5],'12.03.2026 11:00','Отменён',''],
      [pIds[3],dIds[6],'20.03.2026 13:30','Ожидает',''],
      [pIds[4],dIds[7],'22.03.2026 15:00','Ожидает','Ухудшение зрения'],
      [pIds[1],dIds[1],'25.03.2026 10:00','Ожидает','Плановый осмотр'],
    ];
    const aIds = apptData.map(a =>
      db.prepare('INSERT INTO appointments(patient_id,doctor_id,datetime,status,notes) VALUES(?,?,?,?,?)').run(...a).lastInsertRowid
    );

    // Посещения
    const v1 = db.prepare('INSERT INTO visits(appointment_id,diagnosis,allergy,updated_at) VALUES(?,?,?,?)')
      .run(aIds[0],'Нестабильная стенокардия. Рекомендована ЭКГ.','Аспирин','2026-03-15 11:30').lastInsertRowid;
    const v2 = db.prepare('INSERT INTO visits(appointment_id,diagnosis,allergy,updated_at) VALUES(?,?,?,?)')
      .run(aIds[1],'ОРВИ. Рекомендован постельный режим.','Нет','2026-03-10 15:00').lastInsertRowid;

    // Анализы посещений
    db.prepare('INSERT INTO visit_analyses(visit_id,service_id,date_assigned,result) VALUES(?,?,?,?)').run(v1,10,'15.03.2026','');
    db.prepare('INSERT INTO visit_analyses(visit_id,service_id,date_assigned,result) VALUES(?,?,?,?)').run(v2, 7,'10.03.2026','Норма');

    // Договоры
    const c1 = db.prepare('INSERT INTO contracts(visit_id,patient_id,total,date) VALUES(?,?,?,?)').run(v1,pIds[0],2000,'10.03.2026').lastInsertRowid;
    const c2 = db.prepare('INSERT INTO contracts(visit_id,patient_id,total,date) VALUES(?,?,?,?)').run(v2,pIds[1],5400,'18.03.2026').lastInsertRowid;
    const c3 = db.prepare('INSERT INTO contracts(visit_id,patient_id,total,date) VALUES(?,?,?,?)').run(v1,pIds[2],1100,'12.03.2026').lastInsertRowid;
    const c4 = db.prepare('INSERT INTO contracts(visit_id,patient_id,total,date) VALUES(?,?,?,?)').run(v2,pIds[3],1500,'20.03.2026').lastInsertRowid;

    // Квитанции
    const r1 = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(c1,'10.03.2026',2000,'Оплачено').lastInsertRowid;
    const r2 = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(c2,'18.03.2026',5400,'Ожидает оплаты').lastInsertRowid;
    const r3 = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(c3,'12.03.2026',1100,'Оплачено').lastInsertRowid;
    const r4 = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(c4,'20.03.2026',1500,'Оплачено').lastInsertRowid;

    // Услуги в квитанциях
    [
      [r1,2,1,800],[r1,10,1,1200],
      [r2,3,1,900],[r2,11,1,4500],
      [r3,4,1,1100],
      [r4,5,1,700],[r4,7,1,450],[r4,8,1,350],
    ].forEach(([rid,sid,qty,price]) =>
      db.prepare('INSERT INTO receipt_services(receipt_id,service_id,qty,price) VALUES(?,?,?,?)').run(rid,sid,qty,price)
    );

    // Чеки
    db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(r1,2000,'10.03.2026','Наличные');
    db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(r3,1100,'12.03.2026','Карта');
    db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(r4,1500,'20.03.2026','Наличные');
  }

  return db;
};
