const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('./store');

const JWT_SECRET = process.env.JWT_SECRET || 'total-logistics-dev-secret-change-in-production';

function signUser(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = store.getDb();
  const user = db.users.find((u) => u.id === payload.sub);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: user.id, role: user.role, email: user.email, name: user.name, managerId: user.managerId };
  req.dbUser = user;
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function login(email, password) {
  const db = store.getDb();
  store.seedIfEmpty(db);
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { error: 'Invalid email or password' };
  }
  const token = signUser(user);
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

module.exports = {
  authMiddleware,
  requireRoles,
  login,
  signUser,
  verifyToken,
  JWT_SECRET,
};
