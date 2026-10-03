require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// PostgreSQL Configuration
const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;

let pool = null;
let isConnected = false;

if (connectionString || process.env.PGHOST) {
  pool = new Pool({
    connectionString: connectionString || undefined,
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'planapi',
    port: parseInt(process.env.PGPORT || '5432', 10),
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('⚠️ [PostgreSQL Pool Error]:', err.message);
  });
}

// Database initialization
async function initDatabase() {
  if (!pool) {
    console.log('ℹ️ [Database]: PostgreSQL credentials not provided in .env. Running in hybrid local file mode (data/*.json). Set DATABASE_URL to enable live PostgreSQL.');
    return false;
  }

  try {
    const client = await pool.connect();
    isConnected = true;
    console.log('✅ [PostgreSQL]: Connected successfully to PostgreSQL database!');

    // Read and run schema.sql
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('✅ [PostgreSQL]: Database tables and indexes verified successfully.');
    }

    // Auto-migrate seed data if tables are empty
    await autoMigrateSeedData(client);

    client.release();
    return true;
  } catch (err) {
    console.warn('⚠️ [PostgreSQL Connection Notice]: Could not connect to PostgreSQL server (' + err.message + '). Fallback to local storage.');
    isConnected = false;
    return false;
  }
}

// Helper to migrate data from data/*.json into PostgreSQL if DB is empty
async function autoMigrateSeedData(client) {
  try {
    // 1. Settings
    const settingsRes = await client.query('SELECT COUNT(*) FROM settings');
    if (parseInt(settingsRes.rows[0].count, 10) === 0) {
      const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['app_settings', JSON.stringify(settingsData)]);
      }
    }

    // 2. Users
    const usersRes = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersRes.rows[0].count, 10) === 0) {
      const usersPath = path.join(__dirname, '..', 'data', 'users.json');
      if (fs.existsSync(usersPath)) {
        const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        for (const u of usersData) {
          await client.query(
            `INSERT INTO users (name, mobile, api_token, total_hits, used_hits, remaining_hits) 
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (mobile) DO NOTHING`,
            [u.name, u.mobile, u.apiToken, u.totalHits || 100, u.usedHits || 0, u.remainingHits !== undefined ? u.remainingHits : 100]
          );
        }
      }
    }

    // 3. Plans
    const plansRes = await client.query('SELECT COUNT(*) FROM plans');
    if (parseInt(plansRes.rows[0].count, 10) === 0) {
      const plansPath = path.join(__dirname, '..', 'data', 'plans.json');
      if (fs.existsSync(plansPath)) {
        const plansData = JSON.parse(fs.readFileSync(plansPath, 'utf8'));
        for (const p of plansData) {
          await client.query(
            `INSERT INTO plans (name, price, hits, validity_days, features) 
             VALUES ($1, $2, $3, $4, $5)`,
            [p.name, p.price, p.hits, p.validityDays || 30, JSON.stringify(p.features || [])]
          );
        }
      }
    }

    // 4. Payments
    const paymentsRes = await client.query('SELECT COUNT(*) FROM payments');
    if (parseInt(paymentsRes.rows[0].count, 10) === 0) {
      const paymentsPath = path.join(__dirname, '..', 'data', 'payments.json');
      if (fs.existsSync(paymentsPath)) {
        const paymentsData = JSON.parse(fs.readFileSync(paymentsPath, 'utf8'));
        for (const pay of paymentsData) {
          await client.query(
            `INSERT INTO payments (user_mobile, user_name, plan_id, plan_name, amount, utr_number, screenshot, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [pay.userMobile, pay.userName, pay.planId, pay.planName, pay.amount, pay.utrNumber, pay.screenshot || '', pay.status || 'Pending']
          );
        }
      }
    }
  } catch (migrationErr) {
    console.warn('⚠️ [PostgreSQL Migration Notice]:', migrationErr.message);
  }
}

// Universal Query function with fallback support
async function query(text, params) {
  if (pool && isConnected) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('❌ [PostgreSQL Query Error]:', err.message);
      throw err;
    }
  }
  return null;
}

module.exports = {
  pool,
  query,
  initDatabase,
  get isConnected() { return isConnected; }
};
