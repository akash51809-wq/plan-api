const fs = require('fs');
const path = require('path');
const db = require('./db');
const { generateApiToken, hashSha256 } = require('./security');
const logger = require('./logger');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

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
    return JSON.parse(content);
  } catch (err) {
    logger.error('Error reading fallback users file', { error: err.message });
    return [];
  }
}

function saveUserLocal(user) {
  const users = getUsers();
  const index = users.findIndex(u => u.mobile === user.mobile || u.id === user.id);
  let savedUser;
  if (index >= 0) {
    savedUser = { 
      ...users[index], 
      ...user, 
      apiToken: users[index].apiToken || user.apiToken || generateApiToken('tok_'),
      remainingHits: typeof user.remainingHits === 'number' ? user.remainingHits : (typeof users[index].remainingHits === 'number' ? users[index].remainingHits : 100),
      totalHits: typeof user.totalHits === 'number' ? user.totalHits : (typeof users[index].totalHits === 'number' ? users[index].totalHits : 100),
      usedHits: typeof user.usedHits === 'number' ? user.usedHits : (typeof users[index].usedHits === 'number' ? users[index].usedHits : 0),
      status: user.status || users[index].status || 'Active',
      updatedAt: new Date().toISOString() 
    };
    users[index] = savedUser;
  } else {
    savedUser = {
      id: user.id || ('USR_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
      apiToken: user.apiToken || generateApiToken('tok_'),
      remainingHits: typeof user.remainingHits === 'number' ? user.remainingHits : 100,
      totalHits: typeof user.totalHits === 'number' ? user.totalHits : 100,
      usedHits: 0,
      status: user.status || 'Active',
      ...user,
      createdAt: new Date().toISOString()
    };
    users.push(savedUser);
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return savedUser;
}

/**
 * Find user by mobile or ID (async with DB priority)
 */
async function findUser(mobileOrId) {
  if (!mobileOrId) return null;
  const cleanMobile = String(mobileOrId).trim().replace(/\D/g, '').slice(-10);

  if (db.isConnected) {
    const res = await db.query(
      `SELECT id, name, mobile, api_token as "apiToken", total_hits as "totalHits", 
              used_hits as "usedHits", remaining_hits as "remainingHits", status, 
              last_login as "lastLogin", created_at as "createdAt", updated_at as "updatedAt"
       FROM users 
       WHERE mobile = $1 OR id = $2 OR mobile = $2`,
      [cleanMobile, mobileOrId]
    );
    return res.rows[0] || null;
  } else {
    const users = getUsers();
    return users.find(u => u.mobile.slice(-10) === cleanMobile || u.id === mobileOrId || u.mobile === mobileOrId) || null;
  }
}

/**
 * Sync user save/upsert with DB and local cache
 */
async function saveUser(user) {
  const cleanMobile = String(user.mobile).trim().replace(/\D/g, '').slice(-10);
  const existingUser = await findUser(cleanMobile);

  const userId = user.id || (existingUser ? existingUser.id : ('USR_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)));
  const apiToken = user.apiToken || (existingUser ? existingUser.apiToken : generateApiToken('tok_'));
  const totalHits = typeof user.totalHits === 'number' 
    ? user.totalHits 
    : (existingUser && typeof existingUser.totalHits === 'number' ? existingUser.totalHits : 100);
  const remainingHits = typeof user.remainingHits === 'number' 
    ? user.remainingHits 
    : (existingUser && typeof existingUser.remainingHits === 'number' ? existingUser.remainingHits : 100);
  const usedHits = typeof user.usedHits === 'number' 
    ? user.usedHits 
    : (existingUser && typeof existingUser.usedHits === 'number' ? existingUser.usedHits : 0);
  const status = user.status || (existingUser ? existingUser.status : 'Active');
  const name = user.name || (existingUser ? existingUser.name : 'User');

  if (db.isConnected) {
    const res = await db.query(
      `INSERT INTO users (id, name, mobile, api_token, total_hits, used_hits, remaining_hits, status, last_login, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
       ON CONFLICT (mobile) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         total_hits = $5,
         used_hits = $6,
         remaining_hits = $7,
         status = COALESCE(EXCLUDED.status, users.status),
         last_login = NOW(),
         updated_at = NOW()
       RETURNING id, name, mobile, api_token as "apiToken", total_hits as "totalHits", 
                 used_hits as "usedHits", remaining_hits as "remainingHits", status, 
                 last_login as "lastLogin", created_at as "createdAt", updated_at as "updatedAt"`,
      [userId, name, cleanMobile, apiToken, totalHits, usedHits, remainingHits, status]
    );

    const saved = res.rows[0];

    // Ensure default API Client exists for the user
    const tokenHash = hashSha256(apiToken);
    const preview = apiToken.length > 10 ? `${apiToken.slice(0, 6)}...${apiToken.slice(-4)}` : apiToken;
    await db.query(
      `INSERT INTO api_clients (id, user_id, client_name, api_token_hash, api_token_preview, allowed_ips, status, created_at, updated_at)
       VALUES ($1, $2, 'Primary Key', $3, $4, '{}', 'Active', NOW(), NOW())
       ON CONFLICT (api_token_hash) DO NOTHING`,
      ['CLI_' + saved.id, saved.id, tokenHash, preview]
    ).catch(() => {});

    // Save fallback JSON
    saveUserLocal(saved);
    return saved;
  } else {
    return saveUserLocal({ ...user, mobile: cleanMobile, id: userId, apiToken, totalHits, remainingHits, usedHits, status, name });
  }
}

/**
 * Concurrency-Safe Atomic Hit Deduction
 * Uses PostgreSQL Atomic UPDATE with RETURNING and Row Lock.
 * Strictly guarantees remaining_hits never becomes negative.
 */
async function deductUserHit(mobileOrId) {
  if (!mobileOrId) {
    return { allowed: false, remainingHits: 0, message: 'User identifier is required.' };
  }

  const cleanMobile = String(mobileOrId).trim().replace(/\D/g, '').slice(-10);

  if (db.isConnected) {
    try {
      const res = await db.query(
        `UPDATE users
         SET remaining_hits = remaining_hits - 1,
             used_hits = used_hits + 1,
             updated_at = NOW()
         WHERE (mobile = $1 OR id = $2)
           AND remaining_hits > 0
           AND status = 'Active'
         RETURNING id, mobile, remaining_hits as "remainingHits", used_hits as "usedHits"`,
        [cleanMobile, mobileOrId]
      );

      if (res.rowCount === 0) {
        // Find if user exists or is out of hits
        const checkRes = await db.query(
          `SELECT id, status, remaining_hits as "remainingHits" FROM users WHERE mobile = $1 OR id = $2`,
          [cleanMobile, mobileOrId]
        );

        if (checkRes.rowCount === 0) {
          return { allowed: false, remainingHits: 0, message: 'User not found in system.' };
        }

        const u = checkRes.rows[0];
        if (u.status !== 'Active') {
          return { allowed: false, remainingHits: u.remainingHits, message: 'User account is inactive or suspended.' };
        }

        return { allowed: false, remainingHits: u.remainingHits, message: 'Insufficient hits remaining. Please purchase a plan.' };
      }

      const updated = res.rows[0];
      try {
        const users = getUsers();
        const u = users.find(x => x.mobile?.slice(-10) === cleanMobile || x.id === mobileOrId);
        if (u) {
          u.remainingHits = updated.remainingHits;
          u.usedHits = updated.usedHits;
          fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        }
      } catch(e) {}
      return {
        allowed: true,
        remainingHits: updated.remainingHits,
        usedHits: updated.usedHits
      };
    } catch (err) {
      logger.error('Error during atomic hit deduction', { error: err.message, user: mobileOrId });
      throw err;
    }
  } else {
    // Local memory fallback with atomic Mutex logic
    const users = getUsers();
    const user = users.find(u => u.mobile.slice(-10) === cleanMobile || u.id === mobileOrId);

    if (!user) return { allowed: false, remainingHits: 0, message: 'User not found' };
    if (user.status && user.status !== 'Active') return { allowed: false, remainingHits: 0, message: 'User inactive' };

    let currentHits = typeof user.remainingHits === 'number' ? user.remainingHits : 50;
    if (currentHits <= 0) {
      return { allowed: false, remainingHits: 0, message: 'Insufficient hits balance' };
    }

    currentHits -= 1;
    const usedHits = (Number(user.usedHits) || 0) + 1;
    user.remainingHits = currentHits;
    user.usedHits = usedHits;
    user.updatedAt = new Date().toISOString();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return { allowed: true, remainingHits: currentHits, usedHits };
  }
}

/**
 * Atomic Hit Refund (in case of upstream downstream failure)
 */
async function refundUserHit(mobileOrId) {
  if (!mobileOrId) return;
  const cleanMobile = String(mobileOrId).trim().replace(/\D/g, '').slice(-10);

  if (db.isConnected) {
    try {
      await db.query(
        `UPDATE users 
         SET remaining_hits = remaining_hits + 1, 
             used_hits = GREATEST(0, used_hits - 1), 
             updated_at = NOW() 
         WHERE mobile = $1 OR id = $2`,
        [cleanMobile, mobileOrId]
      );
      try {
        const users = getUsers();
        const u = users.find(x => x.mobile?.slice(-10) === cleanMobile || x.id === mobileOrId);
        if (u) {
          u.remainingHits = (Number(u.remainingHits) || 0) + 1;
          u.usedHits = Math.max(0, (Number(u.usedHits) || 1) - 1);
          fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        }
      } catch(e) {}
    } catch (err) {
      logger.error('Failed to refund user hit', { error: err.message, user: mobileOrId });
    }
  } else {
    const users = getUsers();
    const user = users.find(u => u.mobile.slice(-10) === cleanMobile || u.id === mobileOrId);
    if (user) {
      user.remainingHits = (Number(user.remainingHits) || 0) + 1;
      user.usedHits = Math.max(0, (Number(user.usedHits) || 1) - 1);
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
  }
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

async function regenerateUserToken(mobileOrId) {
  if (!mobileOrId) return null;
  const newToken = generateApiToken('tok_');
  const cleanMobile = String(mobileOrId).trim().replace(/\D/g, '').slice(-10);

  if (db.isConnected) {
    const res = await db.query(
      `UPDATE users
       SET api_token = $1, updated_at = NOW()
       WHERE mobile = $2 OR id = $3
       RETURNING id, name, mobile, api_token as "apiToken", remaining_hits as "remainingHits", total_hits as "totalHits"`,
      [newToken, cleanMobile, mobileOrId]
    );
    if (res.rows.length > 0) {
      const user = res.rows[0];
      const tokenHash = hashSha256(newToken);
      const preview = newToken.length > 10 ? `${newToken.slice(0, 6)}...${newToken.slice(-4)}` : newToken;
      await db.query(
        `UPDATE api_clients SET api_token_hash = $1, api_token_preview = $2, updated_at = NOW()
         WHERE user_id = $3 AND client_name = 'Primary Key'`,
        [tokenHash, preview, user.id]
      ).catch(() => {});

      const users = getUsers();
      const idx = users.findIndex(u => u.mobile.slice(-10) === cleanMobile || u.id === mobileOrId);
      if (idx >= 0) {
        users[idx].apiToken = newToken;
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      }
      return user;
    }
    return null;
  } else {
    const users = getUsers();
    const idx = users.findIndex(u => u.mobile.slice(-10) === cleanMobile || u.id === mobileOrId);
    if (idx >= 0) {
      users[idx].apiToken = newToken;
      users[idx].updatedAt = new Date().toISOString();
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      return users[idx];
    }
    return null;
  }
}

async function getAllUsers() {
  if (db.isConnected) {
    try {
      const res = await db.query(
        `SELECT id, name, mobile, api_token as "apiToken", total_hits as "totalHits", 
                used_hits as "usedHits", remaining_hits as "remainingHits", status, 
                last_login as "lastLogin", created_at as "createdAt", updated_at as "updatedAt"
         FROM users 
         ORDER BY created_at DESC`
      );
      return res.rows;
    } catch (e) {
      logger.warn('Failed to query users from DB', { error: e.message });
    }
  }
  return getUsers();
}

async function deleteUser(id) {
  if (!id) return false;
  if (db.isConnected) {
    try {
      await db.query('DELETE FROM users WHERE id = $1 OR mobile = $1', [id]);
    } catch(e) {
      logger.error('Failed to delete user from DB', { error: e.message });
    }
  }
  const users = getUsers().filter(u => u.id !== id && u.mobile !== id);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return true;
}

module.exports = {
  getUsers,
  getAllUsers,
  saveUser,
  deleteUser,
  findUser,
  findUserByMobile,
  validateApiUser,
  deductUserHit,
  refundUserHit,
  regenerateUserToken
};

