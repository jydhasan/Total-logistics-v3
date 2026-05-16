const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaultStages = () => [
  { key: 'booked', label: 'Booking confirmed', completed: true },
  { key: 'pickup', label: 'Pickup / Origin handling', completed: false },
  { key: 'transit', label: 'In transit', completed: false },
  { key: 'customs', label: 'Customs / clearance', completed: false },
  { key: 'delivery', label: 'Out for delivery', completed: false },
  { key: 'delivered', label: 'Delivered', completed: false },
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyDb() {
  return {
    users: [],
    shipments: [],
    messages: [],
    notifications: [],
    applications: [],
    cursors: { messages: {}, notifications: {} },
    visits: [],
  };
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    const db = emptyDb();
    save(db);
    return db;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    const db = JSON.parse(raw);
    if (!db.cursors) db.cursors = { messages: {}, notifications: {} };
    else {
      if (!db.cursors.messages) db.cursors.messages = {};
      if (!db.cursors.notifications) db.cursors.notifications = {};
    }
    if (!Array.isArray(db.visits)) db.visits = [];
    return db;
  } catch {
    return emptyDb();
  }
}

function save(db) {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function seedIfEmpty(db) {
  if (db.users.length > 0) return db;

  const hash = (p) => bcrypt.hashSync(p, 10);
  const superadminId = uuid();
  const webadminId = uuid();
  const managerId = uuid();
  const clientId = uuid();

  db.users = [
    {
      id: superadminId,
      email: 'superadmin@tll.com.bd',
      passwordHash: hash('admin123'),
      name: 'Super Admin',
      role: 'superadmin',
      managerId: null,
    },
    {
      id: webadminId,
      email: 'webadmin@tll.com.bd',
      passwordHash: hash('webadmin123'),
      name: 'Web Admin',
      role: 'webadmin',
      managerId: null,
    },
    {
      id: managerId,
      email: 'manager@tll.com.bd',
      passwordHash: hash('manager123'),
      name: 'Operations Manager',
      role: 'manager',
      managerId: null,
    },
    {
      id: clientId,
      email: 'client@tll.com.bd',
      passwordHash: hash('client123'),
      name: 'Demo Client Ltd',
      role: 'client',
      managerId: managerId,
    },
  ];

  const shipId = uuid();
  db.shipments = [
    {
      id: shipId,
      trackingRef: 'TLL-DEMO-001',
      clientId,
      title: 'Dhaka to Chittagong FCL',
      description: '40ft container — industrial machinery',
      stages: defaultStages(),
      managerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  db.messages = [
    {
      id: uuid(),
      clientId,
      senderId: managerId,
      body: 'Welcome to Total Logistics. Your shipment is booked and we will confirm pickup shortly.',
      fileName: null,
      filePath: null,
      createdAt: new Date().toISOString(),
    },
  ];

  db.notifications = [
    {
      id: uuid(),
      title: 'Holiday schedule',
      body: 'Our offices will operate with reduced hours during national holidays. Tracking remains 24/7.',
      createdBy: superadminId,
      createdAt: new Date().toISOString(),
    },
  ];

  save(db);
  return db;
}

function getDb() {
  const db = load();
  return db;
}

module.exports = {
  load,
  save,
  seedIfEmpty,
  getDb,
  DATA_DIR,
};
