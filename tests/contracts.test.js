const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let adminAgent;

describe('Contracts Tests', () => {
  beforeAll(async () => {
    const database = await require('../db/database')();
    db = database;

    app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
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

    app.post('/login', (req, res) => {
      const { email = '', password = '' } = req.body;
      const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
        .get(email.trim().toLowerCase(), password);
      if (!u) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
      res.json({ success: true });
    });

    app.get('/contracts', auth, adminOnly, (req, res) => {
      const rows = db.prepare(`
        SELECT c.*, u.name patient_name,
          (SELECT COUNT(*) FROM receipts WHERE contract_id=c.id) receipt_count
        FROM contracts c JOIN users u ON c.patient_id=u.id
        ORDER BY substr(c.date,7,4)||substr(c.date,4,2)||substr(c.date,1,2) DESC
      `).all();
      res.json({ contracts: rows });
    });

    app.get('/contracts/new', auth, adminOnly, (req, res) => {
      const patients = db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all();
      res.json({ patients });
    });

    app.post('/contracts', auth, adminOnly, (req, res) => {
      const { patient_id, date, total = 0 } = req.body;

      if (!patient_id) return res.status(400).json({ error: 'Choose patient' });
      if (!date) return res.status(400).json({ error: 'Enter date' });

      const cid = db.prepare('INSERT INTO contracts(patient_id,total,date) VALUES(?,?,?)')
        .run(patient_id, parseFloat(total) || 0, date).lastInsertRowid;

      res.json({ success: true, id: cid });
    });

    app.get('/contracts/:id', auth, adminOnly, (req, res) => {
      const contract = db.prepare(`
        SELECT c.*,u.name patient_name,u.phone,u.dob,u.address 
        FROM contracts c 
        JOIN users u ON c.patient_id=u.id 
        WHERE c.id=?
      `).get(req.params.id);

      if (!contract) return res.status(404).json({ error: 'Contract not found' });

      const receipts = db.prepare(`
        SELECT r.*, (SELECT COUNT(*) FROM checks WHERE receipt_id=r.id) paid
        FROM receipts r WHERE r.contract_id=? ORDER BY r.date DESC
      `).all(req.params.id);

      res.json({ contract, receipts });
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
  });

  test('GET /contracts - should return all contracts', async () => {
    const res = await adminAgent.get('/contracts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contracts)).toBe(true);
  });

  test('GET /contracts/new - should return patients list', async () => {
    const res = await adminAgent.get('/contracts/new');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });

  test('POST /contracts - should fail without patient_id', async () => {
    const res = await adminAgent.post('/contracts')
      .send({ date: '01.04.2026', total: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Choose patient');
  });

  test('POST /contracts - should fail without date', async () => {
    const res = await adminAgent.post('/contracts')
      .send({ patient_id: 1, total: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Enter date');
  });

  test('POST /contracts - should create new contract', async () => {
    const res = await adminAgent.post('/contracts')
      .send({ patient_id: 1, date: '01.04.2026', total: 2500 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  test('GET /contracts/:id - should return contract details', async () => {
    const res = await adminAgent.get('/contracts/1');
    expect(res.status).toBe(200);
    expect(res.body.contract).toBeDefined();
    expect(res.body.contract.id).toBe(1);
    expect(Array.isArray(res.body.receipts)).toBe(true);
  });

  test('GET /contracts/:id - should return 404 for non-existent contract', async () => {
    const res = await adminAgent.get('/contracts/9999');
    expect(res.status).toBe(404);
  });

  test('GET /contracts - non-admin should be redirected', async () => {
    const patientAgent = request.agent(app);
    await patientAgent.post('/login').send({ email: 'ivanov.p@mail.ru', password: '123456' });
    const res = await patientAgent.get('/contracts');
    expect(res.status).toBe(302);
  });
});
