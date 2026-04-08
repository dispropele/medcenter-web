const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');
const methodOverride = require('method-override');

let app;
let db;
let adminAgent;
let patientAgent;
let doctorAgent;

describe('Validations Tests', () => {
  beforeAll(async () => {
    const database = await require('../db/database')();
    db = database;

    app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(methodOverride('_method'));
    app.use(session({
      secret: 'test_secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 86400000 }
    }));
    app.use((req, res, next) => {
      res.locals.user = req.session.user || null;
      next();
    });

    const auth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
    const adminOnly = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.redirect('/dashboard');
    const staffOnly = (req, res, next) => ['admin', 'doctor'].includes(req.session.user?.role) ? next() : res.redirect('/dashboard');
    const safe = (v) => (v === undefined || v === null) ? null : v;

    // Login
    app.post('/login', (req, res) => {
      const { email = '', password = '' } = req.body;
      const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
        .get(email.trim().toLowerCase(), password);
      if (!u) return res.status(401).json({ error: 'Invalid' });
      req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
      res.json({ success: true });
    });

    // Appointments (with overlap check)
    app.get('/appointments/new', auth, (req, res) => {
      const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();
      const patients = req.session.user.role !== 'patient'
        ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
        : null;
      res.render('appointments/new', { specs, patients, error: null, form: {} });
    });

    app.post('/appointments', auth, (req, res) => {
      const u = req.session.user;
      const { doctor_id, datetime, notes = '' } = req.body;
      const patient_id = u.role === 'patient' ? u.id : safe(req.body.patient_id);
      const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();
      const patients = u.role !== 'patient'
        ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
        : null;
      
      if (!patient_id || !doctor_id || !datetime)
        return res.status(400).json({ error: 'Заполните все поля' });
      
      // Check overlap
      const existing = db.prepare('SELECT id FROM appointments WHERE doctor_id=? AND datetime=?').get(doctor_id, datetime);
      if (existing) return res.status(400).json({ error: 'На это время у врача уже есть запись' });
      
      db.prepare('INSERT INTO appointments(patient_id,doctor_id,datetime,notes) VALUES(?,?,?,?)')
        .run(patient_id, doctor_id, datetime, notes);
      res.json({ success: true });
    });

    // Contracts (with date check)
    app.get('/contracts/new', auth, adminOnly, (req, res) => {
      const patients = db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all();
      res.render('contracts/new', { patients, error: null, form: {} });
    });

    app.post('/contracts', auth, adminOnly, (req, res) => {
      const { patient_id, date, total = 0 } = req.body;
      const patients = db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all();
      
      if (!patient_id) return res.status(400).json({ error: 'Выберите пациента' });
      if (!date) return res.status(400).json({ error: 'Укажите дату' });
      
      const today = new Date().toISOString().split('T')[0];
      const contractDate = date.includes('-') ? date : date.split('.').reverse().join('-');
      if (contractDate > today) return res.status(400).json({ error: 'Дата не может быть больше текущей' });
      
      const cid = db.prepare('INSERT INTO contracts(patient_id,total,date) VALUES(?,?,?)').run(patient_id, parseFloat(total) || 0, date).lastInsertRowid;
      res.json({ id: cid });
    });

    // Receipts (with duplicate service check)
    app.get('/receipts/new', auth, adminOnly, (req, res) => {
      const contracts = db.prepare(`
        SELECT c.*, u.name patient_name FROM contracts c
        JOIN users u ON c.patient_id=u.id ORDER BY c.date DESC
      `).all();
      const services = db.prepare('SELECT * FROM services ORDER BY name').all();
      res.render('receipts/new', { contracts, services, error: null, form: {} });
    });

    app.post('/receipts', auth, adminOnly, (req, res) => {
      const { contract_id, date } = req.body;
      const nameArr = req.body.svc_name ? (Array.isArray(req.body.svc_name) ? req.body.svc_name : [req.body.svc_name]) : [];
      const sidArr = req.body.svc_id ? (Array.isArray(req.body.svc_id) ? req.body.svc_id : [req.body.svc_id]) : [];
      const priceArr = req.body.price ? (Array.isArray(req.body.price) ? req.body.price : [req.body.price]) : [];
      const qtyArr = req.body.qty ? (Array.isArray(req.body.qty) ? req.body.qty : [req.body.qty]) : [];

      if (!contract_id) return res.status(400).json({ error: 'Выберите договор' });
      if (!date) return res.status(400).json({ error: 'Укажите дату' });
      
      const validIdx = nameArr.map((n, i) => i).filter(i => nameArr[i] && nameArr[i].trim());
      if (!validIdx.length) return res.status(400).json({ error: 'Добавьте хотя бы одну услугу' });

      // Check zero price
      const zeroPrice = validIdx.find(i => !priceArr[i] || parseFloat(priceArr[i]) === 0);
      if (zeroPrice !== undefined) return res.status(400).json({ error: 'Все услуги должны иметь стоимость больше нуля' });

      // Check duplicate services
      const usedServices = new Set();
      for (let i of validIdx) {
        const svcId = sidArr[i];
        if (usedServices.has(svcId)) return res.status(400).json({ error: 'Эта услуга уже добавлена в квитанцию' });
        usedServices.add(svcId);
      }

      const total = validIdx.reduce((s, i) => s + (parseFloat(priceArr[i]) || 0) * (parseInt(qtyArr[i]) || 1), 0);
      const rid = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(contract_id, date, total, 'Ожидает оплаты').lastInsertRowid;
      const ins = db.prepare('INSERT INTO receipt_services(receipt_id,service_id,qty,price) VALUES(?,?,?,?)');
      validIdx.forEach(i => ins.run(rid, sidArr[i] || null, parseInt(qtyArr[i]) || 1, parseFloat(priceArr[i]) || 0));
      const contractTotal = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE contract_id=?').get(contract_id).s;
      db.prepare('UPDATE contracts SET total=? WHERE id=?').run(contractTotal, contract_id);
      res.json({ id: rid });
    });

    // Specializations
    app.post('/admin/specializations', auth, adminOnly, (req, res) => {
      const { name = '' } = req.body;
      const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();
      
      if (!name.trim()) return res.status(400).json({ error: 'Не введено наименование специализации' });
      if (name.trim().length < 3) return res.status(400).json({ error: 'Специализация не короче 3 символов' });
      if (name.trim().length > 100) return res.status(400).json({ error: 'Специализация не длиннее 100 символов' });
      if (!/^[а-яА-ЯёЁ\s\-]+$/.test(name.trim())) return res.status(400).json({ error: 'Только русские буквы' });
      
      try {
        db.prepare('INSERT INTO specializations(name) VALUES(?)').run(name.trim());
        res.json({ success: true });
      } catch {
        res.status(400).json({ error: 'Специализация уже существует' });
      }
    });

    // Services
    app.post('/admin/services', auth, adminOnly, (req, res) => {
      const { name = '', description = '', price = 0 } = req.body;
      
      if (!name.trim()) return res.status(400).json({ error: 'Не введено название услуги' });
      if (name.trim().length < 3) return res.status(400).json({ error: 'Название не короче 3 символов' });
      if (name.trim().length > 100) return res.status(400).json({ error: 'Название не длиннее 100 символов' });
      if (description.length > 500) return res.status(400).json({ error: 'Описание не длиннее 500 символов' });
      
      const priceNum = parseFloat(price) || 0;
      if (priceNum < 0) return res.status(400).json({ error: 'Цена не может быть отрицательной' });
      if (priceNum === 0) return res.status(400).json({ error: 'Цена должна быть больше нуля' });
      
      try {
        db.prepare('INSERT INTO services(name,description,price) VALUES(?,?,?)').run(name.trim(), description, priceNum);
        res.json({ success: true });
      } catch {
        res.status(400).json({ error: 'Услуга уже существует' });
      }
    });

    // Checks
    app.post('/checks', auth, adminOnly, (req, res) => {
      const { receipt_id, amount, date, payment_method = 'Наличные' } = req.body;
      
      if (!receipt_id || !amount || !date) return res.status(400).json({ error: 'Заполните все поля' });
      
      const amountNum = parseFloat(amount) || 0;
      if (amountNum <= 0) return res.status(400).json({ error: 'Сумма должна быть больше нуля' });
      
      const today = new Date().toISOString().split('T')[0];
      const checkDate = date.includes('-') ? date : date.split('.').reverse().join('-');
      if (checkDate > today) return res.status(400).json({ error: 'Дата не может быть в будущем' });
      
      const receipt = db.prepare('SELECT amount FROM receipts WHERE id=?').get(receipt_id);
      if (receipt && amountNum > receipt.amount) return res.status(400).json({ error: 'Сумма превышает сумму квитанции' });
      
      db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(receipt_id, amountNum, date, payment_method);
      db.prepare("UPDATE receipts SET status='Оплачено' WHERE id=?").run(receipt_id);
      res.json({ success: true });
    });

    adminAgent = request.agent(app);
    patientAgent = request.agent(app);
    doctorAgent = request.agent(app);

    // Login all agents
    await adminAgent.post('/login')
      .send({ email: 'admin@medcenter.ru', password: 'admin123' });
    await patientAgent.post('/login')
      .send({ email: 'ivanov.p@mail.ru', password: '123456' });
    await doctorAgent.post('/login')
      .send({ email: 'ivanov@medcenter.ru', password: 'doctor123' });
  });

  // ════════════════════════════════════════════════════════════
  // APPOINTMENTS VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Appointments Validations', () => {
    test('should reject appointment with missing fields', async () => {
      const res = await patientAgent.post('/appointments')
        .send({ doctor_id: '', datetime: '', notes: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Заполните все поля');
    });

    test('should reject appointment with duplicate doctor time', async () => {
      // Get a doctor ID first
      const docs = db.prepare(`SELECT d.id FROM doctors d LIMIT 1`).all();
      if (!docs.length) return;
      const doctorId = docs[0].id;

      // Create first appointment
      await patientAgent.post('/appointments')
        .send({ doctor_id: doctorId, datetime: '15.04.2026 10:00', notes: '' });

      // Try to create duplicate
      const res2 = await patientAgent.post('/appointments')
        .send({ doctor_id: doctorId, datetime: '15.04.2026 10:00', notes: '' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('На это время у врача уже есть запись');
    });
  });

  // ════════════════════════════════════════════════════════════
  // CONTRACTS VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Contracts Validations', () => {
    test('should reject contract without patient', async () => {
      const today = new Date();
      const dateStr = today.toLocaleDateString('ru-RU');
      const res = await adminAgent.post('/contracts')
        .send({ patient_id: '', date: dateStr });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Выберите пациента');
    });

    test('should reject contract with future date', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const futureDate = tomorrow.toLocaleDateString('ru-RU');

      const patients = db.prepare("SELECT id FROM users WHERE role='patient' LIMIT 1").all();
      if (!patients.length) return;

      const res = await adminAgent.post('/contracts')
        .send({ patient_id: patients[0].id, date: futureDate });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Дата не может быть больше текущей');
    });
  });

  // ════════════════════════════════════════════════════════════
  // RECEIPTS VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Receipts Validations', () => {
    test('should reject receipt without contract', async () => {
      const today = new Date();
      const dateStr = today.toLocaleDateString('ru-RU');
      const res = await adminAgent.post('/receipts')
        .send({ contract_id: '', date: dateStr });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Выберите договор');
    });

    test('should reject receipt with zero-price service', async () => {
      const contracts = db.prepare('SELECT id FROM contracts LIMIT 1').all();
      if (!contracts.length) return;
      const today = new Date();
      const dateStr = today.toLocaleDateString('ru-RU');

      const res = await adminAgent.post('/receipts')
        .send({
          contract_id: contracts[0].id,
          date: dateStr,
          svc_name: ['Анализ'],
          svc_id: [1],
          price: [0],
          qty: [1]
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Все услуги должны иметь стоимость больше нуля');
    });

    test('should reject receipt with duplicate service', async () => {
      const contracts = db.prepare('SELECT id FROM contracts LIMIT 1').all();
      if (!contracts.length) return;
      const today = new Date();
      const dateStr = today.toLocaleDateString('ru-RU');

      const res = await adminAgent.post('/receipts')
        .send({
          contract_id: contracts[0].id,
          date: dateStr,
          svc_name: ['Анализ', 'Анализ'],
          svc_id: [1, 1],
          price: [100, 100],
          qty: [1, 1]
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Эта услуга уже добавлена в квитанцию');
    });
  });

  // ════════════════════════════════════════════════════════════
  // SPECIALIZATIONS VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Specializations Validations', () => {
    test('should reject empty specialization name', async () => {
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Не введено наименование специализации');
    });

    test('should reject specialization name too short', async () => {
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: 'AB' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Специализация не короче 3 символов');
    });

    test('should reject specialization name too long', async () => {
      const longName = 'А'.repeat(101);
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: longName });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Специализация не длиннее 100 символов');
    });

    test('should reject specialization with non-russian chars', async () => {
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: 'Cardiology123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Только русские буквы');
    });
  });

  // ════════════════════════════════════════════════════════════
  // SERVICES VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Services Validations', () => {
    test('should reject empty service name', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: '', description: '', price: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Не введено название услуги');
    });

    test('should reject service name too short', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'AB', description: '', price: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Название не короче 3 символов');
    });

    test('should reject service name too long', async () => {
      const longName = 'А'.repeat(101);
      const res = await adminAgent.post('/admin/services')
        .send({ name: longName, description: '', price: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Название не длиннее 100 символов');
    });

    test('should reject negative price', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'УЗИ диагностика', description: '', price: -100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Цена не может быть отрицательной');
    });

    test('should reject zero price', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'УЗИ диагностика', description: '', price: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Цена должна быть больше нуля');
    });

    test('should reject description too long', async () => {
      const longDesc = 'А'.repeat(501);
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'УЗИ диагностика', description: longDesc, price: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Описание не длиннее 500 символов');
    });
  });

  // ════════════════════════════════════════════════════════════
  // CHECKS VALIDATIONS
  // ════════════════════════════════════════════════════════════
  describe('Checks Validations', () => {
    test('should reject check with missing fields', async () => {
      const res = await adminAgent.post('/checks')
        .send({ receipt_id: '', amount: '', date: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Заполните все поля');
    });

    test('should create valid check', async () => {
      const receipts = db.prepare('SELECT id FROM receipts LIMIT 1').all();
      if (!receipts.length) return;

      const today = new Date();
      const dateStr = today.toLocaleDateString('ru-RU');

      const res = await adminAgent.post('/checks')
        .send({ receipt_id: receipts[0].id, amount: 100, date: dateStr, payment_method: 'Наличные' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
