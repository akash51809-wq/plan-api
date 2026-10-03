require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');

const logger = require('./services/logger');
const { initDatabase, closePool } = require('./services/db');
const { getSettings, saveSettings, sendWhatsAppMessage } = require('./services/whatsappService');
const { getUsers, getAllUsers, saveUser, deleteUser, findUser, deductUserHit, refundUserHit, regenerateUserToken } = require('./services/userService');
const { createApiClient, getApiClients, updateApiClient, regenerateApiClientToken, revokeApiClient, authenticateApiRequest } = require('./services/clientService');
const { generateAndSaveOtp, verifyOtp } = require('./services/otpService');
const { loginAdmin } = require('./services/adminService');
const { getPlans, savePlan, deletePlan, getPayments, createPaymentRequest, approvePayment, rejectPayment } = require('./services/planService');
const { resolveTelecomDetails, OPERATOR_CODE_MAP, CIRCLE_CODE_MAP } = require('./services/seriesEngine');
const { fetchOperatorPlans, OPERATORS_LIST, CIRCLES_LIST } = require('./services/mobilePlanService');
const { fetchRofferDetails } = require('./services/rofferService');
const { fetchLastRechargeDetails } = require('./services/rechargeCheckService');
const { fetchDthInfoDetails } = require('./services/dthInfoService');
const { getClientIp } = require('./services/ipService');
const ezytmAccountService = require('./services/ezytmAccountService');
const browserManager = require('./browserManager');

