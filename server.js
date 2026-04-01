const express        = require('express');
const session        = require('express-session');
const methodOverride = require('method-override');
const path           = require('path');

let db;
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'mc_2026', resave: false, saveUninitialized: false,
                  cookie: { maxAge: 86400000 } }));
app.use((req, res, next) => { res.locals.user = req.session.user || null; next(); });

// Helpers
const auth       = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const adminOnly  = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.redirect('/dashboard');
const staffOnly  = (req, res, next) => ['admin','doctor'].includes(req.session.user?.role) ? next() : res.redirect('/dashboard');
const safe       = (v) => (v === undefined || v === null) ? null : v;

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
app.get('/', (req,res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

app.get('/login', (req,res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null });
});
app.post('/login', (req,res) => {
  const { email='', password='' } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=? AND password=?')
               .get(email.trim().toLowerCase(), password);
  if (!u) return res.render('login', { error: 'Неверный email или пароль' });
  req.session.user = { id:u.id, name:u.name, email:u.email, role:u.role };
  res.redirect('/dashboard');
});

app.get('/register', (req,res) => res.render('register', { error:null }));
app.post('/register', (req,res) => {
  const { name='', email='', password='', confirm='', phone='', dob='', gender='', address='' } = req.body;
  if (name.trim().length < 3)          return res.render('register', { error:'ФИО не короче 3 символов' });
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.render('register', { error:'Некорректный email' });
  if (password.length < 6)            return res.render('register', { error:'Пароль не короче 6 символов' });
  if (password !== confirm)           return res.render('register', { error:'Пароли не совпадают' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
                                      return res.render('register', { error:'Email уже занят' });
  db.prepare('INSERT INTO users(name,email,password,role,phone,dob,gender,address) VALUES(?,?,?,?,?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), password, 'patient', phone, dob, gender, address);
  res.redirect('/login');
});

app.get('/logout', (req,res) => { req.session.destroy(); res.redirect('/login'); });

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
app.get('/dashboard', auth, (req,res) => {
  const u = req.session.user;
  let appointments = [], stats = {};

  if (u.role === 'admin') {
    stats.patients     = db.prepare("SELECT COUNT(*) c FROM users WHERE role='patient'").get().c;
    stats.appointments = db.prepare('SELECT COUNT(*) c FROM appointments').get().c;
    stats.contracts    = db.prepare('SELECT COUNT(*) c FROM contracts').get().c;
    stats.revenue      = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM checks").get().s;
    appointments = db.prepare(`
      SELECT a.*, up.name patient_name, ud.name doc_name, s.name spec_name
      FROM appointments a
      JOIN users up ON a.patient_id=up.id
      JOIN doctors d ON a.doctor_id=d.id
      JOIN users ud ON d.user_id=ud.id
      JOIN specializations s ON d.spec_id=s.id
      ORDER BY substr(a.datetime,7,4)||substr(a.datetime,4,2)||substr(a.datetime,1,2) DESC LIMIT 8
    `).all();
  } else if (u.role === 'doctor') {
    const doc = db.prepare('SELECT id FROM doctors WHERE user_id=?').get(u.id);
    if (doc) appointments = db.prepare(`
      SELECT a.*, up.name patient_name, s.name spec_name
      FROM appointments a
      JOIN users up ON a.patient_id=up.id
      JOIN doctors d ON a.doctor_id=d.id
      JOIN specializations s ON d.spec_id=s.id
      WHERE a.doctor_id=?
      ORDER BY substr(a.datetime,7,4)||substr(a.datetime,4,2)||substr(a.datetime,1,2) DESC LIMIT 8
    `).all(doc.id);
  } else {
    appointments = db.prepare(`
      SELECT a.*, ud.name doc_name, s.name spec_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id=d.id
      JOIN users ud ON d.user_id=ud.id
      JOIN specializations s ON d.spec_id=s.id
      WHERE a.patient_id=?
      ORDER BY substr(a.datetime,7,4)||substr(a.datetime,4,2)||substr(a.datetime,1,2) DESC LIMIT 5
    `).all(u.id);
  }
  res.render('dashboard', { appointments, stats });
});

// ══════════════════════════════════════════════════════════════
// APPOINTMENTS
// ══════════════════════════════════════════════════════════════
app.get('/appointments', auth, (req,res) => {
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
  res.render('appointments/index', { appointments: rows });
});

app.get('/appointments/new', auth, (req,res) => {
  const u = req.session.user;
  const specs    = db.prepare('SELECT * FROM specializations ORDER BY name').all();
  const patients = u.role !== 'patient'
    ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
    : null;
  res.render('appointments/new', { specs, patients, error:null, form:{} });
});

app.post('/appointments', auth, (req,res) => {
  const u = req.session.user;
  const { doctor_id, datetime, notes='' } = req.body;
  const patient_id = u.role === 'patient' ? u.id : safe(req.body.patient_id);
  const specs    = db.prepare('SELECT * FROM specializations ORDER BY name').all();
  const patients = u.role !== 'patient'
    ? db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all()
    : null;
  if (!patient_id || !doctor_id || !datetime)
    return res.render('appointments/new', { specs, patients, error:'Заполните все обязательные поля', form:req.body });
  db.prepare('INSERT INTO appointments(patient_id,doctor_id,datetime,notes) VALUES(?,?,?,?)')
    .run(patient_id, doctor_id, datetime, notes);
  res.redirect('/appointments');
});

app.get('/appointments/:id', auth, (req,res) => {
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
  if (!appt) return res.redirect('/appointments');
  const visit = db.prepare('SELECT * FROM visits WHERE appointment_id=?').get(appt.id);
  const analyses = visit ? db.prepare(`
    SELECT va.*, sv.name svc_name, sv.price svc_price
    FROM visit_analyses va JOIN services sv ON va.service_id=sv.id
    WHERE va.visit_id=?
    ORDER BY va.date_assigned DESC
  `).all(visit.id) : [];
  res.render('appointments/show', { appt, visit, analyses });
});

app.post('/appointments/:id/status', auth, staffOnly, (req,res) => {
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.redirect('/appointments/'+req.params.id);
});

// API: врачи по специализации
app.get('/api/doctors/:sid', auth, (req,res) => {
  res.json(db.prepare(`SELECT d.id, u.name FROM doctors d JOIN users u ON d.user_id=u.id WHERE d.spec_id=? ORDER BY u.name`).all(req.params.sid));
});

// ══════════════════════════════════════════════════════════════
// VISITS (посещения / медкарта)
// ══════════════════════════════════════════════════════════════
app.get('/medical-card', auth, (req,res) => {
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
  res.render('medical-card', { patients, card, selectedPid: pid });
});

// Сохранить посещение
app.post('/visits/:appt_id', auth, staffOnly, (req,res) => {
  const { diagnosis='', allergy='' } = req.body;
  const existing = db.prepare('SELECT id FROM visits WHERE appointment_id=?').get(String(req.params.appt_id));
  if (existing) {
    db.prepare("UPDATE visits SET diagnosis=?,allergy=?,updated_at=datetime('now','localtime') WHERE appointment_id=?")
      .run(diagnosis, allergy, req.params.appt_id);
  } else {
    db.prepare("INSERT INTO visits(appointment_id,diagnosis,allergy,updated_at) VALUES(?,?,?,datetime('now','localtime'))")
      .run(req.params.appt_id, diagnosis, allergy);
    db.prepare("UPDATE appointments SET status='Принят' WHERE id=?").run(req.params.appt_id);
  }
  res.redirect('/appointments/'+req.params.appt_id);
});

// ══════════════════════════════════════════════════════════════
// VISIT ANALYSES (Анализы посещения)
// ══════════════════════════════════════════════════════════════
app.post('/visit-analyses', auth, staffOnly, (req,res) => {
  const { visit_id, service_id, date_assigned, result='' } = req.body;
  if (!visit_id || !service_id || !date_assigned)
    return res.redirect('back');
  db.prepare('INSERT INTO visit_analyses(visit_id,service_id,date_assigned,result) VALUES(?,?,?,?)')
    .run(visit_id, service_id, date_assigned, result);
  // Redirect back to the appointment
  const visit = db.prepare('SELECT appointment_id FROM visits WHERE id=?').get(visit_id);
  res.redirect('/appointments/' + (visit ? visit.appointment_id : ''));
});

app.post('/visit-analyses/:id/result', auth, staffOnly, (req,res) => {
  const { result='', appointment_id } = req.body;
  db.prepare('UPDATE visit_analyses SET result=? WHERE id=?').run(result, req.params.id);
  res.redirect('/appointments/'+appointment_id);
});

app.post('/visit-analyses/:id/delete', auth, staffOnly, (req,res) => {
  const { appointment_id } = req.body;
  db.prepare('DELETE FROM visit_analyses WHERE id=?').run(req.params.id);
  res.redirect('/appointments/'+appointment_id);
});

// ══════════════════════════════════════════════════════════════
// CONTRACTS
// ══════════════════════════════════════════════════════════════
app.get('/contracts', auth, adminOnly, (req,res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name patient_name,
      (SELECT COUNT(*) FROM receipts WHERE contract_id=c.id) receipt_count
    FROM contracts c JOIN users u ON c.patient_id=u.id
    ORDER BY substr(c.date,7,4)||substr(c.date,4,2)||substr(c.date,1,2) DESC
  `).all();
  res.render('contracts/index', { contracts: rows });
});

app.get('/contracts/new', auth, adminOnly, (req,res) => {
  const patients = db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all();
  res.render('contracts/new', { patients, error:null, form:{} });
});

app.post('/contracts', auth, adminOnly, (req,res) => {
  const { patient_id, date, total=0 } = req.body;
  const patients = db.prepare("SELECT id,name FROM users WHERE role='patient' ORDER BY name").all();
  if (!patient_id) return res.render('contracts/new', { patients, error:'Выберите пациента', form:req.body });
  if (!date)       return res.render('contracts/new', { patients, error:'Укажите дату', form:req.body });
  const cid = db.prepare('INSERT INTO contracts(patient_id,total,date) VALUES(?,?,?)').run(patient_id, parseFloat(total)||0, date).lastInsertRowid;
  res.redirect('/contracts/'+cid);
});

app.get('/contracts/:id', auth, adminOnly, (req,res) => {
  const contract = db.prepare(`SELECT c.*,u.name patient_name,u.phone,u.dob,u.address FROM contracts c JOIN users u ON c.patient_id=u.id WHERE c.id=?`).get(req.params.id);
  if (!contract) return res.redirect('/contracts');
  const receipts = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM checks WHERE receipt_id=r.id) paid
    FROM receipts r WHERE r.contract_id=? ORDER BY r.date DESC
  `).all(req.params.id);
  res.render('contracts/show', { contract, receipts });
});

// ══════════════════════════════════════════════════════════════
// RECEIPTS (Квитанции)
// ══════════════════════════════════════════════════════════════
app.get('/receipts', auth, adminOnly, (req,res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name patient_name, c.date contract_date,
           (SELECT COUNT(*) FROM checks WHERE receipt_id=r.id) paid
    FROM receipts r
    JOIN contracts c ON r.contract_id=c.id
    JOIN users u ON c.patient_id=u.id
    ORDER BY substr(r.date,7,4)||substr(r.date,4,2)||substr(r.date,1,2) DESC
  `).all();
  res.render('receipts/index', { receipts: rows });
});

app.get('/receipts/new', auth, adminOnly, (req,res) => {
  const contracts = db.prepare(`SELECT c.*,u.name patient_name FROM contracts c JOIN users u ON c.patient_id=u.id ORDER BY c.date DESC`).all();
  const services  = db.prepare('SELECT * FROM services ORDER BY name').all();
  res.render('receipts/new', { contracts, services, error:null, form:{} });
});

app.post('/receipts', auth, adminOnly, (req,res) => {
  const { contract_id, date } = req.body;
  const nameArr  = req.body.svc_name  ? (Array.isArray(req.body.svc_name)  ? req.body.svc_name  : [req.body.svc_name])  : [];
  const sidArr   = req.body.svc_id    ? (Array.isArray(req.body.svc_id)    ? req.body.svc_id    : [req.body.svc_id])    : [];
  const priceArr = req.body.price     ? (Array.isArray(req.body.price)     ? req.body.price     : [req.body.price])     : [];
  const qtyArr   = req.body.qty       ? (Array.isArray(req.body.qty)       ? req.body.qty       : [req.body.qty])       : [];

  const contracts = db.prepare(`SELECT c.*,u.name patient_name FROM contracts c JOIN users u ON c.patient_id=u.id ORDER BY c.date DESC`).all();
  const services  = db.prepare('SELECT * FROM services ORDER BY name').all();

  if (!contract_id) return res.render('receipts/new', { contracts, services, error:'Выберите договор', form:req.body });
  if (!date)        return res.render('receipts/new', { contracts, services, error:'Укажите дату', form:req.body });
  const validIdx = nameArr.map((n,i)=>i).filter(i => nameArr[i] && nameArr[i].trim());
  if (!validIdx.length) return res.render('receipts/new', { contracts, services, error:'Добавьте хотя бы одну услугу', form:req.body });

  const total = validIdx.reduce((s,i) => s + (parseFloat(priceArr[i])||0) * (parseInt(qtyArr[i])||1), 0);
  const rid = db.prepare('INSERT INTO receipts(contract_id,date,amount,status) VALUES(?,?,?,?)').run(contract_id,date,total,'Ожидает оплаты').lastInsertRowid;
  const ins = db.prepare('INSERT INTO receipt_services(receipt_id,service_id,qty,price) VALUES(?,?,?,?)');
  validIdx.forEach(i => ins.run(rid, sidArr[i]||null, parseInt(qtyArr[i])||1, parseFloat(priceArr[i])||0));
  // Обновляем общую сумму договора
  const contractTotal = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE contract_id=?').get(contract_id).s;
  db.prepare('UPDATE contracts SET total=? WHERE id=?').run(contractTotal, contract_id);
  res.redirect('/contracts/'+contract_id);
});

app.get('/receipts/:id', auth, adminOnly, (req,res) => {
  const receipt = db.prepare(`
    SELECT r.*, u.name patient_name, c.date contract_date
    FROM receipts r
    JOIN contracts c ON r.contract_id=c.id
    JOIN users u ON c.patient_id=u.id
    WHERE r.id=?
  `).get(req.params.id);
  if (!receipt) return res.redirect('/receipts');
  const services = db.prepare(`
    SELECT rs.*, sv.name svc_name FROM receipt_services rs JOIN services sv ON rs.service_id=sv.id WHERE rs.receipt_id=?
  `).all(req.params.id);
  const chks = db.prepare('SELECT * FROM checks WHERE receipt_id=? ORDER BY date DESC').all(req.params.id);
  res.render('receipts/show', { receipt, services, checks: chks });
});

app.post('/receipts/:id/status', auth, adminOnly, (req,res) => {
  db.prepare('UPDATE receipts SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.redirect('/receipts/'+req.params.id);
});

// ══════════════════════════════════════════════════════════════
// CHECKS (Чеки)
// ══════════════════════════════════════════════════════════════
app.get('/checks', auth, adminOnly, (req,res) => {
  const rows = db.prepare(`
    SELECT ch.*, u.name patient_name, r.amount receipt_amount
    FROM checks ch
    JOIN receipts r ON ch.receipt_id=r.id
    JOIN contracts c ON r.contract_id=c.id
    JOIN users u ON c.patient_id=u.id
    ORDER BY substr(ch.date,7,4)||substr(ch.date,4,2)||substr(ch.date,1,2) DESC
  `).all();
  const total = rows.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
  res.render('checks/index', { checks: rows, total });
});

app.post('/checks', auth, adminOnly, (req,res) => {
  const { receipt_id, amount, date, payment_method='Наличные' } = req.body;
  if (!receipt_id || !amount || !date) return res.redirect('back');
  db.prepare('INSERT INTO checks(receipt_id,amount,date,payment_method) VALUES(?,?,?,?)').run(receipt_id, parseFloat(amount)||0, date, payment_method);
  db.prepare("UPDATE receipts SET status='Оплачено' WHERE id=?").run(receipt_id);
  res.redirect('/receipts/'+receipt_id);
});

// ══════════════════════════════════════════════════════════════
// ADMIN: Справочники
// ══════════════════════════════════════════════════════════════
// Специализации
app.get('/admin/specializations', auth, adminOnly, (req,res) => {
  res.render('admin/specializations', { specs: db.prepare('SELECT * FROM specializations ORDER BY name').all(), error:null, success:null });
});
app.post('/admin/specializations', auth, adminOnly, (req,res) => {
  const { name='' } = req.body;
  const specs = db.prepare('SELECT * FROM specializations ORDER BY name').all();
  if (name.trim().length < 3) return res.render('admin/specializations', { specs, error:'Не менее 3 символов', success:null });
  try {
    db.prepare('INSERT INTO specializations(name) VALUES(?)').run(name.trim());
    res.render('admin/specializations', { specs: db.prepare('SELECT * FROM specializations ORDER BY name').all(), error:null, success:`«${name.trim()}» добавлена` });
  } catch { res.render('admin/specializations', { specs, error:'Уже существует', success:null }); }
});
app.post('/admin/specializations/:id/delete', auth, adminOnly, (req,res) => {
  db.prepare('DELETE FROM specializations WHERE id=?').run(req.params.id);
  res.redirect('/admin/specializations');
});

// Услуги
app.get('/admin/services', auth, adminOnly, (req,res) => {
  res.render('admin/services', { services: db.prepare('SELECT * FROM services ORDER BY name').all(), error:null, success:null });
});
app.post('/admin/services', auth, adminOnly, (req,res) => {
  const { name='', description='', price=0 } = req.body;
  const services = db.prepare('SELECT * FROM services ORDER BY name').all();
  if (name.trim().length < 3) return res.render('admin/services', { services, error:'Название не короче 3 символов', success:null });
  try {
    db.prepare('INSERT INTO services(name,description,price) VALUES(?,?,?)').run(name.trim(), description, parseFloat(price)||0);
    res.render('admin/services', { services: db.prepare('SELECT * FROM services ORDER BY name').all(), error:null, success:`«${name.trim()}» добавлена` });
  } catch { res.render('admin/services', { services, error:'Услуга с таким названием уже существует', success:null }); }
});
app.post('/admin/services/:id/delete', auth, adminOnly, (req,res) => {
  db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
  res.redirect('/admin/services');
});

// Пользователи
app.get('/admin/users', auth, adminOnly, (req,res) => {
  res.render('admin/users', { users: db.prepare('SELECT * FROM users ORDER BY role,name').all() });
});

// ══════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════
app.get('/reports', auth, adminOnly, (req,res) => {
  const { from='', to='', type='' } = req.query;
  let appointments=[], referrals=[];

  if (from && to) {
    const f = from.replace(/-/g,''), t = to.replace(/-/g,'');
    const dconv = `substr(%s,7,4)||substr(%s,4,2)||substr(%s,1,2)`;
    const dcA = dconv.replace(/%s/g,'a.datetime');
    const dcR = dconv.replace(/%s/g,'va.date_assigned');

    if (!type || type==='appointments') {
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
      `).all(f,t);
    }
    if (!type || type==='referrals') {
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
      `).all(f,t);
    }
  }
  const fmt = d => d ? d.split('-').reverse().join('.') : '';
  res.render('reports/index', { from, to, type, appointments, referrals, fmt });
});

// ══════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════
require('./db/database')().then(database => {
  db = database;
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  ✓  МедЦентр: http://localhost:${PORT}`);
    console.log('  admin@medcenter.ru / admin123');
    console.log('  ivanov.p@mail.ru / 123456\n');
  });
}).catch(e => { console.error(e); process.exit(1); });

// API: список услуг (для динамической загрузки)
app.get('/api/services', auth, (req,res) => {
  res.json(db.prepare('SELECT id,name,price FROM services ORDER BY name').all());
});
