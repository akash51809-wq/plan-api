const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// In-memory store for pending OTPs: { [mobile]: { otp, name, expiresAt } }
const pendingOTPs = new Map();

function generateApiToken() {
  return 'tok_' + crypto.randomBytes(12).toString('hex');
}

function getUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      const dataDir = path.dirname(USERS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const content = fs.readFileSync(USERS_FILE, 'utf8');
    const users = JSON.parse(content);
    let updated = false;
    users.forEach(u => {
      if (!u.apiToken) {
        u.apiToken = generateApiToken();
        updated = true;
      }
      if (typeof u.remainingHits !== 'number') {
        u.remainingHits = 100;
        u.totalHits = 100;
        u.usedHits = 0;
        updated = true;
      }
    });
    if (updated) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
    return users;
  } catch (err) {
    console.error('Error reading users:', err);
    return [];
  }
}

function saveUser(user) {
  const users = getUsers();
  const index = users.findIndex(u => u.mobile === user.mobile);
  let savedUser;
  if (index >= 0) {
    savedUser = { 
      ...users[index], 
      ...user, 
      apiToken: users[index].apiToken || user.apiToken || generateApiToken(),
      remainingHits: typeof user.remainingHits === 'number' ? user.remainingHits : (typeof users[index].remainingHits === 'number' ? users[index].remainingHits : 100),
      totalHits: typeof user.totalHits === 'number' ? user.totalHits : (typeof users[index].totalHits === 'number' ? users[index].totalHits : 100),
      usedHits: typeof user.usedHits === 'number' ? user.usedHits : (typeof users[index].usedHits === 'number' ? users[index].usedHits : 0),
      updatedAt: new Date().toISOString() 
    };
    users[index] = savedUser;
  } else {
    savedUser = {
      id: 'USR_' + Date.now(),
      apiToken: user.apiToken || generateApiToken(),
      remainingHits: typeof user.remainingHits === 'number' ? user.remainingHits : 100,
      totalHits: typeof user.totalHits === 'number' ? user.totalHits : 100,
      usedHits: 0,
      ...user,
      createdAt: new Date().toISOString()
    };
    users.push(savedUser);
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  // Async sync to PostgreSQL if connected
  if (db.isConnected) {
    db.query(
      `INSERT INTO users (name, mobile, api_token, total_hits, used_hits, remaining_hits, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (mobile) DO UPDATE SET
       name = EXCLUDED.name,
       api_token = EXCLUDED.api_token,
       total_hits = EXCLUDED.total_hits,
       used_hits = EXCLUDED.used_hits,
       remaining_hits = EXCLUDED.remaining_hits,
       updated_at = NOW()`,
      [savedUser.name, savedUser.mobile, savedUser.apiToken, savedUser.totalHits, savedUser.usedHits, savedUser.remainingHits]
    ).catch(e => console.warn('[PostgreSQL user sync notice]:', e.message));
  }

  return savedUser;
}

function findUserByMobile(mobile) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  const users = getUsers();
  return users.find(u => u.mobile.slice(-10) === cleanMobile);
}

function validateApiUser(apiUserId, token) {
  if (!apiUserId || !token) return null;
  const cleanUserId = String(apiUserId).trim().replace(/\D/g, '').slice(-10);
  const cleanToken = String(token).trim();
  const users = getUsers();

  return users.find(u => 
    (u.mobile.slice(-10) === cleanUserId || u.id === apiUserId) &&
    u.apiToken === cleanToken
  ) || null;
}

function generateOTP(mobile, name) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 mins

  pendingOTPs.set(cleanMobile, { otp, name, expiresAt });
  return otp;
}

function verifyOTP(mobile, otp) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  const pending = pendingOTPs.get(cleanMobile);

  if (!pending) {
    return { valid: false, message: 'OTP not requested or expired. Please request a new OTP.' };
  }

  if (Date.now() > pending.expiresAt) {
    pendingOTPs.delete(cleanMobile);
    return { valid: false, message: 'OTP has expired. Please request a new OTP.' };
  }

  if (pending.otp !== String(otp).trim()) {
    return { valid: false, message: 'Invalid OTP. Please check and try again.' };
  }

  pendingOTPs.delete(cleanMobile);
  return { valid: true, name: pending.name };
}

module.exports = {
  getUsers,
  saveUser,
  findUserByMobile,
  validateApiUser,
  generateOTP,
  verifyOTP
};
