const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('../config');
const logger = require('./logger');

const ACCOUNTS_JSON_PATH = path.join(__dirname, '..', 'data', 'ezytm_accounts.json');

let roundRobinIndex = 0;
const changeListeners = new Set();

function addAccountChangeListener(fn) {
  if (typeof fn === 'function') {
    changeListeners.add(fn);
  }
}

function removeAccountChangeListener(fn) {
  changeListeners.delete(fn);
}

function notifyChange(event, data) {
  for (const fn of changeListeners) {
    try {
      fn(event, data);
    } catch (err) {
      logger.error('Error in account change listener', { event, error: err.message });
    }
  }
}

/**
 * Load default fallback accounts if file or table is empty
 */
function getDefaultSeedAccounts() {
  const defaultUser = config.username || '8840457632';
  const defaultPass = config.password || '123456';
  return [
    {
      id: 'EZY_DEFAULT_1',
      username: defaultUser,
      password: defaultPass,
      label: 'Primary EzyTM Node',
      status: 'Active',
      total_requests: 0,
      success_requests: 0,
      failed_requests: 0,
      last_used_at: null,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
}

/**
 * Read accounts from JSON file
 */
function readAccountsFromFile() {
  try {
    if (fs.existsSync(ACCOUNTS_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_JSON_PATH, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {
    logger.warn('Error reading ezytm_accounts.json', { error: e.message });
  }

  const defaultAccounts = getDefaultSeedAccounts();
  saveAccountsToFile(defaultAccounts);
  return defaultAccounts;
}

/**
 * Save accounts to JSON file
 */
function saveAccountsToFile(accounts) {
  try {
    const dir = path.dirname(ACCOUNTS_JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACCOUNTS_JSON_PATH, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (e) {
    logger.error('Error writing ezytm_accounts.json', { error: e.message });
  }
}

/**
 * Get all accounts (Admin view) with dual-sync guarantee
 */
async function getAllAccounts() {
  let accountsFromDb = null;
  if (db.isConnected) {
    try {
      const res = await db.query('SELECT * FROM ezytm_accounts ORDER BY created_at ASC');
      if (res && Array.isArray(res.rows) && res.rows.length > 0) {
        accountsFromDb = res.rows;
        // Keep local file backup synced with DB
        saveAccountsToFile(accountsFromDb);
        return accountsFromDb;
      }
    } catch (e) {
      logger.warn('Database query for ezytm_accounts failed, using local store', { error: e.message });
    }
  }

  const fileAccounts = readAccountsFromFile();

  // If DB is connected but empty, seed DB from file
  if (db.isConnected && (!accountsFromDb || accountsFromDb.length === 0)) {
    for (const acc of fileAccounts) {
      try {
        await db.query(
          `INSERT INTO ezytm_accounts (id, username, password, label, status, total_requests, success_requests, failed_requests, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            acc.id || ('EZY_' + Date.now()),
            acc.username,
            acc.password,
            acc.label || `EzyTM (${acc.username})`,
            acc.status || 'Active',
            acc.total_requests || 0,
            acc.success_requests || 0,
            acc.failed_requests || 0
          ]
        );
      } catch (err) {}
    }
  }

  return fileAccounts;
}

/**
 * Get all active accounts
 */
async function getActiveAccounts() {
  const all = await getAllAccounts();
  const active = all.filter(a => a.status === 'Active');
  if (active.length === 0) {
    return all.length > 0 ? [all[0]] : getDefaultSeedAccounts();
  }
  return active;
}

/**
 * Add a new EzyTM Account (Persists to both DB and File)
 */
async function addAccount({ username, password, label }) {
  if (!username || !password) {
    throw new Error('Username and Password are required.');
  }

  const cleanUser = String(username).trim();
  const cleanPass = String(password).trim();
  const cleanLabel = String(label || `EzyTM (${cleanUser})`).trim();
  const accountId = 'EZY_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  let createdAccount = {
    id: accountId,
    username: cleanUser,
    password: cleanPass,
    label: cleanLabel,
    status: 'Active',
    total_requests: 0,
    success_requests: 0,
    failed_requests: 0,
    last_used_at: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (db.isConnected) {
    try {
      const res = await db.query(
        `INSERT INTO ezytm_accounts (id, username, password, label, status, total_requests, success_requests, failed_requests, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Active', 0, 0, 0, NOW(), NOW())
         RETURNING *`,
        [accountId, cleanUser, cleanPass, cleanLabel]
      );
      if (res && res.rows && res.rows[0]) {
        createdAccount = res.rows[0];
      }
    } catch (e) {
      logger.error('Failed to insert ezytm account into DB', { error: e.message });
    }
  }

  // Always sync to local file store
  const accounts = readAccountsFromFile();
  const existingIdx = accounts.findIndex(a => a.id === createdAccount.id || a.username === cleanUser);
  if (existingIdx !== -1) {
    accounts[existingIdx] = createdAccount;
  } else {
    accounts.push(createdAccount);
  }
  saveAccountsToFile(accounts);

  notifyChange('add', createdAccount);
  return createdAccount;
}

/**
 * Update an existing account (Persists to both DB and File)
 */
async function updateAccount(id, { username, password, label, status }) {
  if (!id) throw new Error('Account ID is required.');

  let updatedRow = null;

  if (db.isConnected) {
    try {
      const updates = [];
      const values = [id];
      let idx = 2;

      if (username) { updates.push(`username = $${idx++}`); values.push(String(username).trim()); }
      if (password) { updates.push(`password = $${idx++}`); values.push(String(password).trim()); }
      if (label) { updates.push(`label = $${idx++}`); values.push(String(label).trim()); }
      if (status) { updates.push(`status = $${idx++}`); values.push(status === 'Active' ? 'Active' : 'Disabled'); }
      updates.push(`updated_at = NOW()`);

      const sql = `UPDATE ezytm_accounts SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
      const res = await db.query(sql, values);
      if (res && res.rows && res.rows.length > 0) {
        updatedRow = res.rows[0];
      }
    } catch (e) {
      logger.error('Failed to update ezytm account in DB', { error: e.message });
    }
  }

  // Always sync to local file store
  const accounts = readAccountsFromFile();
  const accIndex = accounts.findIndex(a => a.id === id);
  if (accIndex !== -1) {
    if (username) accounts[accIndex].username = String(username).trim();
    if (password) accounts[accIndex].password = String(password).trim();
    if (label) accounts[accIndex].label = String(label).trim();
    if (status) accounts[accIndex].status = status === 'Active' ? 'Active' : 'Disabled';
    accounts[accIndex].updated_at = new Date().toISOString();
    saveAccountsToFile(accounts);
    if (!updatedRow) updatedRow = accounts[accIndex];
  }

  if (updatedRow) {
    notifyChange('update', updatedRow);
    return updatedRow;
  }
  throw new Error('Account not found.');
}

/**
 * Toggle active / disabled status
 */
async function toggleAccountStatus(id) {
  const all = await getAllAccounts();
  const target = all.find(a => a.id === id);
  if (!target) throw new Error('Account not found.');

  const newStatus = target.status === 'Active' ? 'Disabled' : 'Active';
  return await updateAccount(id, { status: newStatus });
}

/**
 * Delete an account (Deletes from both DB and File)
 */
async function deleteAccount(id) {
  if (!id) throw new Error('Account ID is required.');

  if (db.isConnected) {
    try {
      await db.query('DELETE FROM ezytm_accounts WHERE id = $1', [id]);
    } catch (e) {
      logger.error('Failed to delete ezytm account from DB', { error: e.message });
    }
  }

  const accounts = readAccountsFromFile();
  const filtered = accounts.filter(a => a.id !== id);
  saveAccountsToFile(filtered);
  notifyChange('delete', id);
  return true;
}

/**
 * Get Next Active Account (Round-Robin with failover support)
 */
async function getNextActiveAccount() {
  const activeAccounts = await getActiveAccounts();
  if (activeAccounts.length === 0) {
    return {
      id: 'EZY_CONFIG_FALLBACK',
      username: config.username || '8840457632',
      password: config.password || '123456',
      label: 'Config Fallback'
    };
  }

  // Atomic round-robin rotation
  const selected = activeAccounts[roundRobinIndex % activeAccounts.length];
  roundRobinIndex = (roundRobinIndex + 1) % activeAccounts.length;

  // Track usage asynchronously
  recordAccountUsage(selected.id).catch(() => {});

  return selected;
}

/**
 * Record usage
 */
async function recordAccountUsage(id) {
  if (!id) return;
  const now = new Date().toISOString();

  if (db.isConnected) {
    try {
      await db.query(
        'UPDATE ezytm_accounts SET total_requests = total_requests + 1, last_used_at = NOW() WHERE id = $1',
        [id]
      );
      return;
    } catch (e) {}
  }

  try {
    const accounts = readAccountsFromFile();
    const acc = accounts.find(a => a.id === id);
    if (acc) {
      acc.total_requests = (acc.total_requests || 0) + 1;
      acc.last_used_at = now;
      saveAccountsToFile(accounts);
    }
  } catch (e) {}
}

/**
 * Record success
 */
async function recordAccountSuccess(id) {
  if (!id) return;
  if (db.isConnected) {
    try {
      await db.query(
        'UPDATE ezytm_accounts SET success_requests = success_requests + 1, last_error = NULL WHERE id = $1',
        [id]
      );
      return;
    } catch (e) {}
  }

  try {
    const accounts = readAccountsFromFile();
    const acc = accounts.find(a => a.id === id);
    if (acc) {
      acc.success_requests = (acc.success_requests || 0) + 1;
      acc.last_error = null;
      saveAccountsToFile(accounts);
    }
  } catch (e) {}
}

/**
 * Record failure
 */
async function recordAccountFailure(id, errorMsg) {
  if (!id) return;
  const sanitizedErr = String(errorMsg || 'Connection timeout or authentication error').slice(0, 255);

  if (db.isConnected) {
    try {
      await db.query(
        'UPDATE ezytm_accounts SET failed_requests = failed_requests + 1, last_error = $2 WHERE id = $1',
        [id, sanitizedErr]
      );
      return;
    } catch (e) {}
  }

  try {
    const accounts = readAccountsFromFile();
    const acc = accounts.find(a => a.id === id);
    if (acc) {
      acc.failed_requests = (acc.failed_requests || 0) + 1;
      acc.last_error = sanitizedErr;
      saveAccountsToFile(accounts);
    }
  } catch (e) {}
}

module.exports = {
  getAllAccounts,
  getActiveAccounts,
  addAccount,
  updateAccount,
  toggleAccountStatus,
  deleteAccount,
  getNextActiveAccount,
  recordAccountSuccess,
  recordAccountFailure,
  addAccountChangeListener,
  removeAccountChangeListener
};
