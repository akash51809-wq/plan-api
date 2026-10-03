const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./logger');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'operator_cache.json');

// In-Memory Fast Cache Map (<0.001 ms lookup)
const memoryCache = new Map();

/**
 * Calculate Expiry: Today's midnight to Next 2nd Midnight (00:00:00)
 * Example: Fetched on Oct 3 3:00 PM -> Valid through Oct 4 full day -> Expires Oct 5 00:00:00
 */
function getNext2MidnightExpiry(fromDate = new Date()) {
  const d = new Date(fromDate);
  // Move 1 day ahead to tomorrow midnight (1st midnight)
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  // Move 1 more day ahead to day after tomorrow midnight (2nd midnight)
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * Load cache from local JSON file
 */
function loadJsonCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [mobile, item] of Object.entries(data)) {
        if (item && item.expires_at && new Date(item.expires_at).getTime() > now) {
          memoryCache.set(mobile, item);
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to read operator_cache.json', { error: err.message });
  }
}

/**
 * Save memory cache to local JSON file
 */
function saveJsonCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const cleanObj = {};
    for (const [mobile, item] of memoryCache.entries()) {
      if (item && item.expires_at && new Date(item.expires_at).getTime() > now) {
        cleanObj[mobile] = item;
      }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cleanObj, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to write operator_cache.json', { error: err.message });
  }
}

/**
 * Initialize Operator Cache from Database and JSON Store
 */
async function initOperatorCache() {
  loadJsonCache();

  try {
    if (db.isDbConnected()) {
      // Create table if not exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS operator_fetch_cache (
          mobile VARCHAR(20) PRIMARY KEY,
          operator VARCHAR(100) NOT NULL,
          circle VARCHAR(100) NOT NULL,
          opcode VARCHAR(20),
          circle_code VARCHAR(20),
          cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_fetch_cache_expires ON operator_fetch_cache(expires_at);
      `);

      // Load active unexpired cache from DB
      const res = await db.query(`
        SELECT mobile, operator, circle, opcode, circle_code, cached_at, expires_at 
        FROM operator_fetch_cache 
        WHERE expires_at > NOW()
      `);

      if (res && res.rows) {
        for (const row of res.rows) {
          memoryCache.set(row.mobile, {
            mobile: row.mobile,
            operator: row.operator,
            circle: row.circle,
            opcode: row.opcode,
            circleCode: row.circle_code,
            cached_at: row.cached_at,
            expires_at: row.expires_at,
            cached: true
          });
        }
        logger.info(`Loaded ${res.rows.length} valid unexpired operator records from PostgreSQL cache.`);
      }
    }
  } catch (err) {
    logger.warn('Operator cache database sync notice', { error: err.message });
  }
}

/**
 * Get Operator details for mobile if cached and not expired
 * Returns cached object or null
 */
async function getOperator(mobile) {
  const clean = String(mobile).trim().replace(/\D/g, '').slice(-10);
  if (!clean || clean.length !== 10) return null;

  const now = Date.now();

  // 1. Fast In-Memory Check (<0.001 ms)
  if (memoryCache.has(clean)) {
    const item = memoryCache.get(clean);
    if (item && item.expires_at && new Date(item.expires_at).getTime() > now) {
      return {
        ...item,
        cached: true,
        isCacheHit: true
      };
    } else {
      memoryCache.delete(clean);
    }
  }

  // 2. Database Check
  try {
    if (db.isDbConnected()) {
      const res = await db.query(
        'SELECT mobile, operator, circle, opcode, circle_code, cached_at, expires_at FROM operator_fetch_cache WHERE mobile = $1 AND expires_at > NOW()',
        [clean]
      );
      if (res && res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        const record = {
          mobile: row.mobile,
          operator: row.operator,
          circle: row.circle,
          opcode: row.opcode,
          circleCode: row.circle_code,
          cached_at: row.cached_at,
          expires_at: row.expires_at,
          cached: true,
          isCacheHit: true
        };
        memoryCache.set(clean, record);
        return record;
      }
    }
  } catch (err) {
    logger.warn('Database lookup for operator cache failed', { mobile: clean, error: err.message });
  }

  return null;
}

/**
 * Set and Persist Operator result with 2-Midnight Expiry
 */
async function setOperator(mobile, data) {
  const clean = String(mobile).trim().replace(/\D/g, '').slice(-10);
  if (!clean || clean.length !== 10) return;

  const operator = data.operator || 'Unknown';
  const circle = data.circle || 'Unknown';
  const opcode = String(data.opcode || data.opCode || '');
  const circleCode = String(data.circleCode || data.circle_code || '');

  if (operator === 'Unknown' || !operator) return;

  const expires_at = getNext2MidnightExpiry();
  const record = {
    mobile: clean,
    operator,
    circle,
    opcode,
    circleCode,
    cached_at: new Date().toISOString(),
    expires_at,
    cached: true
  };

  // 1. Update In-Memory Cache
  memoryCache.set(clean, record);

  // 2. Dual-Persist to Local JSON file
  saveJsonCache();

  // 3. Dual-Persist to PostgreSQL Database
  try {
    if (db.isDbConnected()) {
      await db.query(`
        INSERT INTO operator_fetch_cache (mobile, operator, circle, opcode, circle_code, cached_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        ON CONFLICT (mobile) DO UPDATE SET
          operator = EXCLUDED.operator,
          circle = EXCLUDED.circle,
          opcode = EXCLUDED.opcode,
          circle_code = EXCLUDED.circle_code,
          cached_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `, [clean, operator, circle, opcode, circleCode, expires_at]);
    }
  } catch (err) {
    logger.warn('Database save for operator cache notice', { mobile: clean, error: err.message });
  }

  return record;
}

/**
 * Purge Expired Records from Memory and DB
 */
async function purgeExpired() {
  const now = Date.now();
  for (const [mobile, item] of memoryCache.entries()) {
    if (item && item.expires_at && new Date(item.expires_at).getTime() <= now) {
      memoryCache.delete(mobile);
    }
  }
  saveJsonCache();

  try {
    if (db.isDbConnected()) {
      await db.query('DELETE FROM operator_fetch_cache WHERE expires_at <= NOW()');
    }
  } catch (err) {}
}

// Run cleanup every 1 hour
setInterval(purgeExpired, 60 * 60 * 1000);

module.exports = {
  getNext2MidnightExpiry,
  initOperatorCache,
  getOperator,
  setOperator,
  purgeExpired,
  memoryCache
};
