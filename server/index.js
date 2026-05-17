const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');

const store = require('./store');
const { authMiddleware, requireRoles, login } = require('./auth');
const unread = require('./unread');
const { aggregateVisits } = require('./visitStats');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const CV_DIR = path.join(UPLOADS, 'cvs');
const MSG_DIR = path.join(UPLOADS, 'messages');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// 📖 Read DB
function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

// ✍️ Write DB
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

[UPLOADS, CV_DIR, MSG_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

const cvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CV_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const msgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MSG_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const uploadCv = multer({
  storage: cvStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(pdf|doc|docx)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only PDF, DOC, or DOCX files are allowed'));
  },
});

const uploadMsg = multer({
  storage: msgStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

function db() {
  return store.load();
}

function persist(data) {
  store.save(data);
}

// ——— bootstrap ———
(() => {
  const d = db();
  store.seedIfEmpty(d);
})();

// ——— public ———
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = login(email, password);
  if (result.error) return res.status(401).json(result);
  res.json(result);
});

app.post('/api/careers/apply', (req, res, next) => {
  uploadCv.single('cv')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, (req, res) => {
  const d = db();
  const { name, email, phone, position } = req.body || {};
  if (!name || !email || !req.file) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Name, email, and CV file are required.' });
  }
  const row = {
    id: uuid(),
    name: String(name).trim(),
    email: String(email).trim(),
    phone: phone ? String(phone).trim() : '',
    position: position ? String(position).trim() : 'General application',
    cvFileName: req.file.originalname,
    cvPath: path.relative(ROOT, req.file.path).replace(/\\/g, '/'),
    createdAt: new Date().toISOString(),
  };
  d.applications.push(row);
  persist(d);
  res.json({ ok: true, id: row.id });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.post('/api/track/visit', (req, res) => {
  const d = db();
  if (!Array.isArray(d.visits)) d.visits = [];

  let visitorId = req.cookies && req.cookies.tll_vid;
  if (!visitorId || !UUID_RE.test(String(visitorId))) {
    visitorId = uuid();
  }

  const rawPath = (req.body && req.body.path) != null ? String(req.body.path) : req.originalUrl || '/';
  const safePath = rawPath.slice(0, 512);
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : req.socket.remoteAddress || '').trim().slice(0, 64);

  const row = {
    id: uuid(),
    visitorId,
    path: safePath || '/',
    kind: 'pageview',
    referrer: String(req.get('Referer') || '').slice(0, 800),
    userAgent: String(req.get('User-Agent') || '').slice(0, 500),
    ip,
    createdAt: new Date().toISOString(),
  };
  d.visits.push(row);
  if (d.visits.length > 10000) {
    d.visits = d.visits.slice(-10000);
  }
  persist(d);

  res.cookie('tll_vid', visitorId, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/track/click', (req, res) => {
  const d = db();
  if (!Array.isArray(d.visits)) d.visits = [];

  let visitorId = req.cookies && req.cookies.tll_vid;
  if (!visitorId || !UUID_RE.test(String(visitorId))) {
    visitorId = uuid();
  }

  const rawPath = (req.body && req.body.path) != null ? String(req.body.path) : '/';
  const safePath = rawPath.slice(0, 512);
  const count = Math.min(200, Math.max(1, parseInt(String((req.body && req.body.count) || '1'), 10) || 1));
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : req.socket.remoteAddress || '').trim().slice(0, 64);

  d.visits.push({
    id: uuid(),
    visitorId,
    path: safePath || '/',
    kind: 'click',
    clickCount: count,
    referrer: '',
    userAgent: String(req.get('User-Agent') || '').slice(0, 500),
    ip,
    createdAt: new Date().toISOString(),
  });
  if (d.visits.length > 10000) {
    d.visits = d.visits.slice(-10000);
  }
  persist(d);

  res.cookie('tll_vid', visitorId, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOADS));

// ——— authenticated ———
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ——— client ———
app.get('/api/client/shipments', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  const list = d.shipments.filter((s) => s.clientId === req.user.id);
  res.json({ shipments: list });
});

app.get('/api/client/messages', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  const list = d.messages
    .filter((m) => m.clientId === req.user.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages: list });
});