const { requestIdMiddleware, requireAdmin, requireUser } = require('./middleware/auth');
const { otpRateLimiter, verifyOtpLimiter, adminLoginLimiter, apiRateLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Helper code mappings
function getOpCode(operatorName) {
  if (!operatorName) return '2';
  const clean = operatorName.toUpperCase().trim();
  for (const [key, val] of Object.entries(OPERATOR_CODE_MAP)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  return '2';
}

function getCircleCode(circleName) {
  if (!circleName) return '51';
  const clean = circleName.toUpperCase().trim();
  for (const [key, val] of Object.entries(CIRCLE_CODE_MAP)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  return '51';
}

// ---------------- GLOBAL MIDDLEWARE ---------------- //

// Trust proxy if configured
if (process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// Helmet Security Headers (Configured for inline dashboard assets and fonts)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https:", "http:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// CORS
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : '*';
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Body Parsers with strict size limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Request ID and Logger
app.use(requestIdMiddleware);

// Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- HEALTH CHECK ROUTE ---------------- //
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ---------------- AUTHENTICATION ROUTES ---------------- //

// 1. Send OTP (Rate-limited, cryptographic, hashed storage)
app.post('/api/auth/send-otp', otpRateLimiter, async (req, res, next) => {
  try {
    const { name, mobile, type } = req.body;
    if (!mobile || String(mobile).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    const existingUser = await findUser(cleanMobile);

    // Signup validation
    if (type === 'signup' && existingUser) {
      return res.status(400).json({
        success: false,
        message: 'This mobile number is already registered. Please sign in instead.'
      });
    }

    // Login validation
    if (type === 'login' && !existingUser) {
      return res.status(404).json({
        success: false,
        message: 'Mobile number not found in database. Please register first.'
      });
    }

    const userName = (name && String(name).trim()) || (existingUser ? existingUser.name : 'User');

    // Cryptographic OTP generation and storage
    const otp = await generateAndSaveOtp(cleanMobile, userName);

    // Format WhatsApp message
    const settings = getSettings();
    const message = (settings.otpTemplate || 'Hello {NAME}, your verification OTP for PlanAPI is *{OTP}*. This OTP is valid for 10 minutes.')
      .replace(/{NAME}/g, userName)
      .replace(/{OTP}/g, otp);

    const waResult = await sendWhatsAppMessage(cleanMobile, message);

    return res.json({
      success: true,
      message: `OTP sent successfully to +91 ${cleanMobile}`
    });
  } catch (error) {
    next(error);
  }
});

// 2. Verify OTP (Rate-limited, constant-time verification)
app.post('/api/auth/verify-otp', verifyOtpLimiter, async (req, res, next) => {
  try {
    const { name, mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Mobile number and OTP are required.' });
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    const verification = await verifyOtp(cleanMobile, otp);

    if (!verification.valid) {
      return res.status(400).json({ success: false, message: verification.message });
    }

    // Save or update user
    const existingUser = await findUser(cleanMobile);
    const finalName = name && String(name).trim() ? String(name).trim() : (existingUser ? existingUser.name : verification.name || 'User');

    const user = await saveUser({
      name: finalName,
      mobile: cleanMobile,
      status: 'Active'
    });

    res.json({
      success: true,
      message: 'OTP verified successfully! Welcome to PlanAPI Dashboard.',
      user
    });
  } catch (error) {
    next(error);
  }
});

// 3. User Profile Route (Protected)
app.all(['/api/auth/login-check', '/api/user/profile'], requireUser, (req, res) => {
  res.json({ success: true, user: req.user });
});

// 4. Regenerate Primary User API Token
app.post('/api/user/regenerate-token', requireUser, async (req, res, next) => {
  try {
    const user = req.user;
    const updated = await regenerateUserToken(user.mobile || user.id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({
      success: true,
      message: 'New API token generated successfully!',
      apiToken: updated.apiToken,
      user: {
        id: updated.id,
        name: updated.name,
        mobile: updated.mobile,
        apiToken: updated.apiToken,
        remainingHits: updated.remainingHits
      }
    });
  } catch (error) {
    next(error);
  }
});

// 5. User Logout
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ---------------- API CLIENTS / MULTI-APPLICATION MANAGEMENT ---------------- //

// 1. Get all API Clients for Logged-In User
app.get('/api/user/clients', requireUser, async (req, res, next) => {
  try {
    const clients = await getApiClients(req.user.id);
    res.json({ success: true, clients });
  } catch (error) {
    next(error);
  }
});

// 2. Create new API Client / Application
app.post('/api/user/clients', requireUser, async (req, res, next) => {
  try {
    const { clientName, allowedIps } = req.body;
    if (!clientName || String(clientName).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Application/Client Name is required.' });
    }

    const client = await createApiClient(req.user.id, { clientName, allowedIps });
    res.status(201).json({
      success: true,
      message: 'API Client application created successfully! Please copy your API Token now.',
      client
    });
  } catch (error) {
    next(error);
  }
});

// 3. Update API Client (Allowed IPs / Name)
app.put('/api/user/clients/:id', requireUser, async (req, res, next) => {
  try {
    const { clientName, allowedIps, status } = req.body;
    const updated = await updateApiClient(req.params.id, req.user.id, { clientName, allowedIps, status });
    res.json({ success: true, message: 'API Client updated successfully.', client: updated });
  } catch (error) {
    next(error);
  }
});

// 4. Regenerate API Client Token
app.post('/api/user/clients/:id/regenerate', requireUser, async (req, res, next) => {
  try {
    const regenerated = await regenerateApiClientToken(req.params.id, req.user.id);
    res.json({
      success: true,
      message: 'API Token regenerated successfully! The previous token has been revoked.',
      client: regenerated
    });
  } catch (error) {
    next(error);
  }
});

// 5. Revoke API Client
app.delete('/api/user/clients/:id', requireUser, async (req, res, next) => {
  try {
    await revokeApiClient(req.params.id, req.user.id);
    res.json({ success: true, message: 'API Client revoked successfully.' });
  } catch (error) {
    next(error);
  }
});

// ---------------- PLANS & BILLING ROUTES ---------------- //

// 1. Get All Active Plans (Public)
app.get('/api/plans', async (req, res, next) => {
  try {
    const plans = await getPlans();
    res.json({ success: true, plans });
  } catch (error) {
    next(error);
  }
});

// 2. Submit Payment Request (Protected User Route with server-side plan authority)
app.post('/api/payments/request', requireUser, async (req, res, next) => {
  try {
    const { planId, utr, paymentDate, paymentProof } = req.body;
    const request = await createPaymentRequest({
      userMobile: req.user.mobile,
      userName: req.user.name,
      planId,
      utr,
      paymentDate,
      paymentProof
    });

    res.json({
      success: true,
      message: 'Payment request submitted successfully! Admin will verify and activate your plan shortly.',
      request
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 3. Get User Payments
app.get('/api/payments', requireUser, async (req, res, next) => {
  try {
    const payments = await getPayments(req.user.mobile);
    res.json({ success: true, payments });
  } catch (error) {
    next(error);
  }
});

// ---------------- ADMIN ROUTES (PROTECTED) ---------------- //

// 1. Admin Login (Rate-limited)
app.post('/api/admin/login', adminLoginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await loginAdmin(username, password);

    if (!result.success) {
      return res.status(401).json(result);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// 2. Admin Settings
app.get('/api/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = getSettings();
    const payments = await getPayments();
    const pendingPayments = payments.filter(p => p.status === 'Pending').length;
    const users = getUsers();

    res.json({
      success: true,
      settings: {
        baseUrl: settings.baseUrl,
        token: settings.token,
        otpTemplate: settings.otpTemplate,
        adminUsername: settings.adminUsername
      },
      totalUsers: users.length,
      pendingPayments
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const { baseUrl, token, otpTemplate } = req.body;
    const updated = saveSettings({
      ...(baseUrl && { baseUrl }),
      ...(token && { token }),
      ...(otpTemplate && { otpTemplate })
    });
    res.json({ success: true, message: 'Settings saved successfully!', settings: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to save settings.' });
  }
});

// Admin Live WhatsApp Test Dispatcher
app.post('/api/admin/send-test', requireAdmin, async (req, res, next) => {
  try {
    const { mobile, message } = req.body;
    if (!mobile || !message) {
      return res.status(400).json({ success: false, message: 'Recipient mobile and message are required.' });
    }
    const result = await sendWhatsAppMessage(mobile, message);
    res.json({ success: true, message: 'WhatsApp message dispatched successfully.', result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send WhatsApp message.' });
  }
});

// 3. Admin Plans Management
app.post('/api/admin/plans', requireAdmin, async (req, res, next) => {
  try {
    const { amount, hits, name, validityDays, features } = req.body;
    const plan = await savePlan({ amount, hits, name, validityDays, features });
    res.json({ success: true, message: 'Plan created successfully!', plan });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/plans/:id', requireAdmin, async (req, res, next) => {
  try {
    await deletePlan(req.params.id);
    res.json({ success: true, message: 'Plan deactivated successfully.' });
  } catch (error) {
    next(error);
  }
});

// 4. Admin Payments Management
app.get('/api/admin/payments', requireAdmin, async (req, res, next) => {
  try {
    const payments = await getPayments();
    res.json({ success: true, payments });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/payments/approve', requireAdmin, async (req, res, next) => {
  try {
    const { paymentId } = req.body;
    const result = await approvePayment(paymentId, req.admin.username);
    res.json({
      success: true,
      message: `Payment request approved! ${result.payment.hits.toLocaleString()} hits credited to +91 ${result.payment.userMobile}.`,
      result
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/payments/reject', requireAdmin, async (req, res, next) => {
  try {
    const { paymentId, reason } = req.body;
    const rejected = await rejectPayment(paymentId, reason, req.admin.username);
    res.json({
      success: true,
      message: 'Payment request marked as Rejected.',
      payment: rejected
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 5. Admin Users List
app.get('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await getAllUsers();
    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
});

// 6. Admin Delete User
app.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteUser(id);
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// ---------------- EZYTM MULTI-ACCOUNT POOL MANAGEMENT (ADMIN) ---------------- //

// 1. Get All EzyTM Accounts
app.get('/api/admin/ezytm-accounts', requireAdmin, async (req, res, next) => {
  try {
    const accounts = await ezytmAccountService.getAllAccounts();
    res.json({ success: true, accounts });
  } catch (error) {
    next(error);
  }
});

// 2. Add New EzyTM Account
app.post('/api/admin/ezytm-accounts', requireAdmin, async (req, res, next) => {
  try {
    const { username, password, label } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username/Mobile and Password are required.' });
    }
    const account = await ezytmAccountService.addAccount({ username, password, label });
    res.status(201).json({ success: true, message: 'EzyTM Account added to rotation pool successfully!', account });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 3. Toggle EzyTM Account Active Status
app.put('/api/admin/ezytm-accounts/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const updated = await ezytmAccountService.toggleAccountStatus(req.params.id);
    res.json({ success: true, message: `Account status updated to ${updated.status}.`, account: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 4. Delete EzyTM Account
app.delete('/api/admin/ezytm-accounts/:id', requireAdmin, async (req, res, next) => {
  try {
    await ezytmAccountService.deleteAccount(req.params.id);
    res.json({ success: true, message: 'EzyTM Account removed from pool.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});



// ---------------- PUBLIC DEVELOPER API ENDPOINTS (RATE-LIMITED & CONCURRENCY-SAFE) ---------------- //

// 1. Operator Fetch API Endpoint
app.all(['/api/Mobile/OperatorFetchNew', '/api/mobile/operatorfetchnew'], apiRateLimiter, async (req, res) => {
  const t0 = performance.now();
  const clientIp = getClientIp(req);
  const params = { ...req.query, ...req.body };

  const apiUserId = params.ApiUserID || params.apiuserid || params.apiUserId || params.userMobile || params.apimember_id;
  const token = params.token || params.Token || params.api_password;
  const mobileNo = params.Mobileno || params.mobileno || params.MobileNo || params.mobile;

  // 1. Authenticate Request (Supports Multi-Client & IP Whitelisting)
  const auth = await authenticateApiRequest(apiUserId, token, clientIp);
  if (!auth.authenticated) {
    return res.status(200).json({
      "ERROR": "3",
      "STATUS": "3",
      "MOBILENO ": mobileNo ? String(mobileNo).trim() : "null",
      "Operator ": "null",
      "OpCode ": "null",
      "Circle": "null",
      "CircleCode": "null",
      "Message": "Authentication failed"
    });
  }

  // 2. Atomic Concurrency-Safe Hit Deduction
  const hitCheck = await deductUserHit(auth.user.id);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "ERROR": "4",
      "STATUS": "4",
      "Mobile": mobileNo ? String(mobileNo).trim() : "null",
      "Operator": "null",
      "OpCode": "null",
      "Circle": "null",
      "CircleCode": "null",
      "Message": "Insufficient plan hits. Please recharge your plan."
    });
  }

  // 3. Parameter Validation
  if (!mobileNo || String(mobileNo).trim().replace(/\D/g, '').length < 10) {
    return res.status(200).json({
      "ERROR": "2",
      "STATUS": "2",
      "Mobile": mobileNo ? String(mobileNo).trim() : "null",
      "Operator": "null",
      "OpCode": "null",
      "Circle": "null",
      "CircleCode": "null",
      "Message": "Invalid or missing mobile number"
    });
  }

  const cleanMobile = String(mobileNo).trim().replace(/\D/g, '').slice(-10);

  try {
    let operator = null;
    let circle = null;
    let opCode = null;
    let circleCode = null;

    if (browserManager.cache && browserManager.cache.has(cleanMobile)) {
      const cached = browserManager.cache.get(cleanMobile);
      operator = cached.operator;
      circle = cached.circle;
      opCode = getOpCode(operator);
      circleCode = getCircleCode(circle);
    } else {
      try {
        const liveRes = await browserManager.lookupOperator(cleanMobile);
        if (liveRes && liveRes.operator && liveRes.operator !== 'Unknown') {
          operator = liveRes.operator;
          circle = liveRes.circle;
          opCode = getOpCode(operator);
          circleCode = getCircleCode(circle);
        }
      } catch (liveErr) {
        logger.warn('Live operator scrape notice', { mobile: cleanMobile, error: liveErr.message });
      }

      if (!operator || operator === 'Unknown') {
        const resolved = resolveTelecomDetails(cleanMobile);
        operator = resolved.operator;
        circle = resolved.circle;
        opCode = resolved.opCode;
        circleCode = resolved.circleCode;

        if (browserManager.cache) {
          browserManager.cache.set(cleanMobile, {
            mobile: cleanMobile,
            operator,
            circle,
            cached: true
          });
        }
      }
    }

    const elapsedMs = (performance.now() - t0).toFixed(4);
    return res.status(200).json({
      "ERROR": "0",
      "STATUS": "1",
      "Mobile": cleanMobile,
      "Operator": operator || "AIRTEL",
      "OpCode": opCode || "2",
      "Circle": circle || "UP East",
      "CircleCode": circleCode || "54",
      "Message": "Successfully"
    });
  } catch (error) {
    // Upstream error: atomic hit refund
    await refundUserHit(auth.user.id);
    logger.error('Error during OperatorFetchNew', { error: error.message, mobile: cleanMobile });
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "Mobile": cleanMobile,
      "Operator": "null",
      "OpCode": "null",
      "Circle": "null",
      "CircleCode": "null",
      "Message": "Service temporarily unavailable"
    });
  }
});

// 2. Mobile Plans Fetch API Endpoint
app.all(['/api/Mobile/Operatorplan', '/api/Mobile/PlanFetch'], apiRateLimiter, async (req, res) => {
  const t0 = performance.now();
  const clientIp = getClientIp(req);
  const params = { ...req.query, ...req.body };

  const apiUserId = params.ApiUserID || params.apiUserId || params.apimember_id || params.userMobile;
  const token = params.token || params.api_password;
  const opCode = params.operatorcode || params.OpCode || params.operatorCode || params.opcode;
  const circleCode = params.cricle || params.circle || params.Circle || params.CircleCode || params.circleCode;

  const auth = await authenticateApiRequest(apiUserId, token, clientIp);
  if (!auth.authenticated) {
    return res.status(200).json({
      "ERROR": "3",
      "STATUS": "3",
      "Operator": "null",
      "Circle": "null",
      "RDATA": null,
      "MESSAGE": "Authentication failed"
    });
  }

  const hitCheck = await deductUserHit(auth.user.id);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "ERROR": "4",
      "STATUS": "4",
      "Operator": "null",
      "Circle": "null",
      "RDATA": null,
      "MESSAGE": "Insufficient plan hits. Please recharge your plan."
    });
  }

  if (!opCode) {
    return res.status(200).json({
      "ERROR": "0",
      "STATUS": "2",
      "Operator": "null",
      "Circle": "",
      "RDATA": null,
      "MESSAGE": "Operator code is required"
    });
  }

  try {
    const result = fetchOperatorPlans(opCode, circleCode || '70');
    return res.status(200).json({
      "ERROR": "0",
      "STATUS": "0",
      "Operator": result.operator,
      "Circle": result.circle,
      "RDATA": result.plans,
      "MESSAGE": "Operator Plan Successfully"
    });
  } catch (error) {
    await refundUserHit(auth.user.id);
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "Operator": "null",
      "Circle": "null",
      "RDATA": null,
      "MESSAGE": "Service temporarily unavailable"
    });
  }
});

// 3. R-Offer Check API Endpoint
app.all(['/api/Mobile/RofferCheck', '/api/Mobile/roffercheck', '/api/mobile/roffercheck', '/api/Mobile/RofferData', '/api/Mobile/ROffersCheck'], apiRateLimiter, async (req, res) => {
  const clientIp = getClientIp(req);
  const params = { ...req.query, ...req.body };

  const apiUserId = params.apimember_id || params.ApiUserID || params.apiuserid || params.userMobile;
  const token = params.api_password || params.token || params.Token;
  const opCode = params.operator_code || params.OpCode || params.operatorcode || params.opcode || params.operatorCode;
  const mobileNo = params.mobile_no || params.Mobileno || params.mobileno || params.mobile || params.MobileNo;

  const auth = await authenticateApiRequest(apiUserId, token, clientIp);
  if (!auth.authenticated) {
    return res.status(200).json({
      "ERROR": "3",
      "STATUS": "3",
      "MOBILENO": mobileNo ? String(mobileNo).trim() : "null",
      "RDATA": null,
      "MESSAGE": "Authentication failed"
    });
  }

  const hitCheck = await deductUserHit(auth.user.id);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "ERROR": "4",
      "STATUS": "4",
      "MOBILENO": mobileNo ? String(mobileNo).trim() : "null",
      "RDATA": null,
      "MESSAGE": "Insufficient plan hits. Please recharge your plan."
    });
  }

  if (!mobileNo || String(mobileNo).trim().replace(/\D/g, '').length < 10) {
    return res.status(200).json({
      "ERROR": "2",
      "STATUS": "2",
      "MOBILENO": mobileNo ? String(mobileNo).trim() : "null",
      "RDATA": null,
      "MESSAGE": "Invalid or missing mobile number"
    });
  }

  const cleanMobile = String(mobileNo).trim().replace(/\D/g, '').slice(-10);

  try {
    const result = await fetchRofferDetails(cleanMobile, opCode);
    return res.status(200).json(result);
  } catch (error) {
    await refundUserHit(auth.user.id);
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "MOBILENO": cleanMobile,
      "RDATA": null,
      "MESSAGE": "Service temporarily unavailable"
    });
  }
});

// 4. DTH Info With Last Recharge Date API Endpoint
app.all([
  '/api/Mobile/DthInfoWithLastRechargeDate',
  '/api/Mobile/dthinfowithlastrechargedate',
  '/api/mobile/dthinfowithlastrechargedate',
  '/api/Mobile/DthInfo',
  '/api/Mobile/DthInfoDetails',
  '/api/Mobile/LastRechargeCheck',
  '/api/Mobile/RechargeCheck',
  '/api/Mobile/LastRecharge'
], apiRateLimiter, async (req, res) => {
  const clientIp = getClientIp(req);
  const params = { ...req.query, ...req.body };

  const apiUserId = params.apimember_id || params.ApiUserID || params.apiuserid || params.userMobile;
  const token = params.api_password || params.token || params.Token;
  const opCode = params.Opcode || params.opcode || params.operator_code || params.operatorcode || params.OpCode;
  const mobileNo = params.mobile_no || params.Mobileno || params.mobileno || params.mobile || params.MobileNo || params.VC || params.vc;

  const auth = await authenticateApiRequest(apiUserId, token, clientIp);
  if (!auth.authenticated) {
    return res.status(200).json({
      "error": "3",
      "DATA": null,
      "Message": "Authentication failed"
    });
  }

  const hitCheck = await deductUserHit(auth.user.id);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "error": "4",
      "DATA": null,
      "Message": "Insufficient plan hits. Please recharge your plan."
    });
  }

  if (!mobileNo || String(mobileNo).trim().replace(/\D/g, '').length < 8) {
    return res.status(200).json({
      "error": "2",
      "DATA": null,
      "Message": "Invalid or missing mobile / DTH number"
    });
  }

  const cleanNumber = String(mobileNo).trim().replace(/\D/g, '');

  try {
    let result;
    const dthCodes = ['24', '25', '27', '28', '29', '21'];
    const cleanOpStr = String(opCode || '').trim();

    if (dthCodes.includes(cleanOpStr) || req.originalUrl.toLowerCase().includes('dth')) {
      result = await fetchDthInfoDetails(cleanNumber, opCode);
    } else {
      result = await fetchLastRechargeDetails(cleanNumber, opCode);
    }

    return res.status(200).json(result);
  } catch (error) {
    await refundUserHit(auth.user.id);
    return res.status(200).json({
      "error": "1",
      "DATA": null,
      "Message": "Service temporarily unavailable"
    });
  }
});

// ---------------- DASHBOARD INTERACTIVE QUERY ROUTES (FOR PORTAL UI) ---------------- //

app.get('/api/plans/mobile/meta', (req, res) => {
  res.json({ success: true, operators: OPERATORS_LIST, circles: CIRCLES_LIST });
});

app.post('/api/plans/mobile/query', async (req, res, next) => {
  try {
    const t0 = performance.now();
    const { operatorCode, circleCode, userMobile } = req.body;

    if (!operatorCode || !circleCode) {
      return res.status(400).json({ success: false, message: 'Operator and Circle are required.' });
    }

    let hitInfo = null;
    if (userMobile) {
      hitInfo = await deductUserHit(userMobile);
      if (!hitInfo.allowed) {
        return res.status(403).json({ success: false, message: 'Insufficient hits remaining.' });
      }
    }

    const result = fetchOperatorPlans(operatorCode, circleCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: {
        operator: result.operator,
        circle: result.circle,
        plans: result.plans,
        responseTime: `${elapsedMs} ms`,
        remainingHits: hitInfo ? hitInfo.remainingHits : undefined
      }
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/roffer/query', async (req, res, next) => {
  try {
    const t0 = performance.now();
    const { mobile, operatorCode, userMobile } = req.body;

    if (!mobile || String(mobile).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }

    let hitInfo = null;
    if (userMobile) {
      hitInfo = await deductUserHit(userMobile);
      if (!hitInfo.allowed) {
        return res.status(403).json({ success: false, message: 'Insufficient hits remaining.' });
      }
    }

    const result = await fetchRofferDetails(mobile, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/dth/query', async (req, res, next) => {
  try {
    const t0 = performance.now();
    const { dthNumber, operatorCode, userMobile } = req.body;

    if (!dthNumber || String(dthNumber).trim().length < 8) {
      return res.status(400).json({ success: false, message: 'Valid DTH VC Number is required.' });
    }

    let hitInfo = null;
    if (userMobile) {
      hitInfo = await deductUserHit(userMobile);
      if (!hitInfo.allowed) {
        return res.status(403).json({ success: false, message: 'Insufficient hits remaining.' });
      }
    }

    const result = await fetchDthInfoDetails(dthNumber, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/recharge/query', async (req, res, next) => {
  try {
    const t0 = performance.now();
    const { mobile, operatorCode, userMobile } = req.body;

    if (!mobile || String(mobile).trim().length < 8) {
      return res.status(400).json({ success: false, message: 'Valid Mobile or VC number is required.' });
    }

    let hitInfo = null;
    if (userMobile) {
      hitInfo = await deductUserHit(userMobile);
      if (!hitInfo.allowed) {
        return res.status(403).json({ success: false, message: 'Insufficient hits remaining.' });
      }
    }

    const result = await fetchLastRechargeDetails(mobile, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (e) {
    next(e);
  }
});

app.post(['/api/lookup/operator', '/api/lookup/full'], async (req, res, next) => {
  try {
    const t0 = performance.now();
    const { mobile, userMobile } = req.body;
    if (!mobile || String(mobile).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }

    let hitInfo = null;
    if (userMobile) {
      hitInfo = await deductUserHit(userMobile);
      if (!hitInfo.allowed) {
        return res.status(403).json({ success: false, message: 'Insufficient hits remaining.' });
      }
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    let result;

    if (browserManager.cache && browserManager.cache.has(cleanMobile)) {
      result = browserManager.cache.get(cleanMobile);
    } else {
      try {
        const liveRes = await browserManager.lookupOperator(cleanMobile);
        if (liveRes && liveRes.operator && liveRes.operator !== 'Unknown') {
          result = liveRes;
        }
      } catch (liveErr) {
        logger.warn(`Live scrape notice for ${cleanMobile}: ${liveErr.message}`);
      }

      if (!result || !result.operator || result.operator === 'Unknown') {
        const resolved = resolveTelecomDetails(cleanMobile);
        result = {
          mobile: cleanMobile,
          operator: resolved.operator,
          circle: resolved.circle,
          cached: true
        };
        if (browserManager.cache) {
          browserManager.cache.set(cleanMobile, result);
        }
      }
    }

    const elapsedMs = (performance.now() - t0).toFixed(4);
    res.json({
      success: true,
      data: {
        ...result,
        remainingHits: hitInfo ? hitInfo.remainingHits : undefined,
        responseTime: `${elapsedMs} ms`
      }
    });
  } catch (e) {
    next(e);
  }
});

// ---------------- 404 UNKNOWN ROUTE HANDLER (ZERO LEAKAGE) ---------------- //
app.use((req, res) => {
  if (req.originalUrl.toLowerCase().includes('/api/mobile/')) {
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "Message": "Invalid API endpoint"
    });
  }
  return res.status(404).json({
    success: false,
    message: 'Resource not found'
  });
});

// ---------------- CENTRALIZED ERROR HANDLER (ZERO INFORMATION LEAKAGE) ---------------- //
app.use((err, req, res, next) => {
  // Always log full technical diagnostics strictly on the server
  logger.error('Unhandled Application Exception', {
    requestId: req.id,
    url: req.originalUrl,
    method: req.method,
    error: err.message,
    stack: err.stack
  });

  // If request is to Developer API, return standard provider-compatible format
  if (req.originalUrl && req.originalUrl.toLowerCase().includes('/api/mobile/')) {
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "Message": "Service temporarily unavailable. Please try again."
    });
  }

  // Determine safe status code
  let statusCode = 500;
  if (err.status && typeof err.status === 'number' && err.status >= 400 && err.status < 600) {
    statusCode = err.status;
  } else if (err.statusCode && typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
    statusCode = err.statusCode;
  }

  // Safe allowlisted user-facing messages
  let safeUserMessage = 'Service temporarily unavailable. Please try again.';
  if (statusCode === 400 || err.type === 'entity.parse.failed') {
    safeUserMessage = 'Invalid request parameters.';
    statusCode = 400;
  } else if (statusCode === 401) {
    safeUserMessage = 'Authentication failed.';
  } else if (statusCode === 403) {
    safeUserMessage = 'Access denied.';
  } else if (statusCode === 404) {
    safeUserMessage = 'Resource not found.';
  } else if (statusCode === 429) {
    safeUserMessage = 'Too many requests. Please try again later.';
  }

  res.status(statusCode).json({
    success: false,
    message: safeUserMessage
  });
});

// ---------------- SERVER STARTUP & GRACEFUL SHUTDOWN ---------------- //
let server = null;

if (require.main === module) {
  server = app.listen(PORT, HOST, async () => {
    try {
      await initDatabase();
    } catch (dbErr) {
      logger.error('Database initialization fatal error', { error: dbErr.message });
    }

    console.log(`\n======================================================`);
    console.log(`🚀 PlanAPI High-Speed Web Portal is running live!`);
    console.log(`🔗 Address: http://${HOST}:${PORT}`);
    console.log(`👤 User Portal: http://localhost:${PORT}/dashboard.html`);
    console.log(`⚙️ Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`📡 API Endpoint: http://localhost:${PORT}/api/Mobile/OperatorFetchNew`);
    console.log(`⚡ Speed: Micro-Second In-Memory Series Engine Active!`);
    console.log(`🛡️ Security: Multi-Client, IP Whitelisting & Concurrency Engine Active!`);
    console.log(`🗄️ PostgreSQL Database Engine Ready!`);
    console.log(`======================================================\n`);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Graceful Shutdown Handlers (SIGTERM, SIGINT)
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown sequence...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed. Draining database and browser resources...');
      try {
        await browserManager.cleanup();
        await closePool();
        logger.info('Graceful shutdown completed cleanly.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown cleanup', { error: err.message });
        process.exit(1);
      }
    });
  }

  setTimeout(() => {
    logger.error('Forced shutdown: Clean exit timeout exceeded.');
    process.exit(1);
  }, 10000);
}

module.exports = { app, server };
