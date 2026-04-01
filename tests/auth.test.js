const request = require('supertest');
const express = require('express');
const session = require('express-session');
const path = require('path');

let app;
let db;

describe('Authentication Tests', () => {
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

    // Auth routes
    app.get('/login', (req, res) => {
      if (req.session.user) return res.redirect('/dashboard');
      res.render('login', { error: null });
    });

    app.post('/login', (req, res) => {
      const { email = '', password = '' } = req.body;
      const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
        .get(email.trim().toLowerCase(), password);
      if (!u) return res.render('login', { error: 'Неверный email или пароль' });
      req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
      res.redirect('/dashboard');
    });

    app.get('/register', (req, res) => res.render('register', { error: null }));

    app.post('/register', (req, res) => {
      const { name = '', email = '', password = '', confirm = '', phone = '', dob = '', gender = '', address = '' } = req.body;
      if (name.trim().length < 3)
        return res.render('register', { error: 'ФИО не короче 3 символов' });
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(email))
        return res.render('register', { error: 'Некорректный email' });
      if (password.length < 6)
        return res.render('register', { error: 'Пароль не короче 6 символов' });
      if (password !== confirm)
        return res.render('register', { error: 'Пароли не совпадают' });
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
        return res.render('register', { error: 'Email уже занят' });

      db.prepare('INSERT INTO users(name,email,password,role,phone,dob,gender,address) VALUES(?,?,?,?,?,?,?,?)')
        .run(name.trim(), email.toLowerCase(), password, 'patient', phone, dob, gender, address);
      res.redirect('/login');
    });

    app.get('/logout', (req, res) => {
      req.session.destroy();
      res.redirect('/login');
    });

    app.get('/dashboard', auth, (req, res) => {
      res.json({ message: 'Dashboard', user: req.session.user });
    });
  });

  test('GET /login - should render login page', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
  });

  test('POST /login - should fail with wrong credentials', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'wrong@email.com', password: 'wrong' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Неверный email или пароль');
  });

  test('POST /login - should login admin user', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'admin@medcenter.ru', password: 'admin123' })
      .expect(302);
    expect(res.headers.location).toBe('/dashboard');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('POST /login - should login patient user', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'ivanov.p@mail.ru', password: '123456' })
      .expect(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  test('GET /register - should render register page', async () => {
    const res = await request(app).get('/register');
    expect(res.status).toBe(200);
  });

  test('POST /register - should fail with short name', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'ab', email: 'new@mail.ru', password: '123456', confirm: '123456' });
    expect(res.text).toContain('ФИО не короче 3 символов');
  });

  test('POST /register - should fail with invalid email', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'Test User', email: 'invalid', password: '123456', confirm: '123456' });
    expect(res.text).toContain('Некорректный email');
  });

  test('POST /register - should fail with short password', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'Test User', email: 'test@mail.ru', password: '123', confirm: '123' });
    expect(res.text).toContain('Пароль не короче 6 символов');
  });

  test('POST /register - should fail if passwords do not match', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'Test User', email: 'test@mail.ru', password: '123456', confirm: '654321' });
    expect(res.text).toContain('Пароли не совпадают');
  });

  test('POST /register - should successfully register new user', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        name: 'New Patient',
        email: 'newuser@mail.ru',
        password: '123456',
        confirm: '123456',
        phone:'+7 (999) 123-45-67',
        dob: '01.01.1990',
        gender: 'М',
        address: 'ул. Новая, 10'
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    
    // Verify user was created
    const user = db.prepare('SELECT * FROM users WHERE email=?').get('newuser@mail.ru');
    expect(user).toBeDefined();
    expect(user.role).toBe('patient');
  });

  test('GET /dashboard - should require authentication', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /logout - should destroy session', async () => {
    const agent = request.agent(app);
    
    // Login first
    await agent.post('/login')
      .send({ email: 'admin@medcenter.ru', password: 'admin123' });

    // Then logout
    const res = await agent.get('/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
