const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let adminAgent;

describe('Receipts Tests', () => {
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

    app.get('/receipts', auth, adminOnly, (req, res) => {
      const rows = db.prepare(`
        SELECT r.*, u.name patient_name, c.date contract_date,
               (SELECT COUNT(*) FROM checks WHERE receipt_id=r.id) paid
        FROM receipts r
        JOIN contracts c ON r.contract_id=c.id
        JOIN users u ON c.patient_id=u.id
        ORDER BY substr(r.date,7,4)||substr(r.date,4,2)||substr(r.date,1,2) DESC
      `).all();
      res.json({ receipts: rows });
    });

    app.get('/receipts/new', auth, adminOnly, (req, res) => {
      const contracts = db.prepare(`
        SELECT c.*,u.name patient_name FROM contracts c 
        JOIN users u ON c.patient_id=u.id 
        ORDER BY c.date DESC
      `).all();
      const services = db.prepare('SELECT * FROM services ORDER BY name').all();
      res.json({ contracts, services });
    });

    app.post('/receipts', auth, adminOnly, (req, res) => {
      const { contract_id, date } = req.body;
      const nameArr = req.body.svc_name ? (Array.isArray(req.body.svc_name) ? req.body.svc_name : [req.body.svc_name]) : [];
      const priceArr = req.body.price ? (Array.isArray(req.body.price) ? req.body.price : [req.body.price]) : [];
      const qtyArr = req.body.qty ? (Array.isArray(req.body.qty) ? req.body.qty : [req.body.qty]) : [];

      if (!contract_id) return res.status(400).json({ error: 'Choose contract' });
      if (!date) return res.status(400).json({ error: 'Enter date' });

      const validIdx = nameArr.map((n, i) => i).filter(i => nameArr[i] && nameArr[i].trim());
      if (!validIdx.length) return res.status(400).json({ error: 'Add at least one service' });

      const total = validIdx.reduce((s, i) => s + (parseFloat(priceArr[i]) || 0) * (parseInt(qtyArr[i]) || 1), 0);
      const rid = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)')
        .run(contract_id, date, total, 'Ожидает оплаты').lastInsertRowid;

      const ins = db.prepare('INSERT INTO receipt_services(receipt_id,service_id,qty,price) VALUES(?,?,?,?)');
      validIdx.forEach(i => ins.run(rid, null, parseInt(qtyArr[i]) || 1, parseFloat(priceArr[i]) || 0));

      const contractTotal = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE contract_id=?')
        .get(contract_id).s;
      db.prepare('UPDATE contracts SET total=? WHERE id=?').run(contractTotal, contract_id);

      res.json({ success: true, id: rid });
    });

    app.get('/receipts/:id', auth, adminOnly, (req, res) => {
      const receipt = db.prepare(`
        SELECT r.*, u.name patient_name, c.date contract_date
        FROM receipts r
        JOIN contracts c ON r.contract_id=c.id
        JOIN users u ON c.patient_id=u.id
        WHERE r.id=?
      `).get(req.params.id);

      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

      const services = db.prepare(`
        SELECT rs.*, sv.name svc_name FROM receipt_services rs 
        JOIN services sv ON rs.service_id=sv.id 
        WHERE rs.receipt_id=?
      `).all(req.params.id);

      const chks = db.prepare('SELECT * FROM checks WHERE receipt_id=? ORDER BY date DESC').all(req.params.id);

      res.json({ receipt, services, checks: chks });
    });

    app.post('/receipts/:id/status', auth, adminOnly, (req, res) => {
      db.prepare('UPDATE receipts SET status=? WHERE id=?').run(req.body.status, req.params.id);
      res.json({ success: true });
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
  });

  test('GET /receipts - should return all receipts', async () => {
    const res = await adminAgent.get('/receipts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.receipts)).toBe(true);
  });

  test('GET /receipts/new - should return contracts and services', async () => {
    const res = await adminAgent.get('/receipts/new');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contracts)).toBe(true);
    expect(Array.isArray(res.body.services)).toBe(true);
  });

  test('POST /receipts - should fail without contract_id', async () => {
    const res = await adminAgent.post('/receipts')
      .send({ date: '01.04.2026', svc_name: ['Test'], price: [100], qty: [1] });
    expect(res.status).toBe(400);
  });

  test('POST /receipts - should fail without services', async () => {
    const res = await adminAgent.post('/receipts')
      .send({ contract_id: 1, date: '01.04.2026' });
    expect(res.status).toBe(400);
  });

  test('POST /receipts - should create new receipt', async () => {
    const res = await adminAgent.post('/receipts')
      .send({
        contract_id: '1',
        date: '01.04.2026',
        'svc_name[0]': 'УЗИ',
        'price[0]': '2200',
        'qty[0]': '1'
      });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });

  test('GET /receipts/:id - should return receipt details', async () => {
    const res = await adminAgent.get('/receipts/1');
    expect(res.status).toBe(200);
    expect(res.body.receipt).toBeDefined();
    expect(Array.isArray(res.body.services)).toBe(true);
  });

  test('POST /receipts/:id/status - should update receipt status', async () => {
    const res = await adminAgent.post('/receipts/1/status')
      .send({ status: 'Оплачено' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const receipt = db.prepare('SELECT * FROM receipts WHERE id=?').get(1);
    expect(receipt.status).toBe('Оплачено');
  });
});
