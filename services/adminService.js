const db = require('./db');
const { hashPassword, verifyPassword, signSessionToken, verifySessionToken } = require('./security');
const { getSettings } = require('./whatsappService');
const logger = require('./logger');

/**
 * Verify Admin Login credentials and issue signed session token
 */
async function loginAdmin(username, password) {
  if (!username || !password) {
    return { success: false, message: 'Username and password are required.' };
  }

  const cleanUser = String(username).trim();
  const cleanPass = String(password);

  if (db.isConnected) {
    // Check admin_users table
    const res = await db.query('SELECT * FROM admin_users WHERE username = $1', [cleanUser]);
    if (res.rows.length > 0) {
      const admin = res.rows[0];
      const valid = verifyPassword(cleanPass, admin.salt, admin.password_hash);
      if (!valid) {
        return { success: false, message: 'Invalid Admin username or password.' };
      }

      const token = signSessionToken({ role: 'admin', username: admin.username }, 24 * 60 * 60 * 1000);
      return { success: true, token, message: 'Admin login successful.' };
    }
  }

  // Fallback: Verify against configured settings / environment
  const settings = getSettings();
  const validAdminUser = process.env.ADMIN_USERNAME || settings.adminUsername || 'admin';
  const validAdminPass = process.env.ADMIN_PASSWORD || settings.adminPassword || 'admin123';

  if (cleanUser === validAdminUser && cleanPass === validAdminPass) {
    // Auto-seed to admin_users table if DB is active
    if (db.isConnected) {
      const { salt, hash } = hashPassword(cleanPass);
      db.query(
        `INSERT INTO admin_users (username, password_hash, salt, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (username) DO NOTHING`,
        [cleanUser, hash, salt]
      ).catch(() => {});
    }

    const token = signSessionToken({ role: 'admin', username: cleanUser }, 24 * 60 * 60 * 1000);
    return { success: true, token, message: 'Admin login successful.' };
  }

  return { success: false, message: 'Invalid Admin username or password.' };
}

/**
 * Verify Admin Session Token from Authorization header or cookie
 */
function verifyAdminSession(token) {
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (payload && payload.role === 'admin') {
    return payload;
  }
  return null;
}

module.exports = {
  loginAdmin,
  verifyAdminSession
};
