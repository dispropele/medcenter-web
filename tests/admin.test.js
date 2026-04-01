const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;
let adminAgent;

describe('Admin Tests', () => {
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

    // Specializations
    app.get('/admin/specializations', auth, adminOnly, (req, res) => {
      res.json({
        specs: db.prepare('SELECT * FROM specializations ORDER BY name').all(),
        error: null,
        success: null
      });
    });

    app.post('/admin/specializations', auth, adminOnly, (req, res) => {
      const { name = '' } = req.body;
      const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();

      if (name.trim().length < 3)
        return res.status(400).json({ error: 'Не менее 3 символов', specs });

      try {
        db.prepare('INSERT INTO specializations(name) VALUES(?)').run(name.trim());
        res.json({ success: `«${name.trim()}» добавлена`, specs: db.prepare('SELECT * FROM specializations ORDER BY name').all() });
      } catch {
        res.status(400).json({ error: 'Уже существует', specs });
      }
    });

    app.post('/admin/specializations/:id/delete', auth, adminOnly, (req, res) => {
      db.prepare('DELETE FROM specializations WHERE id=?').run(req.params.id);
      res.json({ success: true });
    });

    // Services
    app.get('/admin/services', auth, adminOnly, (req, res) => {
      res.json({
        services: db.prepare('SELECT * FROM services ORDER BY name').all(),
        error: null,
        success: null
      });
    });

    app.post('/admin/services', auth, adminOnly, (req, res) => {
      const { name = '', description = '', price = 0 } = req.body;
      const services = db.prepare('SELECT * FROM services ORDER BY name').all();

      if (name.trim().length < 3)
        return res.status(400).json({ error: 'Название не короче 3 символов', services });

      try {
        db.prepare('INSERT INTO services(name,description,price) VALUES(?,?,?)')
          .run(name.trim(), description, parseFloat(price) || 0);
        res.json({ success: `«${name.trim()}» добавлена`, services: db.prepare('SELECT * FROM services ORDER BY name').all() });
      } catch {
        res.status(400).json({ error: 'Услуга с таким названием уже существует', services });
      }
    });

    app.post('/admin/services/:id/delete', auth, adminOnly, (req, res) => {
      db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
      res.json({ success: true });
    });

    // Users
    app.get('/admin/users', auth, adminOnly, (req, res) => {
      res.json({
        users: db.prepare('SELECT * FROM users ORDER BY role,name').all()
      });
    });

    // Analyses
    app.get('/admin/analyses', auth, adminOnly, (req, res) => {
      res.json({
        analyses: db.prepare('SELECT * FROM services WHERE name LIKE "%анализ%"').all(),
        error: null,
        success: null
      });
    });

    app.post('/admin/analyses', auth, adminOnly, (req, res) => {
      const { name = '', price = 0 } = req.body;

      if (name.trim().length < 3)
        return res.status(400).json({ error: 'Не менее 3 символов' });

      try {
        db.prepare('INSERT INTO services(name,price) VALUES(?,?)').run(name.trim(), parseFloat(price) || 0);
        res.json({ success: `«${name.trim()}» добавлена` });
      } catch {
        res.status(400).json({ error: 'Уже существует' });
      }
    });
  });

  beforeEach(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/login').send({ email: 'admin@medcenter.ru', password: 'admin123' });
  });

  describe('Specializations', () => {
    test('GET /admin/specializations - should return all specializations', async () => {
      const res = await adminAgent.get('/admin/specializations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.specs)).toBe(true);
      expect(res.body.specs.length).toBeGreaterThan(0);
    });

    test('POST /admin/specializations - should fail with short name', async () => {
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: 'ab' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Не менее 3 символов');
    });

    test('POST /admin/specializations - should add new specialization', async () => {
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: 'Новая Специализация' });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain('Новая Специализация');

      const spec = db.prepare('SELECT * FROM specializations WHERE name=?').get('Новая Специализация');
      expect(spec).toBeDefined();
    });

    test('POST /admin/specializations/:id/delete - should delete specialization', async () => {
      // Create first
      const result = db.prepare('INSERT INTO specializations(name) VALUES(?)').run('Temp Spec');
      const id = result.lastInsertRowid;

      // Then delete
      const res = await adminAgent.post(`/admin/specializations/${id}/delete`);
      expect(res.status).toBe(200);

      const spec = db.prepare('SELECT * FROM specializations WHERE id=?').get(id);
      expect(spec).toBeUndefined();
    });
  });

  describe('Services', () => {
    test('GET /admin/services - should return all services', async () => {
      const res = await adminAgent.get('/admin/services');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.services)).toBe(true);
      expect(res.body.services.length).toBeGreaterThan(0);
    });

    test('POST /admin/services - should fail with short name', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'ab', price: 100 });
      expect(res.status).toBe(400);
    });

    test('POST /admin/services - should add new service', async () => {
      const res = await adminAgent.post('/admin/services')
        .send({ name: 'Новая услуга', description: 'Описание', price: 1500 });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain('Новая услуга');

      const service = db.prepare('SELECT * FROM services WHERE name=?').get('Новая услуга');
      expect(service).toBeDefined();
      expect(service.price).toBe(1500);
    });

    test('POST /admin/services/:id/delete - should delete service', async () => {
      const result = db.prepare('INSERT INTO services(name,price) VALUES(?,?)').run('Temp Service', 500);
      const id = result.lastInsertRowid;

      const res = await adminAgent.post(`/admin/services/${id}/delete`);
      expect(res.status).toBe(200);

      const service = db.prepare('SELECT * FROM services WHERE id=?').get(id);
      expect(service).toBeUndefined();
    });
  });

  describe('Users', () => {
    test('GET /admin/users - should return all users', async () => {
      const res = await adminAgent.get('/admin/users');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThan(0);
    });

    test('Users should have correct roles', async () => {
      const res = await adminAgent.get('/admin/users');
      const roles = res.body.users.map(u => u.role);
      expect(roles).toContain('admin');
      expect(roles).toContain('patient');
    });
  });

  describe('Analyses', () => {
    test('GET /admin/analyses - should return analyses', async () => {
      const res = await adminAgent.get('/admin/analyses');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.analyses)).toBe(true);
    });

    test('POST /admin/analyses - should add new analysis', async () => {
      const res = await adminAgent.post('/admin/analyses')
        .send({ name: 'Новый анализ крови', price: 800 });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain('Новый анализ крови');
    });
  });
});
