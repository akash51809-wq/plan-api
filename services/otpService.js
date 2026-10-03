const db = require('./db');
const { generateSecureOtp, hashSha256, timingSafeEqual } = require('./security');
const logger = require('./logger');

// Local in-memory store for fallback: Map(mobile -> { otpHash, name, attempts, expiresAt, resendAvailableAt })
const localOtpStore = new Map();

/**
 * Generate and save a new secure OTP for a mobile number
 */
async function generateAndSaveOtp(mobile, name) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  if (!cleanMobile || cleanMobile.length !== 10) {
    throw new Error('Valid 10-digit mobile number is required.');
  }

  const now = Date.now();
  const rawOtp = generateSecureOtp();
  const otpHash = hashSha256(rawOtp);
  const expiresAt = new Date(now + 10 * 60 * 1000); // 10 mins
  const resendAvailableAt = new Date(now + 60 * 1000); // 60s cooldown

  if (db.isConnected) {
    // Check resend cooldown
    const existing = await db.query('SELECT resend_available_at FROM otp_codes WHERE mobile = $1', [cleanMobile]);
    if (existing.rows.length > 0) {
      const cooldownTime = new Date(existing.rows[0].resend_available_at).getTime();
      if (now < cooldownTime) {
        const waitSec = Math.ceil((cooldownTime - now) / 1000);
        throw new Error(`Please wait ${waitSec}s before requesting a new OTP.`);
      }
    }

    await db.query(
      `INSERT INTO otp_codes (mobile, otp_hash, attempts, user_name, expires_at, resend_available_at, created_at)
       VALUES ($1, $2, 0, $3, $4, $5, NOW())
       ON CONFLICT (mobile) DO UPDATE SET
         otp_hash = EXCLUDED.otp_hash,
         attempts = 0,
         user_name = EXCLUDED.user_name,
         expires_at = EXCLUDED.expires_at,
         resend_available_at = EXCLUDED.resend_available_at,
         created_at = NOW()`,
      [cleanMobile, otpHash, name || 'User', expiresAt, resendAvailableAt]
    );
  } else {
    const existing = localOtpStore.get(cleanMobile);
    if (existing && now < existing.resendAvailableAt) {
      const waitSec = Math.ceil((existing.resendAvailableAt - now) / 1000);
      throw new Error(`Please wait ${waitSec}s before requesting a new OTP.`);
    }

    localOtpStore.set(cleanMobile, {
      otpHash,
      name: name || 'User',
      attempts: 0,
      expiresAt: expiresAt.getTime(),
      resendAvailableAt: resendAvailableAt.getTime()
    });
  }

  logger.info('Generated secure OTP for mobile', { mobile: cleanMobile });
  return rawOtp;
}

/**
 * Verify OTP securely against hash with attempt tracking
 */
async function verifyOtp(mobile, rawOtp) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  const cleanOtp = String(rawOtp).trim();

  if (!cleanMobile || !cleanOtp || cleanOtp.length !== 6) {
    return { valid: false, message: 'Valid 6-digit OTP is required.' };
  }

  const now = Date.now();
  const inputHash = hashSha256(cleanOtp);

  if (db.isConnected) {
    const res = await db.query('SELECT * FROM otp_codes WHERE mobile = $1', [cleanMobile]);
    if (res.rows.length === 0) {
      return { valid: false, message: 'OTP not requested or expired. Please request a new OTP.' };
    }

    const record = res.rows[0];
    const expiryTime = new Date(record.expires_at).getTime();

    if (now > expiryTime) {
      await db.query('DELETE FROM otp_codes WHERE mobile = $1', [cleanMobile]);
      return { valid: false, message: 'OTP has expired. Please request a new OTP.' };
    }

    if (record.attempts >= 3) {
      await db.query('DELETE FROM otp_codes WHERE mobile = $1', [cleanMobile]);
      return { valid: false, message: 'Too many incorrect attempts. Please request a new OTP.' };
    }

    const isMatch = timingSafeEqual(record.otp_hash, inputHash);
    if (!isMatch) {
      await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE mobile = $1', [cleanMobile]);
      const remainingAttempts = 2 - record.attempts;
      return {
        valid: false,
        message: remainingAttempts > 0 
          ? `Invalid OTP. ${remainingAttempts} attempts remaining.`
          : 'Invalid OTP. Maximum attempts reached. Please request a new OTP.'
      };
    }

    // Success: delete used OTP
    await db.query('DELETE FROM otp_codes WHERE mobile = $1', [cleanMobile]);
    return { valid: true, name: record.user_name };
  } else {
    const record = localOtpStore.get(cleanMobile);
    if (!record) {
      return { valid: false, message: 'OTP not requested or expired. Please request a new OTP.' };
    }

    if (now > record.expiresAt) {
      localOtpStore.delete(cleanMobile);
      return { valid: false, message: 'OTP has expired. Please request a new OTP.' };
    }

    if (record.attempts >= 3) {
      localOtpStore.delete(cleanMobile);
      return { valid: false, message: 'Too many incorrect attempts. Please request a new OTP.' };
    }

    const isMatch = timingSafeEqual(record.otpHash, inputHash);
    if (!isMatch) {
      record.attempts += 1;
      const remaining = 3 - record.attempts;
      if (remaining <= 0) localOtpStore.delete(cleanMobile);
      return {
        valid: false,
        message: remaining > 0 ? `Invalid OTP. ${remaining} attempts remaining.` : 'Invalid OTP. Max attempts reached.'
      };
    }

    localOtpStore.delete(cleanMobile);
    return { valid: true, name: record.name };
  }
}

module.exports = {
  generateAndSaveOtp,
  verifyOtp
};
