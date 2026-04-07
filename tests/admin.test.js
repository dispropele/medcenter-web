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

      if (!name || name.trim().length < 3)
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

      if (!name || name.trim().length < 3)
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

    app.post('/admin/users', auth, adminOnly, (req, res) => {
      const { name = '', email = '', password = '', confirm = '', role = 'patient', phone = '', dob = '', gender = '', address = '' } = req.body;
      const users = db.prepare('SELECT * FROM users ORDER BY role,name').all();

      if (!name.trim()) return res.status(400).json({ error: 'Введите ФИО' });
      if (name.trim().length < 3) return res.status(400).json({ error: 'ФИО не короче 3 символов' });
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
      if (password.length < 6) return res.status(400).json({ error: 'Пароль не короче 6 символов' });
      if (password !== confirm) return res.status(400).json({ error: 'Пароли не совпадают' });

      if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
        return res.status(400).json({ error: 'Email уже занят' });

      try {
        db.prepare('INSERT INTO users(name,email,password,role,phone,dob,gender,address) VALUES(?,?,?,?,?,?,?,?)')
          .run(name.trim(), email.toLowerCase(), password, role, phone, dob, gender, address);
        res.json({ success: `Пользователь «${name.trim()}» добавлен` });
      } catch (e) {
        res.status(400).json({ error: 'Ошибка при добавлении пользователя' });
      }
    });

    app.put('/admin/users/:id', auth, adminOnly, (req, res) => {
      const { name = '', email = '', password = '', confirm = '', role = 'patient', phone = '', dob = '', gender = '', address = '' } = req.body;
      const existing = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Пользователь не найден' });

      if (!name.trim()) return res.status(400).json({ error: 'Введите ФИО' });
      if (name.trim().length < 3) return res.status(400).json({ error: 'ФИО не короче 3 символов' });
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });

      let finalPassword = existing.password;
      if (password) {
        if (password.length < 6) return res.status(400).json({ error: 'Пароль не короче 6 символов' });
        if (password !== confirm) return res.status(400).json({ error: 'Пароли не совпадают' });
        finalPassword = password;
      }

      if (email.toLowerCase() !== existing.email.toLowerCase()) {
        if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
          return res.status(400).json({ error: 'Email уже занят' });
      }

      try {
        db.prepare('UPDATE users SET name=?, email=?, password=?, role=?, phone=?, dob=?, gender=?, address=? WHERE id=?')
          .run(name.trim(), email.toLowerCase(), finalPassword, role, phone, dob, gender, address, req.params.id);
        res.json({ success: `Пользователь «${name.trim()}» обновлен` });
      } catch (e) {
        res.status(400).json({ error: 'Ошибка при обновлении пользователя' });
      }
    });

    app.delete('/admin/users/:id', auth, adminOnly, (req, res) => {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      if (req.session.user.id === parseInt(req.params.id))
        return res.status(400).json({ error: 'Вы не можете удалить свой аккаунт' });

      try {
        db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
        res.json({ success: `Пользователь «${user.name}» удален` });
      } catch (e) {
        res.status(400).json({ error: 'Ошибка при удалении пользователя' });
      }
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

      if (!name || name.trim().length < 3)
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
      const uniqueName = 'Specialist_' + Date.now();
      const res = await adminAgent.post('/admin/specializations')
        .send({ name: uniqueName });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain(uniqueName);

      const spec = db.prepare('SELECT * FROM specializations WHERE name=?').get(uniqueName);
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
      const uniqueName = 'TestService_' + Date.now();
      const res = await adminAgent.post('/admin/services')
        .send({ name: uniqueName, description: 'Description', price: 1500 });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain(uniqueName);

      const service = db.prepare('SELECT * FROM services WHERE name=?').get(uniqueName);
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

    test('POST /admin/users - should fail with short name', async () => {
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'ab', email: 'test@test.com', password: 'pass123', confirm: 'pass123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ФИО');
    });

    test('POST /admin/users - should fail with invalid email', async () => {
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'Test User', email: 'invalid-email', password: 'pass123', confirm: 'pass123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Некорректный email');
    });

    test('POST /admin/users - should fail with short password', async () => {
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'Test User', email: 'test@test.com', password: 'pass', confirm: 'pass' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Пароль');
    });

    test('POST /admin/users - should fail with mismatched passwords', async () => {
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'Test User', email: 'test@test.com', password: 'pass123', confirm: 'pass456' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Пароли не совпадают');
    });

    test('POST /admin/users - should add new user successfully', async () => {
      const uniqueEmail = 'newuser_' + Date.now() + '@test.com';
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'New Test User', email: uniqueEmail, password: 'testpass123', confirm: 'testpass123', role: 'patient' });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain('добавлен');

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(uniqueEmail.toLowerCase());
      expect(user).toBeDefined();
      expect(user.name).toBe('New Test User');
      expect(user.role).toBe('patient');
    });

    test('POST /admin/users - should fail with duplicate email', async () => {
      const uniqueEmail = 'dupuser_' + Date.now() + '@test.com';
      // First user
      await adminAgent.post('/admin/users')
        .send({ name: 'User One', email: uniqueEmail, password: 'testpass123', confirm: 'testpass123' });

      // Second user with same email
      const res = await adminAgent.post('/admin/users')
        .send({ name: 'User Two', email: uniqueEmail, password: 'testpass123', confirm: 'testpass123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email уже занят');
    });

    test('PUT /admin/users/:id - should update user successfully', async () => {
      const uniqueEmail = 'updateuser_' + Date.now() + '@test.com';
      const createRes = await adminAgent.post('/admin/users')
        .send({ name: 'Original Name', email: uniqueEmail, password: 'testpass123', confirm: 'testpass123', phone: '+7 (999) 000-00-00' });

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(uniqueEmail.toLowerCase());
      const updateRes = await adminAgent.put(`/admin/users/${user.id}`)
        .send({ name: 'Updated Name', email: uniqueEmail, role: 'doctor', phone: '+7 (999) 111-11-11' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toContain('обновлен');

      const updated = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      expect(updated.name).toBe('Updated Name');
      expect(updated.phone).toBe('+7 (999) 111-11-11');
      expect(updated.role).toBe('doctor');
    });

    test('PUT /admin/users/:id - should update password if provided', async () => {
      const uniqueEmail = 'passuser_' + Date.now() + '@test.com';
      const createRes = await adminAgent.post('/admin/users')
        .send({ name: 'Pass Test', email: uniqueEmail, password: 'oldpass123', confirm: 'oldpass123' });

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(uniqueEmail.toLowerCase());
      const updateRes = await adminAgent.put(`/admin/users/${user.id}`)
        .send({ name: 'Pass Test', email: uniqueEmail, password: 'newpass123', confirm: 'newpass123' });

      expect(updateRes.status).toBe(200);

      const updated = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      expect(updated.password).toBe('newpass123');
    });

    test('PUT /admin/users/:id - should keep password if not provided', async () => {
      const uniqueEmail = 'nopasschange_' + Date.now() + '@test.com';
      const createRes = await adminAgent.post('/admin/users')
        .send({ name: 'Keep Pass', email: uniqueEmail, password: 'originalpass123', confirm: 'originalpass123' });

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(uniqueEmail.toLowerCase());
      const updateRes = await adminAgent.put(`/admin/users/${user.id}`)
        .send({ name: 'Keep Pass Updated', email: uniqueEmail, password: '', confirm: '' });

      expect(updateRes.status).toBe(200);

      const updated = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      expect(updated.password).toBe('originalpass123');
    });

    test('DELETE /admin/users/:id - should delete user successfully', async () => {
      const uniqueEmail = 'deluser_' + Date.now() + '@test.com';
      const createRes = await adminAgent.post('/admin/users')
        .send({ name: 'To Delete', email: uniqueEmail, password: 'testpass123', confirm: 'testpass123' });

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(uniqueEmail.toLowerCase());
      const deleteRes = await adminAgent.delete(`/admin/users/${user.id}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toContain('удален');

      const deleted = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      expect(deleted).toBeUndefined();
    });

    test('DELETE /admin/users/:id - should fail to delete own account', async () => {
      const adminUser = db.prepare("SELECT * FROM users WHERE email='admin@medcenter.ru'").get();
      const deleteRes = await adminAgent.delete(`/admin/users/${adminUser.id}`);

      expect(deleteRes.status).toBe(400);
      expect(deleteRes.body.error).toContain('Вы не можете удалить свой аккаунт');

      const still = db.prepare('SELECT * FROM users WHERE id=?').get(adminUser.id);
      expect(still).toBeDefined();
    });

    test('DELETE /admin/users/:id - should fail if user not found', async () => {
      const deleteRes = await adminAgent.delete('/admin/users/99999');
      expect(deleteRes.status).toBe(404);
      expect(deleteRes.body.error).toContain('Пользователь не найден');
    });
  });

  describe('Analyses', () => {
    test('GET /admin/analyses - should return analyses', async () => {
      const res = await adminAgent.get('/admin/analyses');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.analyses)).toBe(true);
    });

    test('POST /admin/analyses - should add new analysis', async () => {
      const uniqueName = 'BloodTest_' + Date.now();
      const res = await adminAgent.post('/admin/analyses')
        .send({ name: uniqueName, price: 800 });
      expect(res.status).toBe(200);
      expect(res.body.success).toContain(uniqueName);
    });
  });
});
