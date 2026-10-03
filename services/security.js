const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'planapi_secure_session_secret_key_' + (process.env.ADMIN_PASSWORD || 'default_seed_key');

/**
 * SHA-256 Hash of string
 */
function hashSha256(text) {
  return crypto.createHash('sha256').update(String(text).trim()).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(strA, strB) {
  if (typeof strA !== 'string' || typeof strB !== 'string') return false;
  const bufA = Buffer.from(strA, 'utf8');
  const bufB = Buffer.from(strB, 'utf8');
  if (bufA.length !== bufB.length) {
    // Timing attack defense for mismatched lengths
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash password with scrypt
 */
function hashPassword(password, providedSalt = null) {
  const salt = providedSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64);
  return {
    salt,
    hash: derivedKey.toString('hex')
  };
}

/**
 * Verify password against salt and hash
 */
function verifyPassword(password, salt, storedHash) {
  try {
    const derivedKey = crypto.scryptSync(String(password), salt, 64);
    return timingSafeEqual(derivedKey.toString('hex'), storedHash);
  } catch (e) {
    return false;
  }
}

/**
 * Generate cryptographically secure API Token
 */
function generateApiToken(prefix = 'tok_') {
  return prefix + crypto.randomBytes(16).toString('hex');
}

/**
 * Generate cryptographically secure numeric OTP (6 digits)
 */
function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Sign HMAC session token for Admin or User
 */
function signSessionToken(payload, expiresInMs = 24 * 60 * 60 * 1000) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Date.now() + expiresInMs;
  const fullPayload = { ...payload, exp, iat: Date.now() };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Verify HMAC session token
 */
function verifySessionToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [b64Header, b64Payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    if (!timingSafeEqual(signature, expectedSignature)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Redact sensitive fields from objects before logging
 */
function redactSecrets(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;

  const sensitiveKeys = [
    'password', 'pass', 'token', 'apitoken', 'api_token', 'api_password',
    'secret', 'otp', 'otp_hash', 'password_hash', 'salt', 'utr', 'utr_number',
    'authorization', 'cookie', 'set-cookie'
  ];

  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSecrets(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

module.exports = {
  hashSha256,
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  generateApiToken,
  generateSecureOtp,
  signSessionToken,
  verifySessionToken,
  redactSecrets
};