app.post('/api/client/messages', authMiddleware, requireRoles('client'), uploadMsg.single('file'), (req, res) => {
  const d = db();
  const body = (req.body && req.body.body) || '';
  const text = typeof body === 'string' ? body : String(body);
  if (!text.trim() && !req.file) {
    return res.status(400).json({ error: 'Message or file required.' });
  }
  const msg = {
    id: uuid(),
    clientId: req.user.id,
    senderId: req.user.id,
    body: text.trim() || (req.file ? `Shared file: ${req.file.originalname}` : ''),
    fileName: req.file ? req.file.originalname : null,
    filePath: req.file ? path.relative(ROOT, req.file.path).replace(/\\/g, '/') : null,
    createdAt: new Date().toISOString(),
  };
  d.messages.push(msg);
  persist(d);
  res.json({ message: msg });
});

app.get('/api/client/notifications', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  const sorted = [...d.notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ notifications: sorted });
});

app.get('/api/client/unread', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  const uid = req.user.id;
  res.json({
    messages: unread.countUnreadMessages(d, uid, uid),
    notifications: unread.countUnreadNotifications(d, uid),
  });
});

app.post('/api/client/messages/read', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  unread.markMessagesRead(d, req.user.id, req.user.id);
  persist(d);
  res.json({ ok: true });
});

app.post('/api/client/notifications/read', authMiddleware, requireRoles('client'), (req, res) => {
  const d = db();
  unread.markNotificationsRead(d, req.user.id);
  persist(d);
  res.json({ ok: true });
});

// ——— manager ———
app.get('/api/manager/clients', authMiddleware, requireRoles('manager'), (req, res) => {
  const d = db();
  const clients = d.users.filter((u) => u.role === 'client' && u.managerId === req.user.id);
  res.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      shipmentCount: d.shipments.filter((s) => s.clientId === c.id).length,
      unreadMessages: unread.countUnreadMessages(d, c.id, req.user.id),
    })),
  });
});

app.get('/api/manager/shipments', authMiddleware, requireRoles('manager'), (req, res) => {
  const d = db();
  const mine = d.shipments.filter((s) => s.managerId === req.user.id);
  res.json({ shipments: mine });
});

app.patch('/api/manager/shipments/:id', authMiddleware, requireRoles('manager'), (req, res) => {
  const d = db();
  const ship = d.shipments.find((s) => s.id === req.params.id && s.managerId === req.user.id);
  if (!ship) return res.status(404).json({ error: 'Shipment not found' });

  const { completeStageIndex, nextStage } = req.body || {};
  if (typeof completeStageIndex === 'number' && ship.stages[completeStageIndex]) {
    ship.stages.forEach((st, i) => {
      st.completed = i <= completeStageIndex;
    });
  } else if (nextStage === true) {
    const idx = ship.stages.findIndex((st) => !st.completed);
    if (idx >= 0) ship.stages[idx].completed = true;
  }
  ship.updatedAt = new Date().toISOString();
  persist(d);
  res.json({ shipment: ship });
});

app.get('/api/manager/messages', authMiddleware, requireRoles('manager'), (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) return res.status(400).json({ error: 'clientId query required' });
  const d = db();
  const client = d.users.find((u) => u.id === clientId && u.role === 'client');
  if (!client || client.managerId !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  const list = d.messages
    .filter((m) => m.clientId === clientId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages: list, client: { id: client.id, name: client.name, email: client.email } });
});

