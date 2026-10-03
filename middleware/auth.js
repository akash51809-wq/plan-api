const { verifySessionToken } = require('../services/security');
const { verifyAdminSession } = require('../services/adminService');
const { findUser } = require('../services/userService');
const crypto = require('crypto');
const logger = require('../services/logger');

/**
 * Middleware: Attach unique Request ID & Response Latency Logger
 */
function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || ('req_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12));
  res.setHeader('X-Request-ID', req.id);

  const startHrTime = process.hrtime();

  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const elapsedMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6).toFixed(2);

    if (req.path !== '/favicon.ico') {
      logger.info(`${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${elapsedMs}ms)`, {
        requestId: req.id,
        status: res.statusCode,
        method: req.method,
        path: req.path
      });
    }
  });

  next();
}

/**
 * Middleware: Enforce Admin Authentication
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'];
  } else if (req.query?.admin_token) {
    token = req.query.admin_token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Admin authentication token required.' });
  }

  const session = verifyAdminSession(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired Admin session.' });
  }

  req.admin = session;
  next();
}

/**
 * Middleware: Authenticate User Session (for user dashboard operations)
 */
async function requireUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-user-token']) {
    token = req.headers['x-user-token'];
  } else if (req.query?.token) {
    token = req.query.token;
  }

  const userMobile = req.headers['x-user-mobile'] || 
                     req.query.userMobile || 
                     req.query.mobile || 
                     req.body?.userMobile || 
                     req.body?.mobile;

  if (token) {
    const payload = verifySessionToken(token);
    if (payload && payload.userId) {
      const user = await findUser(payload.userId);
      if (user) {
        req.user = user;
        return next();
      }
    }
  }

  if (userMobile) {
    const user = await findUser(userMobile);
    if (user) {
      req.user = user;
      return next();
    }
  }

  return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
}

module.exports = {
  requestIdMiddleware,
  requireAdmin,
  requireUser
};
