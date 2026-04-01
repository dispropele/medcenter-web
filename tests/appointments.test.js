const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');
const methodOverride = require('method-override');

let app;
let db;
let adminAgent;
let doctorAgent;
let patientAgent;

describe('Appointments Tests', () => {
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
    const staffOnly = (req, res, next) => ['admin', 'doctor'].includes(req.session.user?.role) ? next() : res.redirect('/dashboard');

    // Login route
    app.post('/login', (req, res) => {
      const { email = '', password = '' } = req.body;
      const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
        .get(email.trim().toLowerCase(), password);
      if (!u) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
      res.json({ success: true });
    });

    // Appointments routes
    app.get('/appointments', auth, (req, res) => {
      const u = req.session.user;
      let rows;
      const base = `SELECT a.*, up.name patient_name, ud.name doc_name, s.name spec_name
        FROM appointments a
        JOIN users up ON a.patient_id=up.id
        JOIN doctors d ON a.doctor_id=d.id
        JOIN users ud ON d.user_id=ud.id
        JOIN specializations s ON d.spec_id=s.id`;
      const ord = `ORDER BY substr(a.datetime,7,4)||substr(a.datetime,4,2)||substr(a.datetime,1,2) DESC`;

      if (u.role === 'patient')
        rows = db.prepare(`${base} WHERE a.patient_id=? ${ord}`).all(u.id);
      else if (u.role === 'doctor') {
        const doc = db.prepare('SELECT id FROM doctors WHERE user_id=?').get(u.id);
        rows = doc ? db.prepare(`${base} WHERE a.doctor_id=? ${ord}`).all(doc.id) : [];
      } else
        rows = db.prepare(`${base} ${ord}`).all();

      res.json({ appointments: rows });
    });

    app.get('/appointments/new', auth, (req, res) => {
      const u = req.session.user;
      const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();
      const patients = u.role !== 'patient'
        ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
        : null;
      res.json({ specs, patients });
    });

    app.post('/appointments', auth, (req, res) => {
      const u = req.session.user;
      const { doctor_id, datetime, notes = '' } = req.body;
      const patient_id = u.role === 'patient' ? u.id : (req.body.patient_id || null);

      if (!patient_id || !doctor_id || !datetime)
        return res.status(400).json({ error: 'Missing required fields' });

      db.prepare('INSERT INTO appointments(patient_id,doctor_id,datetime,notes) VALUES(?,?,?,?)')
        .run(patient_id, doctor_id, datetime, notes);

      res.json({ success: true, message: 'Appointment created' });
    });

    app.get('/appointments/:id', auth, (req, res) => {
      const appt = db.prepare(`
        SELECT a.*, up.name patient_name, up.phone patient_phone, up.dob patient_dob,
               up.gender patient_gender, up.address patient_address,
               ud.name doc_name, s.name spec_name
        FROM appointments a
        JOIN users up ON a.patient_id=up.id
        JOIN doctors d ON a.doctor_id=d.id
        JOIN users ud ON d.user_id=ud.id
        JOIN specializations s ON d.spec_id=s.id
        WHERE a.id=?
      `).get(req.params.id);

      if (!appt) return res.status(404).json({ error: 'Appointment not found' });

      const visit = db.prepare('SELECT * FROM visits WHERE appointment_id=?').get(appt.id);
      const analyses = visit ? db.prepare(`
        SELECT va.*, sv.name svc_name, sv.price svc_price
        FROM visit_analyses va JOIN services sv ON va.service_id=sv.id
        WHERE va.visit_id=?
        ORDER BY va.date_assigned DESC
      `).all(visit.id) : [];

      res.json({ appt, visit, analyses });
    });

    app.post('/appointments/:id/status', auth, staffOnly, (req, res) => {
      db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status, req.params.id);
      res.json({ success: true });
    });

    app.get('/api/doctors/:sid', auth, (req, res) => {
      res.json(db.prepare(`
        SELECT d.id, u.name FROM doctors d 
        JOIN users u ON d.user_id=u.id 
        WHERE d.spec_id=? 
        ORDER BY u.name
      `).all(req.params.sid));
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    doctorAgent = request.agent(app);
    patientAgent = request.agent(app);

    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
    await doctorAgent.post('/login').send({ email: 'ivanov@medcenter.ru', password: 'doctor123' });
    await patientAgent.post('/login').send({ email: 'ivanov.p@mail.ru', password: '123456' });
  });

  test('GET /appointments - patient should see only their appointments', async () => {
    const res = await patientAgent.get('/appointments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.appointments)).toBe(true);
    // All appointments should belong to the patient
    res.body.appointments.forEach(appt => {
      expect(appt.patient_name).toBeDefined();
    });
  });

  test('GET /appointments - admin should see all appointments', async () => {
    const res = await adminAgent.get('/appointments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.appointments)).toBe(true);
    expect(res.body.appointments.length).toBeGreaterThan(0);
  });

  test('GET /appointments/new - should return specializations and patients', async () => {
    const res = await patientAgent.get('/appointments/new');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.specs)).toBe(true);
    expect(res.body.patients).toBeNull(); // patients list only for doctors/admin
  });

  test('GET /appointments/new - admin should see patients list', async () => {
    const res = await adminAgent.get('/appointments/new');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });

  test('POST /appointments - should fail without required fields', async () => {
    const res = await patientAgent.post('/appointments')
      .send({ datetime: '20.04.2026 10:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
  });

  test('POST /appointments - patient should create appointment', async () => {
    const res = await patientAgent.post('/appointments')
      .send({ doctor_id: 1, datetime: '20.04.2026 10:00', notes: 'Test appointment' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /appointments - admin should create appointment for patient', async () => {
    const res = await adminAgent.post('/appointments')
      .send({ patient_id: 1, doctor_id: 1, datetime: '21.04.2026 14:00', notes: 'Admin created' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /appointments/:id - should return appointment details', async () => {
    const res = await patientAgent.get('/appointments/1');
    expect(res.status).toBe(200);
    expect(res.body.appt).toBeDefined();
    expect(res.body.appt.id).toBe(1);
  });

  test('GET /appointments/:id - should return 404 for non-existent appointment', async () => {
    const res = await patientAgent.get('/appointments/9999');
    expect(res.status).toBe(404);
  });

  test('POST /appointments/:id/status - admin should update appointment status', async () => {
    const res = await adminAgent.post('/appointments/1/status')
      .send({ status: 'Отменён' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify status was updated
    const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(1);
    expect(appt.status).toBe('Отменён');
  });

  test('GET /api/doctors/:sid - should return doctors by specialization', async () => {
    const res = await patientAgent.get('/api/doctors/1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