app.post('/api/manager/messages', authMiddleware, requireRoles('manager'), uploadMsg.single('file'), (req, res) => {
  const d = db();
  const clientId = req.body.clientId;
  const body = (req.body && req.body.body) || '';
  const text = typeof body === 'string' ? body : String(body);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = d.users.find((u) => u.id === clientId && u.role === 'client');
  if (!client || client.managerId !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  if (!text.trim() && !req.file) {
    return res.status(400).json({ error: 'Message or file required.' });
  }
  const msg = {
    id: uuid(),
    clientId,
    senderId: req.user.id,
    body: text.trim() || (req.file ? `Shared file: ${req.file.originalname}` : ''),
    fileName: req.file ? req.file.originalname : null,
    filePath: req.file ? path.relative(ROOT, req.file.path).replace(/\\/g, '/') : null,
    createdAt: new Date().toISOString(),
  };
  d.messages.push(msg);
  persist(d);
  res.json({ message: msg });
});

app.get('/api/manager/unread', authMiddleware, requireRoles('manager'), (req, res) => {
  const d = db();
  res.json({ messages: unread.managerTotalUnreadMessages(d, req.user.id) });
});

app.post('/api/manager/messages/read', authMiddleware, requireRoles('manager'), (req, res) => {
  const d = db();
  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = d.users.find((u) => u.id === clientId && u.role === 'client');
  if (!client || client.managerId !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  unread.markMessagesRead(d, req.user.id, clientId);
  persist(d);
  res.json({ ok: true });
});

// ——— super admin ———
app.get('/api/admin/users', authMiddleware, requireRoles('superadmin'), (req, res) => {
  const d = db();
  const userDto = (u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    managerId: u.managerId,
  });

  if (req.query.picker === '1') {
    const sorted = d.users.slice().sort((a, b) => {
      const ae = (a.email || '').toLowerCase();
      const be = (b.email || '').toLowerCase();
      if (ae !== be) return ae.localeCompare(be);
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    });
    return res.json({ users: sorted.map(userDto) });
  }

  const limit = 50;
  const sorted = d.users.slice().sort((a, b) => {
    const ae = (a.email || '').toLowerCase();
    const be = (b.email || '').toLowerCase();
    if (ae !== be) return ae.localeCompare(be);
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  let page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  page = Math.min(page, totalPages);
  const start = (page - 1) * limit;
  const slice = sorted.slice(start, start + limit);
  const managers = d.users
    .filter((u) => u.role === 'manager')
    .map(userDto)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

  res.json({
    users: slice.map(userDto),
    total,
    page,
    limit,
    totalPages,
    managers,
  });
});

app.post('/api/admin/users', authMiddleware, requireRoles('superadmin'), (req, res) => {
  const d = db();
  const { email, password, name, role, managerId } = req.body || {};
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'email, password, name, role required' });
  }
  if (!['client', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'role must be client or manager' });
  }
  if (d.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase().trim())) {
    return res.status(409).json({ error: 'Email already exists' });
  }
  if (role === 'client' && managerId) {
    const m = d.users.find((u) => u.id === managerId && u.role === 'manager');
    if (!m) return res.status(400).json({ error: 'Invalid managerId' });
  }
  const user = {
    id: uuid(),
    email: String(email).trim(),
    passwordHash: bcrypt.hashSync(String(password), 10),
    name: String(name).trim(),
    role,
    managerId: role === 'client' ? managerId || null : null,
  };
  d.users.push(user);
  persist(d);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, managerId: user.managerId } });
});

app.patch('/api/admin/users/:id', authMiddleware, requireRoles('superadmin'), (req, res) => {
  const d = db();
  const user = d.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { managerId, name } = req.body || {};
  if (user.role === 'client' && managerId !== undefined) {
    if (managerId === null || managerId === '') {
      user.managerId = null;
    } else {
      const m = d.users.find((u) => u.id === managerId && u.role === 'manager');
      if (!m) return res.status(400).json({ error: 'Invalid manager' });
      user.managerId = managerId;
    }
  }
  if (name) user.name = String(name).trim();
  persist(d);
  res.json({ ok: true });
});

app.patch('/api/admin/users/:id/password', authMiddleware, requireRoles('superadmin'), (req, res) => {
  const d = db();
  const user = d.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password } = req.body || {};
  const pw = password != null ? String(password) : '';
  if (pw.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  user.passwordHash = bcrypt.hashSync(pw, 10);
  persist(d);
  res.json({ ok: true });
});

