const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let adminAgent;

describe('Reports Tests', () => {
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

    app.get('/reports', auth, adminOnly, (req, res) => {
      const { from = '', to = '', type = '' } = req.query;
      let appointments = [], referrals = [];

      if (from && to) {
        const f = from.replace(/-/g, ''), t = to.replace(/-/g, '');
        const dconv = `substr(%s,7,4)||substr(%s,4,2)||substr(%s,1,2)`;
        const dcA = dconv.replace(/%s/g, 'a.datetime');
        const dcR = dconv.replace(/%s/g, 'va.date_assigned');

        if (!type || type === 'appointments') {
          appointments = db.prepare(`
            SELECT a.*, up.name patient_name, up.phone patient_phone,
                   ud.name doc_name, s.name spec_name
            FROM appointments a
            JOIN users up ON a.patient_id=up.id
            JOIN doctors d ON a.doctor_id=d.id
            JOIN users ud ON d.user_id=ud.id
            JOIN specializations s ON d.spec_id=s.id
            WHERE (${dcA}) >= ? AND (${dcA}) <= ?
            ORDER BY ${dcA}
          `).all(f, t);
        }

        if (!type || type === 'referrals') {
          referrals = db.prepare(`
            SELECT va.*, sv.name svc_name, sv.price svc_price,
                   up.name patient_name, ud.name doc_name
            FROM visit_analyses va
            JOIN services sv ON va.service_id=sv.id
            JOIN visits v ON va.visit_id=v.id
            JOIN appointments a ON v.appointment_id=a.id
            JOIN users up ON a.patient_id=up.id
            JOIN doctors d ON a.doctor_id=d.id
            JOIN users ud ON d.user_id=ud.id
            WHERE (${dcR}) >= ? AND (${dcR}) <= ?
            ORDER BY ${dcR}
          `).all(f, t);
        }
      }

      const fmt = d => d ? d.split('-').reverse().join('.') : '';
      res.json({ from, to, type, appointments, referrals, fmt: fmt(from) });
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
  });

  test('GET /reports - should render without date range', async () => {
    const res = await adminAgent.get('/reports');
    expect(res.status).toBe(200);
    expect(res.body.appointments).toEqual([]);
    expect(res.body.referrals).toEqual([]);
  });

  test('GET /reports - should return appointments for date range', async () => {
    const res = await adminAgent.get('/reports?from=2026-03-01&to=2026-03-31&type=appointments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.appointments)).toBe(true);
  });

  test('GET /reports - should return referrals for date range', async () => {
    const res = await adminAgent.get('/reports?from=2026-03-01&to=2026-03-31&type=referrals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.referrals)).toBe(true);
  });

  test('GET /reports - should return both types when no type specified', async () => {
    const res = await adminAgent.get('/reports?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.appointments)).toBe(true);
    expect(Array.isArray(res.body.referrals)).toBe(true);
  });

  test('GET /reports - should format dates correctly', async () => {
    const res = await adminAgent.get('/reports?from=2026-03-15&to=2026-03-20');
    expect(res.status).toBe(200);
    expect(res.body.fmt).toBe('15.03.2026');
  });

  test('GET /reports - should only allow admin access', async () => {
    const patientAgent = request.agent(app);
    await patientAgent.post('/login').send({ email: 'ivanov.p@mail.ru', password: '123456' });
    
    const res = await patientAgent.get('/reports?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(302);
  });
});
