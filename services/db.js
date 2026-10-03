require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
const isProduction = process.env.NODE_ENV === 'production';
const allowLocalFallback = process.env.ALLOW_LOCAL_FALLBACK === 'true' || !isProduction;

let pool = null;
let isConnected = false;

if (connectionString || process.env.PGHOST) {
  const isSslRequired = process.env.PGSSL === 'true' || (connectionString && connectionString.includes('sslmode=require')) || (isProduction && !connectionString?.includes('localhost'));
  
  pool = new Pool({
    connectionString: connectionString || undefined,
    host: process.env.PGHOST || undefined,
    user: process.env.PGUSER || undefined,
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || undefined,
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
    ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.PG_MAX_POOL || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    logger.error('PostgreSQL Pool background client error', { error: err.message });
  });
}

/**
 * Initialize Database and run migrations
 */
async function initDatabase() {
  if (!pool) {
    if (isProduction && !allowLocalFallback) {
      const err = new Error('DATABASE_URL is not configured in production environment!');
      logger.error('Database connection failed', { error: err.message });
      throw err;
    }
    logger.info('Database credentials not set. Running in development local file store mode.');
    return false;
  }

  try {
    const client = await pool.connect();
    isConnected = true;
    logger.info('Connected successfully to PostgreSQL database pool.');

    // Execute schema.sql
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      logger.info('PostgreSQL schema, indexes, and tables verified successfully.');
    }

    // Run idempotent seed migration
    await autoMigrateSeedData(client);

    client.release();
    return true;
  } catch (err) {
    isConnected = false;
    logger.error('Failed to connect or migrate PostgreSQL database', { error: err.message });
    if (isProduction && !allowLocalFallback) {
      throw err;
    }
    logger.warn('Falling back to local data store due to ALLOW_LOCAL_FALLBACK=true.');
    return false;
  }
}

/**
 * Idempotent Seed Migration
 */
async function autoMigrateSeedData(client) {
  try {
    // 1. Settings Migration
    const settingsRes = await client.query('SELECT COUNT(*) FROM settings');
    if (parseInt(settingsRes.rows[0].count, 10) === 0) {
      const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        await client.query(
          `INSERT INTO settings (key, value, updated_at) 
           VALUES ($1, $2, NOW()) 
           ON CONFLICT (key) DO NOTHING`,
          ['app_settings', JSON.stringify(settingsData)]
        );
      }
    }

    // 2. Users Migration
    const usersRes = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersRes.rows[0].count, 10) === 0) {
      const usersPath = path.join(__dirname, '..', 'data', 'users.json');
      if (fs.existsSync(usersPath)) {
        const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        for (const u of usersData) {
          const userId = u.id || ('USR_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
          const apiToken = u.apiToken || ('tok_' + Math.random().toString(36).substr(2, 10));
          await client.query(
            `INSERT INTO users (id, name, mobile, api_token, total_hits, used_hits, remaining_hits, status, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) 
             ON CONFLICT (mobile) DO NOTHING`,
            [
              userId,
              u.name || 'User',
              u.mobile,
              apiToken,
              typeof u.totalHits === 'number' ? u.totalHits : 100,
              typeof u.usedHits === 'number' ? u.usedHits : 0,
              typeof u.remainingHits === 'number' ? u.remainingHits : 100,
              u.status || 'Active'
            ]
          );

          // Auto-create default API Client for existing user
          const crypto = require('crypto');
          const tokenHash = crypto.createHash('sha256').update(apiToken).digest('hex');
          const clientId = 'CLI_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
          const preview = apiToken.length > 10 ? `${apiToken.slice(0, 6)}...${apiToken.slice(-4)}` : apiToken;

          await client.query(
            `INSERT INTO api_clients (id, user_id, client_name, api_token_hash, api_token_preview, allowed_ips, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
             ON CONFLICT (api_token_hash) DO NOTHING`,
            [clientId, userId, 'Default Client', tokenHash, preview, '{}', 'Active']
          );
        }
      }
    }

    // 3. Plans Migration
    const plansRes = await client.query('SELECT COUNT(*) FROM plans');
    if (parseInt(plansRes.rows[0].count, 10) === 0) {
      const defaultPlans = [
        { id: 'PLAN_100', name: 'Starter Plan', amount: 100, hits: 20000, validity_days: 30, features: ['20,000 API Hits', 'High Speed Routing', 'All Operators Included'] },
        { id: 'PLAN_200', name: 'Pro Plan', amount: 200, hits: 50000, validity_days: 30, features: ['50,000 API Hits', 'Priority Microsecond Engine', 'DTH + R-Offer Support'] },
        { id: 'PLAN_500', name: 'Business Plan', amount: 500, hits: 150000, validity_days: 30, features: ['150,000 API Hits', 'Unlimited Concurrency', 'Dedicated Fast Node'] },
        { id: 'PLAN_1000', name: 'Enterprise Plan', amount: 1000, hits: 350000, validity_days: 30, features: ['350,000 API Hits', 'Dedicated Server IP', '24/7 SLA Support'] }
      ];

      for (const p of defaultPlans) {
        await client.query(
          `INSERT INTO plans (id, name, amount, hits, validity_days, features, is_active, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [p.id, p.name, p.amount, p.hits, p.validity_days, JSON.stringify(p.features)]
        );
      }
    }

  } catch (err) {
    logger.warn('Seed migration notice', { error: err.message });
  }
}

/**
 * Execute a SQL query with parameter binding
 */
async function query(text, params = []) {
  if (pool && isConnected) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      logger.error('Database query execution error', { error: err.message, query: text });
      throw err;
    }
  }
  return null;
}

/**
 * Execute an atomic transaction with automatic rollback on error
 */
async function transaction(callback) {
  if (!pool || !isConnected) {
    throw new Error('PostgreSQL database is not connected. Transactions require an active database.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back due to error', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Close pool during graceful shutdown
 */
async function closePool() {
  if (pool) {
    try {
      await pool.end();
      isConnected = false;
      logger.info('PostgreSQL connection pool closed cleanly.');
    } catch (err) {
      logger.error('Error closing database pool', { error: err.message });
    }
  }
}

module.exports = {
  pool,
  query,
  transaction,
  initDatabase,
  closePool,
  get isConnected() { return isConnected; }
};
