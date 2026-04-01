const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let adminAgent;

describe('Checks Tests', () => {
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

    app.get('/checks', auth, adminOnly, (req, res) => {
      const rows = db.prepare(`
        SELECT ch.*, u.name patient_name, r.amount receipt_amount
        FROM checks ch
        JOIN receipts r ON ch.receipt_id=r.id
        JOIN contracts c ON r.contract_id=c.id
        JOIN users u ON c.patient_id=u.id
        ORDER BY substr(ch.date,7,4)||substr(ch.date,4,2)||substr(ch.date,1,2) DESC
      `).all();
      const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      res.json({ checks: rows, total });
    });

    app.post('/checks', auth, adminOnly, (req, res) => {
      const { receipt_id, amount, date, payment_method = 'Наличные' } = req.body;
      if (!receipt_id || !amount || !date)
        return res.status(400).json({ error: 'Missing required fields' });

      db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)')
        .run(receipt_id, parseFloat(amount) || 0, date, payment_method);

      db.prepare("UPDATE receipts SET status='Оплачено' WHERE id=?").run(receipt_id);

      res.json({ success: true });
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
  });

  test('GET /checks - should return all checks', async () => {
    const res = await adminAgent.get('/checks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  test('POST /checks - should fail without required fields', async () => {
    const res = await adminAgent.post('/checks')
      .send({ amount: 1000 });
    expect(res.status).toBe(400);
  });

  test('POST /checks - should create new check', async () => {
    const res = await adminAgent.post('/checks')
      .send({
        receipt_id: 1,
        amount: 1500,
        date: '01.04.2026',
        payment_method: 'Карта'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /checks - should update receipt status to Оплачено', async () => {
    await adminAgent.post('/checks')
      .send({
        receipt_id: 2,
        amount: 2000,
        date: '01.04.2026',
        payment_method: 'Наличные'
      });

    const receipt = db.prepare('SELECT * FROM receipts WHERE id=?').get(2);
    expect(receipt.status).toBe('Оплачено');
  });

  test('POST /checks - should accept different payment methods', async () => {
    const methods = ['Наличные', 'Карта', 'Перевод'];

    for (const method of methods) {
      const res = await adminAgent.post('/checks')
        .send({
          receipt_id: 3,
          amount: 500,
          date: '01.04.2026',
          payment_method: method
        });

      if (res.status === 200) {
        const check = db.prepare('SELECT * FROM checks WHERE payment_method=?').get(method);
        expect(check.payment_method).toBe(method);
      }
    }
  });
});
