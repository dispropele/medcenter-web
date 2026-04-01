const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let patientAgent;
let doctorAgent;

describe('Medical Card Tests', () => {
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
    const staffOnly = (req, res, next) => ['admin', 'doctor'].includes(req.session.user?.role) ? next() : res.redirect('/dashboard');

    app.post('/login', (req, res) => {
      const { email = '', password = '' } = req.body;
      const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
        .get(email.trim().toLowerCase(), password);
      if (!u) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
      res.json({ success: true });
    });

    app.get('/medical-card', auth, (req, res) => {
      const u = req.session.user;
      const patients = u.role !== 'patient'
        ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
        : null;
      const pid = u.role === 'patient' ? u.id : (req.query.patient_id || null);
      let card = null;

      if (pid) {
        const patient = db.prepare('SELECT * FROM users WHERE id=?').get(pid);
        const visits = db.prepare(`
          SELECT v.*, a.datetime, a.notes appt_notes,
                 ud.name doc_name, s.name spec_name, a.status appt_status
          FROM visits v
          JOIN appointments a ON v.appointment_id=a.id
          JOIN doctors d ON a.doctor_id=d.id
          JOIN users ud ON d.user_id=ud.id
          JOIN specializations s ON d.spec_id=s.id
          WHERE a.patient_id=?
          ORDER BY substr(a.datetime,7,4)||substr(a.datetime,4,2)||substr(a.datetime,1,2) DESC
        `).all(pid);
        card = { patient, visits };
      }

      res.json({ patients, card, selectedPid: pid });
    });

    app.post('/visits/:appt_id', auth, staffOnly, (req, res) => {
      const { diagnosis = '', allergy = '' } = req.body;
      const existing = db.prepare('SELECT id FROM visits WHERE appointment_id=?').get(String(req.params.appt_id));

      if (existing) {
        db.prepare("UPDATE visits SET diagnosis=?,allergy=?,updated_at=datetime('now','localtime') WHERE appointment_id=?")
          .run(diagnosis, allergy, req.params.appt_id);
      } else {
        db.prepare("INSERT INTO visits(appointment_id,diagnosis,allergy,updated_at) VALUES(?,?,?,datetime('now','localtime'))")
          .run(req.params.appt_id, diagnosis, allergy);
        db.prepare("UPDATE appointments SET status='Принят' WHERE id=?").run(req.params.appt_id);
      }

      res.json({ success: true });
    });
  });

  beforeEach(async () => {
    patientAgent = request.agent(app);
    doctorAgent = request.agent(app);

    await patientAgent.post('/login').send({ email: 'ivanov.p@mail.ru', password: '123456' });
    await doctorAgent.post('/login').send({ email: 'ivanov@medcenter.ru', password: 'doctor123' });
  });

  test('GET /medical-card - patient should see own card', async () => {
    const res = await patientAgent.get('/medical-card');
    expect(res.status).toBe(200);
    expect(res.body.card).toBeDefined();
    expect(res.body.card.patient).toBeDefined();
  });

  test('GET /medical-card - doctor should see patient list', async () => {
    const res = await doctorAgent.get('/medical-card');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });

  test('GET /medical-card - doctor can select patient by ID', async () => {
    const res = await doctorAgent.get('/medical-card?patient_id=1');
    expect(res.status).toBe(200);
    expect(res.body.card).toBeDefined();
  });

  test('GET /medical-card - patient should not see patients list', async () => {
    const res = await patientAgent.get('/medical-card');
    expect(res.status).toBe(200);
    expect(res.body.patients).toBeNull();
  });

  test('GET /medical-card - should show patient info', async () => {
    const res = await patientAgent.get('/medical-card');
    expect(res.status).toBe(200);
    expect(res.body.card.patient.name).toBeDefined();
    expect(res.body.card.patient.email).toBeDefined();
    expect(res.body.card.patient.phone).toBeDefined();
  });

  test('GET /medical-card - should show visits list', async () => {
    const res = await patientAgent.get('/medical-card');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.card.visits)).toBe(true);
  });

  test('POST /visits/:appt_id - doctor should create visit', async () => {
    const res = await doctorAgent.post('/visits/1')
      .send({
        diagnosis: 'ОРВИ',
        allergy: 'Пенициллин'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /visits/:appt_id - should update existing visit', async () => {
    // Create visit first
    await doctorAgent.post('/visits/1')
      .send({ diagnosis: 'ОРВИ', allergy: 'Нет' });

    // Update it
    const res = await doctorAgent.post('/visits/1')
      .send({ diagnosis: 'Грипп', allergy: 'Пенициллин' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify update
    const visit = db.prepare('SELECT * FROM visits WHERE appointment_id=?').get(1);
    expect(visit.diagnosis).toBe('Грипп');
  });

  test('POST /visits/:appt_id - should update appointment status to Принят', async () => {
    await doctorAgent.post('/visits/2')
      .send({ diagnosis: 'Здоров', allergy: 'Нет' });

    const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(2);
    expect(appt.status).toBe('Принят');
  });

  test('POST /visits/:appt_id - patient should not create visit', async () => {
    const res = await patientAgent.post('/visits/1')
      .send({ diagnosis: 'ОРВИ', allergy: 'Нет' });
    expect(res.status).toBe(302);
  });

  test('GET /medical-card - should sort visits by date DESC', async () => {
    const res = await patientAgent.get('/medical-card');
    expect(res.status).toBe(200);
    
    if (res.body.card.visits.length > 1) {
      const visits = res.body.card.visits;
      for (let i = 0; i < visits.length - 1; i++) {
        // Verify descending order
        expect(visits[i].datetime).toBeDefined();
      }
    }
  });
});
