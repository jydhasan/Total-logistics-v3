function msgKey(viewerId, threadClientId) {
  return `${viewerId}::${threadClientId}`;
}

function ensureCursors(db) {
  if (!db.cursors) db.cursors = { messages: {}, notifications: {} };
  if (!db.cursors.messages) db.cursors.messages = {};
  if (!db.cursors.notifications) db.cursors.notifications = {};
}

function countUnreadMessages(db, threadClientId, viewerId) {
  ensureCursors(db);
  const t = new Date(db.cursors.messages[msgKey(viewerId, threadClientId)] || 0).getTime();
  return db.messages.filter((m) => {
    if (m.clientId !== threadClientId) return false;
    if (m.senderId === viewerId) return false;
    return new Date(m.createdAt).getTime() > t;
  }).length;
}

function countUnreadNotifications(db, userId) {
  ensureCursors(db);
  const t = new Date(db.cursors.notifications[userId] || 0).getTime();
  return db.notifications.filter((n) => new Date(n.createdAt).getTime() > t).length;
}

function markMessagesRead(db, viewerId, threadClientId) {
  ensureCursors(db);
  db.cursors.messages[msgKey(viewerId, threadClientId)] = new Date().toISOString();
}

function markNotificationsRead(db, userId) {
  ensureCursors(db);
  db.cursors.notifications[userId] = new Date().toISOString();
}

function managerTotalUnreadMessages(db, managerId) {
  const clients = db.users.filter((u) => u.role === 'client' && u.managerId === managerId);
  return clients.reduce((sum, c) => sum + countUnreadMessages(db, c.id, managerId), 0);
}

module.exports = {
  ensureCursors,
  countUnreadMessages,
  countUnreadNotifications,
  markMessagesRead,
  markNotificationsRead,
  managerTotalUnreadMessages,
};
