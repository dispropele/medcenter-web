/**
 * База данных на sql.js (pure JS/WASM, без компиляции).
 * Схема соответствует ER-диаграмме.
 * Данные строго соответствуют контрольному примеру из отчета.
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

    // Таблица 2.1 - Специализации
    ['Терапевт','Кардиолог','Невролог','Хирург','Педиатр','Офтальмолог','Дерматолог']
      .forEach(s => db.prepare('INSERT INTO specializations(name) VALUES(?)').run(s));

    // Таблица 2.3 - Услуги
    [
      ['Первичный приём терапевта',   'Консультация врача общей практики', 800],
      ['Первичный приём кардиолога',  'Консультация кардиолога', 900],
      ['Первичный приём невролога',   'Консультация невролога', 900],
      ['Первичный приём хирурга',     'Хирургическая консультация', 1100],
      ['Первичный приём педиатра',    'Приём детского врача', 700],
      ['Первичный приём офтальмолога','Осмотр органов зрения', 850],
      ['Первичный приём дерматолога', 'Консультация дерматолога', 800],
      ['Общий анализ крови',          'Клиническое исследование крови', 450],
      ['Общий анализ мочи',           'Клиническое исследование мочи', 350],
      ['Биохимия крови',              'Биохимический анализ крови', 1200],
      ['ЭКГ',                         'Электрокардиография', 800],
      ['МРТ головного мозга',         'Магнитно-резонансная томография', 4500],
      ['Анализ крови на сахар',       'Глюкоза крови', 300],
      ['УЗИ органов брюшной полости', 'Ультразвуковое исследование', 2200],
      ['Проверка остроты зрения',     'Визометрия', 600],
    ].forEach(([n,d,p]) => db.prepare('INSERT INTO services(name,description,price) VALUES(?,?,?)').run(n,d,p));

    // Таблица 2.2 - Врачи
    const docData = [
      ['Иванов Алексей Николаевич',   'ivanov.a@medcenter.ru',   1],
      ['Смирнова Ольга Петровна',     'smirnova.o@medcenter.ru', 1],
      ['Петрова Мария Сергеевна',     'petrova.m@medcenter.ru',  2],
      ['Козлов Дмитрий Валерьевич',   'kozlov.d@medcenter.ru',   2],
      ['Сидоров Денис Витальевич',    'sidorov.d@medcenter.ru',  3],
      ['Козлова Ирина Александровна', 'kozlova.i@medcenter.ru',  4],
      ['Новикова Елена Павловна',     'novikova.e@medcenter.ru', 5],
      ['Смирнов Антон Юрьевич',       'smirnov.a@medcenter.ru',  6],
      ['Морозова Татьяна Ивановна',   'morozova.t@medcenter.ru', 7],
    ];
    const dIds = docData.map(([name,email,sid]) => {
      const r = db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,'doctor123','doctor');
      return db.prepare('INSERT INTO doctors(user_id,spec_id) VALUES(?,?)').run(r.lastInsertRowid,sid).lastInsertRowid;
    });

    // Таблица 2.4 - Пациенты
    const patData = [
      ['Иванов Иван Иванович',          'ivanov.p@mail.ru',    '+7 (999) 123-45-67','01.01.1985','М','г. Самара, ул. Ленина, 1'],
      ['Петрова Мария Сергеевна',       'petrova.p@gmail.com', '+7 (999) 234-56-78','15.06.1992','Ж','г. Тольятти, ул. Мира, 5'],
      ['Сидоров Дмитрий Павлович',      'sidorov.p@yandex.ru', '+7 (999) 345-67-89','22.03.1978','М','г. Самара, пр. Победы, 10'],
      ['Козлова Ирина Александровна',   'kozlova.p@mail.ru',   '+7 (999) 456-78-90','08.11.2000','Ж','г. Тольятти, ул. Садовая, 3'],
      ['Морозов Алексей Юрьевич',       'morozov.p@inbox.ru',  '+7 (999) 567-89-01','30.07.1975','М','г. Самара, ул. Пушкина, 7'],
      ['Новикова Светлана Николаевна',  'novikova.p@gmail.com','+7 (999) 678-90-12','19.09.1988','Ж','г. Самара, ул. Гагарина, 2'],
      ['Кузнецов Андрей Владимирович',  'kuznetsov.p@mail.ru', '+7 (999) 111-22-33','05.04.1980','М','г. Самара, ул. Советская, 14'],
      ['Попова Наталья Игоревна',       'popova.p@mail.ru',    '+7 (999) 222-33-44','12.08.1995','Ж','г. Тольятти, пр. Ленина, 22'],
      ['Васильев Олег Петрович',        'vasiliev.p@mail.ru',  '+7 (999) 333-44-55','28.02.1970','М','г. Самара, ул. Октябрьская, 7'],
      ['Зайцева Анна Михайловна',       'zaitseva.p@mail.ru',  '+7 (999) 444-55-66','16.05.1999','Ж','г. Тольятти, ул. Кирова, 3'],
      ['Орлов Виктор Сергеевич',        'orlov.p@mail.ru',     '+7 (999) 555-66-77','07.09.1965','М','г. Самара, ул. Весенняя, 11'],
      ['Фёдорова Екатерина Андреевна',  'fedorova.p@mail.ru',  '+7 (999) 666-77-88','23.11.1987','Ж','г. Самара, пр. Победы, 8'],
      ['Соколов Игорь Николаевич',      'sokolov.p@mail.ru',   '+7 (999) 777-88-99','14.06.1993','М','г. Тольятти, ул. Цветочная, 6'],
      ['Павлова Ирина Владимировна',    'pavlova.p@mail.ru',   '+7 (999) 888-99-00','03.03.1982','Ж','г. Самара, ул. Молодёжная, 4'],
      ['Александров Дмитрий Олегович',  'aleksandrov@mail.ru', '+7 (999) 999-00-11','19.07.1977','М','г. Тольятти, ул. Рабочая, 9'],
    ];
    const pIds = patData.map(([name,email,phone,dob,gender,address]) =>
      db.prepare('INSERT INTO users(name,email,password,role,phone,dob,gender,address) VALUES(?,?,?,?,?,?,?,?)')
        .run(name,email,'123456','patient',phone,dob,gender,address).lastInsertRowid
    );

    // Таблица 2.5 - Записи к врачу
    const apptData = [
      [pIds[0],  dIds[2], '15.03.2026 10:30', 'Ожидает', 'Боли в груди'],
      [pIds[0],  dIds[0], '10.03.2026 14:00', 'Принят',  '—'],
      [pIds[1],  dIds[4], '18.03.2026 09:00', 'Ожидает', 'Головные боли'],
      [pIds[2],  dIds[5], '12.03.2026 11:00', 'Отменён', 'Отмена по звонку'],
      [pIds[3],  dIds[6], '20.03.2026 13:30', 'Ожидает', '—'],
      [pIds[4],  dIds[7], '22.03.2026 15:00', 'Ожидает', 'Ухудшение зрения'],
      [pIds[1],  dIds[1], '25.03.2026 10:00', 'Ожидает', 'Плановый осмотр'],
      [pIds[5],  dIds[8], '26.03.2026 09:30', 'Ожидает', 'Сыпь на коже'],
      [pIds[6],  dIds[0], '27.03.2026 11:00', 'Принят',  'Кашель, температура'],
      [pIds[7],  dIds[3], '28.03.2026 14:00', 'Ожидает', 'Аритмия'],
      [pIds[8],  dIds[4], '29.03.2026 09:00', 'Ожидает', 'Мигрень'],
      [pIds[9],  dIds[6], '30.03.2026 10:30', 'Принят',  '—'],
      [pIds[10], dIds[1], '01.04.2026 13:00', 'Ожидает', 'Повышенное давление'],
      [pIds[11], dIds[7], '02.04.2026 15:30', 'Принят',  'Снижение зрения'],
      [pIds[12], dIds[5], '03.04.2026 11:00', 'Принят',  'Плановый осмотр'],
      [pIds[13], dIds[8], '04.04.2026 09:30', 'Ожидает', 'Дерматит'],
      [pIds[14], dIds[2], '05.04.2026 10:00', 'Ожидает', 'Боли в области сердца'],
      [pIds[0],  dIds[4], '06.04.2026 14:00', 'Ожидает', 'Головокружение'],
      [pIds[4],  dIds[0], '07.04.2026 09:00', 'Ожидает', 'Простуда, кашель'],
      [pIds[3],  dIds[8], '08.04.2026 11:30', 'Ожидает', 'Аллергическая реакция'],
    ];
    const aIds = apptData.map(a =>
      db.prepare('INSERT INTO appointments(patient_id,doctor_id,datetime,status,notes) VALUES(?,?,?,?,?)').run(...a).lastInsertRowid
    );

    // Таблица 2.6 - Посещения (связь с номером записи)
    const visitsMap = [
      [aIds[1],  'ОРВИ. Рекомендован постельный режим и обильное питьё.', 'Нет', '10.03.2026'],
      [aIds[0],  'Нестабильная стенокардия. Рекомендована ЭКГ, консультация кардиолога.', 'Аспирин', '15.03.2026'],
      [aIds[8],  'Острый бронхит. Рекомендован постельный режим, антибиотикотерапия.', 'Нет', '27.03.2026'],
      [aIds[11], 'ОРЗ лёгкой степени. Рекомендовано симптоматическое лечение.', 'Пенициллин', '30.03.2026'],
      [aIds[13], 'Астигматизм средней степени. Рекомендовано ношение очков.', 'Нет', '02.04.2026'],
      [aIds[14], 'Варикозная болезнь нижних конечностей 1 ст. Рекомендован компрессионный трикотаж.', 'Нет', '03.04.2026'],
      [aIds[4],  'ОРЗ лёгкой степени. Рекомендовано симптоматическое лечение.', 'Нет', '20.03.2026'],
      [aIds[5],  'Миопия средней степени. Рекомендовано ношение очков или контактных линз.', 'Нет', '22.03.2026'],
      [aIds[6],  'Астенический синдром. Рекомендован отдых, витаминотерапия.', 'Нет', '25.03.2026'],
      [aIds[9],  'Синусовая аритмия. Рекомендовано ЭКГ-мониторирование.', 'Нет', '28.03.2026'],
      [aIds[10], 'Мигрень с аурой. Рекомендован приём триптанов.', 'Нет', '29.03.2026'],
      [aIds[12], 'Гипертоническая болезнь I ст. Рекомендована медикаментозная коррекция.', 'Нет', '01.04.2026'],
      [aIds[15], 'Экзема кистей хроническая. Рекомендована местная противовоспалительная терапия.', 'Нет', '04.04.2026'],
      [aIds[7],  'Атопический дерматит. Рекомендовано применение эмолентов.', 'Нет', '26.03.2026'],
      [aIds[2],  'Хроническая мигрень. Рекомендовано МРТ головного мозга.', 'Нет', '18.03.2026'],
    ];
    const vIds = visitsMap.map(v => 
      db.prepare('INSERT INTO visits(appointment_id,diagnosis,allergy,updated_at) VALUES(?,?,?,?)').run(...v).lastInsertRowid
    );

    // Таблица 2.7 - Табличная часть документа «Посещение»
    const analysesMap = [
      [vIds[1],  11, '15.03.2026', 'Ожидается'],
      [vIds[1],   8, '15.03.2026', 'Гемоглобин 132 г/л, норма'],
      [vIds[0],   8, '10.03.2026', 'Норма'],
      [vIds[0],   9, '10.03.2026', 'Норма'],
      [vIds[6],   9, '20.03.2026', 'Норма'],
      [vIds[7],  15, '22.03.2026', 'Миопия -2.0 Дптр'],
      [vIds[8],  10, '25.03.2026', 'Норма'],
      [vIds[13], 13, '26.03.2026', '5.2 ммоль/л, норма'],
      [vIds[2],   8, '27.03.2026', 'Лейкоциты 9.8, умеренный лейкоцитоз'],
      [vIds[9],  11, '28.03.2026', 'Синусовая аритмия, норма'],
      [vIds[14], 12, '18.03.2026', 'Ожидается'],
      [vIds[3],   8, '30.03.2026', 'Норма'],
      [vIds[11], 11, '01.04.2026', 'Ожидается'],
      [vIds[4],  15, '02.04.2026', 'Астигматизм 1.5 Дптр'],
      [vIds[5],  14, '03.04.2026', 'Ожидается'],
      [vIds[12],  8, '04.04.2026', 'Ожидается'],
      [vIds[10], 12, '29.03.2026', 'Без патологии'],
      [vIds[9],  10, '28.03.2026', 'Ожидается'],
    ];
    analysesMap.forEach(a => 
      db.prepare('INSERT INTO visit_analyses(visit_id,service_id,date_assigned,result) VALUES(?,?,?,?)').run(...a)
    );

    // Таблица 2.8 - Договоры
    const contractData = [
      [pIds[0], 2000, '10.03.2026'],
      [pIds[1], 5400, '18.03.2026'],
      [pIds[2], 1100, '12.03.2026'],
      [pIds[3], 1500, '20.03.2026'],
      [pIds[4], 1450, '22.03.2026'],
      [pIds[5], 1300, '26.03.2026'],
      [pIds[6],  800, '27.03.2026'],
      [pIds[7], 1400, '28.03.2026'],
      [pIds[8], 1800, '29.03.2026'],
      [pIds[9], 1150, '30.03.2026'],
    ];
    const cIds = contractData.map(c => 
      db.prepare('INSERT INTO contracts(patient_id,total,date) VALUES(?,?,?)').run(...c).lastInsertRowid
    );

    // Таблица 2.9 - Квитанции
    const receiptData = [
      [cIds[0], '10.03.2026', 2000, 'Оплачено'],
      [cIds[1], '18.03.2026', 5400, 'Ожидает оплаты'],
      [cIds[2], '12.03.2026', 1100, 'Оплачено'],
      [cIds[3], '20.03.2026', 1500, 'Оплачено'],
      [cIds[4], '22.03.2026', 1450, 'Ожидает оплаты'],
      [cIds[5], '26.03.2026', 1300, 'Оплачено'],
      [cIds[6], '27.03.2026',  800, 'Оплачено'],
      [cIds[7], '28.03.2026', 1400, 'Ожидает оплаты'],
      [cIds[8], '29.03.2026', 1800, 'Оплачено'],
      [cIds[9], '30.03.2026', 1150, 'Оплачено'],
    ];
    const rIds = receiptData.map(r => 
      db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(...r).lastInsertRowid
    );

    // Таблица 2.10 - Табличная часть документа «Квитанция» (с точными ценами из документа)
    [
      [rIds[0],  1, 1,  800], [rIds[0], 11, 1, 1200],
      [rIds[1],  3, 1,  900], [rIds[1], 12, 1, 4500],
      [rIds[2],  4, 1,  900], [rIds[2], 11, 1,  200],
      [rIds[3],  5, 1,  700], [rIds[3],  8, 1,  450], [rIds[3],  9, 1, 350],
      [rIds[4],  6, 1,  850], [rIds[4], 15, 1,  600],
      [rIds[5],  7, 1,  800], [rIds[5], 13, 1,  300], [rIds[5],  9, 1, 200],
      [rIds[6],  1, 1,  600], [rIds[6],  9, 1,  200],
      [rIds[7],  2, 1,  900], [rIds[7], 11, 1,  300], [rIds[7], 10, 1, 200],
      [rIds[8],  3, 1,  900], [rIds[8],  8, 1,  450], [rIds[8], 10, 1, 450],
      [rIds[9],  5, 1,  700], [rIds[9],  8, 1,  250], [rIds[9],  9, 1, 200],
    ].forEach(rs => 
      db.prepare('INSERT INTO receipt_services(receipt_id,service_id,qty,price) VALUES(?,?,?,?)').run(...rs)
    );

    // Таблица 2.11 - Чек
    const checkData = [
      [rIds[0], 2000, '10.03.2026', 'Наличные'],
      [rIds[2], 1100, '12.03.2026', 'Карта'],
      [rIds[3], 1500, '20.03.2026', 'Наличные'],
      [rIds[1], 5400, '19.04.2026', 'Карта'],
      [rIds[4], 1450, '23.03.2026', 'Наличные'],
      [rIds[5], 1300, '26.03.2026', 'Карта'],
      [rIds[6],  800, '27.03.2026', 'Наличные'],
      [rIds[8], 1800, '29.03.2026', 'Карта'],
      [rIds[9], 1150, '30.03.2026', 'Наличные'],
      [rIds[7], 1400, '01.04.2026', 'Перевод'],
    ];
    checkData.forEach(ch => 
      db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(...ch)
    );
  }

  return db;
};