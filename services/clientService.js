const db = require('./db');
const { generateApiToken, hashSha256, timingSafeEqual } = require('./security');
const { isIpAllowed, parseAllowedIps } = require('./ipService');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

const CLIENTS_FALLBACK_FILE = path.join(__dirname, '..', 'data', 'api_clients.json');

function getFallbackClients() {
  try {
    if (fs.existsSync(CLIENTS_FALLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(CLIENTS_FALLBACK_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveFallbackClients(clients) {
  try {
    const dir = path.dirname(CLIENTS_FALLBACK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CLIENTS_FALLBACK_FILE, JSON.stringify(clients, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Create a new API Client / Application for a User
 */
async function createApiClient(userId, { clientName, allowedIps = [] }) {
  if (!userId || !clientName) {
    throw new Error('User ID and Client Name are required.');
  }

  const rawToken = generateApiToken('tok_');
  const tokenHash = hashSha256(rawToken);
  const tokenPreview = rawToken.length > 12 ? `${rawToken.slice(0, 7)}...${rawToken.slice(-4)}` : rawToken;
  const clientId = 'CLI_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const parsedIps = parseAllowedIps(allowedIps);

  if (db.isConnected) {
    const res = await db.query(
      `INSERT INTO api_clients (id, user_id, client_name, api_token_hash, api_token_preview, allowed_ips, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active', NOW(), NOW())
       RETURNING id, user_id, client_name, api_token_preview, allowed_ips, status, created_at`,
      [clientId, userId, String(clientName).trim(), tokenHash, tokenPreview, parsedIps]
    );

    return {
      ...res.rows[0],
      rawToken // Only returned once upon creation
    };
  } else {
    const clients = getFallbackClients();
    const newClient = {
      id: clientId,
      user_id: userId,
      client_name: String(clientName).trim(),
      api_token_hash: tokenHash,
      api_token_preview: tokenPreview,
      allowed_ips: parsedIps,
      status: 'Active',
      created_at: new Date().toISOString()
    };
    clients.push(newClient);
    saveFallbackClients(clients);

    return {
      ...newClient,
      rawToken
    };
  }
}

/**
 * Get all API Clients for a User
 */
async function getApiClients(userId) {
  if (!userId) return [];

  if (db.isConnected) {
    const res = await db.query(
      `SELECT id, user_id, client_name, api_token_preview, allowed_ips, status, last_used_at, last_used_ip, created_at, updated_at 
       FROM api_clients 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows;
  } else {
    const clients = getFallbackClients();
    return clients.filter(c => c.user_id === userId);
  }
}

/**
 * Update API Client (Name, Allowed IPs, Status)
 */
async function updateApiClient(clientId, userId, { clientName, allowedIps, status }) {
  const parsedIps = allowedIps !== undefined ? parseAllowedIps(allowedIps) : undefined;

  if (db.isConnected) {
    const fields = [];
    const values = [clientId, userId];
    let idx = 3;

    if (clientName) {
      fields.push(`client_name = $${idx++}`);
      values.push(String(clientName).trim());
    }
    if (parsedIps !== undefined) {
      fields.push(`allowed_ips = $${idx++}`);
      values.push(parsedIps);
    }
    if (status) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (fields.length === 0) throw new Error('No fields provided to update.');
    fields.push(`updated_at = NOW()`);

    const res = await db.query(
      `UPDATE api_clients 
       SET ${fields.join(', ')} 
       WHERE id = $1 AND user_id = $2 
       RETURNING id, user_id, client_name, api_token_preview, allowed_ips, status, updated_at`,
      values
    );

    if (res.rowCount === 0) throw new Error('API Client not found or unauthorized.');
    return res.rows[0];
  } else {
    const clients = getFallbackClients();
    const index = clients.findIndex(c => c.id === clientId && c.user_id === userId);
    if (index === -1) throw new Error('API Client not found.');

    if (clientName) clients[index].client_name = String(clientName).trim();
    if (parsedIps !== undefined) clients[index].allowed_ips = parsedIps;
    if (status) clients[index].status = status;
    clients[index].updated_at = new Date().toISOString();

    saveFallbackClients(clients);
    return clients[index];
  }
}

/**
 * Regenerate API Client Token
 */
async function regenerateApiClientToken(clientId, userId) {
  const rawToken = generateApiToken('tok_');
  const tokenHash = hashSha256(rawToken);
  const tokenPreview = rawToken.length > 12 ? `${rawToken.slice(0, 7)}...${rawToken.slice(-4)}` : rawToken;

  if (db.isConnected) {
    const res = await db.query(
      `UPDATE api_clients 
       SET api_token_hash = $1, api_token_preview = $2, updated_at = NOW() 
       WHERE id = $3 AND user_id = $4 
       RETURNING id, user_id, client_name, api_token_preview, allowed_ips, status, updated_at`,
      [tokenHash, tokenPreview, clientId, userId]
    );

    if (res.rowCount === 0) throw new Error('API Client not found or unauthorized.');
    return {
      ...res.rows[0],
      rawToken
    };
  } else {
    const clients = getFallbackClients();
    const index = clients.findIndex(c => c.id === clientId && c.user_id === userId);
    if (index === -1) throw new Error('API Client not found.');

    clients[index].api_token_hash = tokenHash;
    clients[index].api_token_preview = tokenPreview;
    clients[index].updated_at = new Date().toISOString();
    saveFallbackClients(clients);

    return {
      ...clients[index],
      rawToken
    };
  }
}

/**
 * Revoke / Delete API Client
 */
async function revokeApiClient(clientId, userId) {
  if (db.isConnected) {
    const res = await db.query(
      `UPDATE api_clients SET status = 'Revoked', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [clientId, userId]
    );
    if (res.rowCount === 0) throw new Error('API Client not found or unauthorized.');
    return true;
  } else {
    const clients = getFallbackClients();
    const index = clients.findIndex(c => c.id === clientId && c.user_id === userId);
    if (index === -1) throw new Error('API Client not found.');
    clients[index].status = 'Revoked';
    saveFallbackClients(clients);
    return true;
  }
}

/**
 * Thoroughly Authenticate an API Request (User + Client + Token + IP Whitelist)
 */
async function authenticateApiRequest(apiUserId, token, clientIp) {
  if (!apiUserId || !token) {
    return { authenticated: false, reason: 'Missing credentials' };
  }

  const cleanUserId = String(apiUserId).trim().replace(/\D/g, '').slice(-10);
  const cleanToken = String(token).trim();
  const tokenHash = hashSha256(cleanToken);

  if (db.isConnected) {
    // 1. First check if token matches an active API Client
    const clientRes = await db.query(
      `SELECT c.id as client_id, c.client_name, c.allowed_ips, c.status as client_status,
              u.id as user_id, u.name as user_name, u.mobile as user_mobile, u.status as user_status,
              u.remaining_hits, u.total_hits, u.used_hits
       FROM api_clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.api_token_hash = $1
         AND (u.mobile = $2 OR u.id = $3 OR $2 = '')`,
      [tokenHash, cleanUserId, apiUserId]
    );

    if (clientRes.rows.length > 0) {
      const row = clientRes.rows[0];

      // Check User Status
      if (row.user_status !== 'Active') {
        return { authenticated: false, reason: 'User account is inactive or blocked' };
      }

      // Check Client Status
      if (row.client_status !== 'Active') {
        return { authenticated: false, reason: 'API Client is revoked or suspended' };
      }

      // Check IP Whitelist
      if (!isIpAllowed(clientIp, row.allowed_ips)) {
        logger.warn('IP Whitelist rejected API request', {
          clientId: row.client_id,
          userId: row.user_id,
          clientIp,
          allowedIps: row.allowed_ips
        });
        return { authenticated: false, isIpBlocked: true, reason: `IP ${clientIp} not authorized for this API client` };
      }

      // Async update last_used_at and last_used_ip
      db.query(
        `UPDATE api_clients SET last_used_at = NOW(), last_used_ip = $1 WHERE id = $2`,
        [clientIp, row.client_id]
      ).catch(() => {});

      return {
        authenticated: true,
        user: {
          id: row.user_id,
          name: row.user_name,
          mobile: row.user_mobile,
          remainingHits: row.remaining_hits,
          totalHits: row.total_hits,
          usedHits: row.used_hits
        },
        client: {
          id: row.client_id,
          name: row.client_name
        }
      };
    }

    // 2. Legacy fallback for direct user.api_token match (Timing-Safe)
    const userRes = await db.query(
      `SELECT id, name, mobile, api_token, status, remaining_hits, total_hits, used_hits 
       FROM users 
       WHERE mobile = $1 OR id = $2`,
      [cleanUserId, apiUserId]
    );

    if (userRes.rows.length > 0) {
      const userRow = userRes.rows[0];
      if (timingSafeEqual(userRow.api_token, cleanToken)) {
        if (userRow.status !== 'Active') {
          return { authenticated: false, reason: 'User account is inactive or blocked' };
        }

        return {
          authenticated: true,
          user: {
            id: userRow.id,
            name: userRow.name,
            mobile: userRow.mobile,
            remainingHits: userRow.remaining_hits,
            totalHits: userRow.total_hits,
            usedHits: userRow.used_hits
          },
          client: {
            id: 'legacy_primary',
            name: 'Primary Key'
          }
        };
      }
    }

    return { authenticated: false, reason: 'Invalid credentials' };
  } else {
    // Local fallback store
    const { getUsers } = require('./userService');
    const users = getUsers();
    const clients = getFallbackClients();

    // Check API Clients store first
    const client = clients.find(c =>
      (c.user_id === apiUserId || c.user_id === cleanUserId) &&
      (c.api_token_hash === tokenHash || timingSafeEqual(c.api_token_hash || '', tokenHash))
    );

    if (client) {
      if (client.status !== 'Active') return { authenticated: false, reason: 'API Client is revoked or suspended' };
      if (!isIpAllowed(clientIp, client.allowed_ips)) {
        return { authenticated: false, isIpBlocked: true, reason: `IP ${clientIp} not authorized for this API client` };
      }
      const user = users.find(u => u.id === client.user_id || u.mobile.slice(-10) === cleanUserId);
      if (user) {
        if (user.status && user.status !== 'Active') return { authenticated: false, reason: 'Account not active' };
        return {
          authenticated: true,
          user: {
            id: user.id,
            name: user.name,
            mobile: user.mobile,
            remainingHits: user.remainingHits,
            totalHits: user.totalHits,
            usedHits: user.usedHits
          },
          client: { id: client.id, name: client.client_name }
        };
      }
    }

    // Direct User API Token match
    const user = users.find(u =>
      (u.mobile.slice(-10) === cleanUserId || u.id === apiUserId) &&
      (u.apiToken === cleanToken || timingSafeEqual(u.apiToken || '', cleanToken))
    );

    if (!user) return { authenticated: false, reason: 'Invalid credentials' };
    if (user.status && user.status !== 'Active') return { authenticated: false, reason: 'Account not active' };

    return {
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        mobile: user.mobile,
        remainingHits: user.remainingHits,
        totalHits: user.totalHits,
        usedHits: user.usedHits
      },
      client: { id: 'local_default', name: 'Local Default' }
    };
  }
}

module.exports = {
  createApiClient,
  getApiClients,
  updateApiClient,
  regenerateApiClientToken,
  revokeApiClient,
  authenticateApiRequest
};