app.post('/api/admin/notifications', authMiddleware, requireRoles('superadmin', 'webadmin'), (req, res) => {
  const d = db();
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const n = {
    id: uuid(),
    title: String(title).trim(),
    body: String(body).trim(),
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  d.notifications.push(n);
  persist(d);
  res.json({ notification: n });
});

app.get('/api/admin/applications', authMiddleware, requireRoles('superadmin', 'webadmin'), (req, res) => {
  const d = db();
  const sorted = [...d.applications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ applications: sorted });
});

app.get('/api/admin/visits/stats', authMiddleware, requireRoles('superadmin', 'webadmin'), (req, res) => {
  const d = db();
  const visits = Array.isArray(d.visits) ? d.visits : [];
  const period = String(req.query.period || 'day').toLowerCase();
  if (!['day', 'week', 'month'].includes(period)) {
    return res.status(400).json({ error: 'period must be day, week, or month' });
  }
  res.json(aggregateVisits(visits, period));
});

app.get('/api/admin/visits', authMiddleware, requireRoles('superadmin', 'webadmin'), (req, res) => {
  const d = db();
  const visits = Array.isArray(d.visits) ? d.visits : [];
  const limit = 50;
  const total = visits.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1));
  const sorted = visits.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * limit;
  const slice = sorted.slice(start, start + limit);
  const uniqueVisitors = new Set(visits.map((v) => v.visitorId)).size;
  res.json({
    visits: slice,
    total,
    page,
    limit,
    totalPages,
    uniqueVisitors,
  });
});

app.post('/api/admin/shipments', authMiddleware, requireRoles('superadmin'), (req, res) => {
  const d = db();
  const { clientId, managerId, title, description, trackingRef } = req.body || {};
  if (!clientId || !managerId || !title) {
    return res.status(400).json({ error: 'clientId, managerId, title required' });
  }
  const client = d.users.find((u) => u.id === clientId && u.role === 'client');
  const mgr = d.users.find((u) => u.id === managerId && u.role === 'manager');
  if (!client || !mgr) return res.status(400).json({ error: 'Invalid client or manager' });

  const stages = [
    { key: 'booked', label: 'Booking confirmed', completed: true },
    { key: 'pickup', label: 'Pickup / Origin handling', completed: false },
    { key: 'transit', label: 'In transit', completed: false },
    { key: 'customs', label: 'Customs / clearance', completed: false },
    { key: 'delivery', label: 'Out for delivery', completed: false },
    { key: 'delivered', label: 'Delivered', completed: false },
  ];

  const ref =
    trackingRef && String(trackingRef).trim()
      ? String(trackingRef).trim()
      : `TLL-${Date.now().toString(36).toUpperCase()}`;

  const ship = {
    id: uuid(),
    trackingRef: ref,
    clientId,
    title: String(title).trim(),
    description: description ? String(description).trim() : '',
    stages,
    managerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  d.shipments.push(ship);
  persist(d);
  res.json({ shipment: ship });
});

// Tracking shipment by trackingRef (public)
app.post("/api/shipment", (req, res) => {
    const { tracking_number, description } = req.body;

    const db = readDB();

    const newShipment = {
        id: Date.now(),
        tracking_number,
        description,
        created_at: new Date().toISOString()
    };

    db.shipments.push(newShipment);
    writeDB(db);

    res.json({
        message: "Saved",
        data: newShipment
    });
});

app.get("/api/shipment/:tracking", (req, res) => {
    const db = readDB();

    const data = db.shipments
        .filter(s => s.tracking_number === req.params.tracking)
        .sort((a, b) => b.id - a.id);

    if (data.length === 0) {
        return res.status(404).json({ message: "Not found" });
    }

    res.json({
        tracking_number: data[0].tracking_number,
        description: data[0].description
    });
});

// Tracking all shipments (public) end

app.use(express.static(ROOT));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Total Logistics server http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(
      `Port ${PORT} is already in use. Stop the other app (e.g. taskkill /PID <pid> /F) or run: set PORT=3001&&npm start`
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  process.exit(1);
});
