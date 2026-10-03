const net = require('net');

/**
 * Extract client IP considering trusted proxy settings
 */
function getClientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

  if (trustProxy) {
    // Cloudflare priority
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return String(cfIp).trim();

    // Standard X-Forwarded-For (take client IP - first entry)
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const parts = String(xff).split(',');
      if (parts.length > 0) {
        return parts[0].trim();
      }
    }

    const xRealIp = req.headers['x-real-ip'];
    if (xRealIp) return String(xRealIp).trim();
  }

  // Direct socket / connection address
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  // Normalize IPv6 mapped IPv4 address (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (remote.startsWith('::ffff:')) {
    return remote.substring(7);
  }
  return remote;
}

/**
 * Convert IPv4 string to 32-bit integer
 */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Check if IP is in CIDR range or exact match
 */
function isIpAllowed(clientIp, allowedIps) {
  if (!allowedIps || !Array.isArray(allowedIps) || allowedIps.length === 0) {
    return true; // No restriction specified
  }

  const cleanClient = String(clientIp || '').trim().replace(/^::ffff:/, '');
  if (!cleanClient) return false;

  for (const allowed of allowedIps) {
    const cleanRule = String(allowed).trim();
    if (!cleanRule) continue;

    // Exact match
    if (cleanRule === cleanClient) {
      return true;
    }

    // CIDR match for IPv4
    if (cleanRule.includes('/')) {
      const [subnet, bitsStr] = cleanRule.split('/');
      const bits = parseInt(bitsStr, 10);

      if (net.isIPv4(cleanClient) && net.isIPv4(subnet) && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        const clientInt = ipv4ToInt(cleanClient);
        const subnetInt = ipv4ToInt(subnet);

        if ((clientInt & mask) === (subnetInt & mask)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Validate IP address list string or array
 */
function parseAllowedIps(input) {
  if (!input) return [];
  let list = [];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    list = input.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  }

  return list.filter(ip => {
    if (ip.includes('/')) {
      const [base, mask] = ip.split('/');
      return (net.isIP(base) !== 0) && !isNaN(parseInt(mask, 10));
    }
    return net.isIP(ip) !== 0;
  });
}

module.exports = {
  getClientIp,
  isIpAllowed,
  parseAllowedIps
};
