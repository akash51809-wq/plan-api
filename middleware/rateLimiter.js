const rateLimit = require('express-rate-limit');
const { getClientIp } = require('../services/ipService');

/**
 * Key generator using getClientIp
 */
function customKeyGenerator(req) {
  return getClientIp(req);
}

/**
 * Rate Limiter for OTP Requests (Brute-Force & Flood Protection)
 */
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 OTP requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: customKeyGenerator,
  message: {
    success: false,
    message: 'Too many OTP requests from this IP. Please wait 15 minutes before trying again.'
  }
});

/**
 * Rate Limiter for OTP Verification
 */
const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // max 30 verification attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: customKeyGenerator,
  message: {
    success: false,
    message: 'Too many verification attempts from this IP. Please wait 15 minutes.'
  }
});

/**
 * Rate Limiter for Admin Login
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // max 10 failed logins per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: customKeyGenerator,
  message: {
    success: false,
    message: 'Too many login attempts. Admin portal is temporarily locked for 15 minutes.'
  }
});

/**
 * Rate Limiter for Public API Endpoints
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: customKeyGenerator,
  message: {
    ERROR: '5',
    STATUS: '5',
    Message: 'Rate limit exceeded. Please slow down your requests.'
  }
});

module.exports = {
  otpRateLimiter,
  verifyOtpLimiter,
  adminLoginLimiter,
  apiRateLimiter
};
