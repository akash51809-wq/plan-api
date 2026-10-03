require('dotenv').config();
const express = require('express');
const path = require('path');
const { getSettings, saveSettings, sendWhatsAppMessage } = require('./services/whatsappService');
const { getUsers, saveUser, findUserByMobile, validateApiUser, generateOTP, verifyOTP } = require('./services/userService');
const { resolveTelecomDetails, OPERATOR_CODE_MAP, CIRCLE_CODE_MAP } = require('./services/seriesEngine');
const { getPlans, savePlan, deletePlan, getPayments, createPaymentRequest, approvePayment, rejectPayment, deductUserHit } = require('./services/planService');
const { fetchOperatorPlans, OPERATORS_LIST, CIRCLES_LIST } = require('./services/mobilePlanService');
const { fetchRofferDetails, resolveRofferOperator } = require('./services/rofferService');
const { fetchLastRechargeDetails } = require('./services/rechargeCheckService');
const { fetchDthInfoDetails, resolveDthOpCode, DTH_OPERATOR_MAP } = require('./services/dthInfoService');
const browserManager = require('./browserManager');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- AUTH ROUTES ---------------- //

// 1. Send OTP for Signup / Login
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { name, mobile, type } = req.body;
    if (!mobile || String(mobile).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    const existingUser = findUserByMobile(cleanMobile);

    // Signup validation: Check if user already exists
    if (type === 'signup' && existingUser) {
      return res.status(400).json({
        success: false,
        message: 'This mobile number is already registered. Please sign in instead.'
      });
    }

    // Login validation: Check if user is registered
    if (type === 'login' && !existingUser) {
      return res.status(404).json({
        success: false,
        message: 'Mobile number not found in database. Please register first.'
      });
    }

    const userName = (name && String(name).trim()) || (existingUser ? existingUser.name : 'User');

    // Generate 6-digit OTP
    const otp = generateOTP(cleanMobile, userName);

    // Format WhatsApp message
    const settings = getSettings();
    const message = (settings.otpTemplate || 'Your OTP is {OTP}')
      .replace(/{NAME}/g, userName)
      .replace(/{OTP}/g, otp);

    // Send WhatsApp Message
    const waResult = await sendWhatsAppMessage(cleanMobile, message);

    if (waResult.success) {
      return res.json({
        success: true,
        message: `OTP sent successfully via WhatsApp to +91 ${cleanMobile}`
      });
    } else {
      return res.json({
        success: true,
        message: `OTP generated (${otp}), but WhatsApp dispatch returned a notice. Check WhatsApp settings.`,
        details: waResult
      });
    }
  } catch (error) {
    console.error('Error in send-otp:', error);
    res.status(500).json({ success: false, message: 'Internal server error while sending OTP.' });
  }
});

// 2. Verify OTP and Complete Signup / Login
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { name, mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Mobile and OTP are required.' });
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    const verification = verifyOTP(cleanMobile, otp);

    if (!verification.valid) {
      return res.status(400).json({ success: false, message: verification.message });
    }

    // Save or update user
    const existingUser = findUserByMobile(cleanMobile);
    const finalName = name && String(name).trim() ? String(name).trim() : (existingUser ? existingUser.name : verification.name || 'User');

    const user = saveUser({
      name: finalName,
      mobile: cleanMobile,
      status: 'Active',
      lastLogin: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'OTP verified successfully! Welcome to PlanAPI Dashboard.',
      user
    });
  } catch (error) {
    console.error('Error in verify-otp:', error);
    res.status(500).json({ success: false, message: 'Internal server error while verifying OTP.' });
  }
});

// 3. Simple Login Check / Profile Refresh
app.all(['/api/auth/login-check', '/api/user/profile'], (req, res) => {
  const mobile = req.query.mobile || req.body.mobile;
  if (!mobile) return res.status(400).json({ success: false, message: 'Mobile number is required.' });
  const user = findUserByMobile(mobile);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found. Please sign up first.' });
  }
  res.json({ success: true, user });
});

// ---------------- PLANS & BILLING ROUTES ---------------- //

// 1. Get All Plans (Public / User)
app.get('/api/plans', (req, res) => {
  const plans = getPlans();
  res.json({ success: true, plans });
});

// 2. Add New Plan (Admin)
app.post('/api/admin/plans', (req, res) => {
  try {
    const { amount, hits } = req.body;
    const plan = savePlan({ amount, hits });
    res.json({ success: true, message: 'Plan added successfully!', plan });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 3. Delete Plan (Admin)
app.delete('/api/admin/plans/:id', (req, res) => {
  try {
    deletePlan(req.params.id);
    res.json({ success: true, message: 'Plan deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Get Payment Requests (Admin or User specific)
app.get('/api/payments', (req, res) => {
  const { mobile } = req.query;
  const payments = getPayments();
  if (mobile) {
    const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
    const userPayments = payments.filter(p => p.userMobile === cleanMobile);
    return res.json({ success: true, payments: userPayments });
  }
  res.json({ success: true, payments });
});

// 5. Submit Payment Request (User)
app.post('/api/payments/request', (req, res) => {
  try {
    const { userMobile, userName, planId, amount, hits, utr, paymentDate } = req.body;
    const request = createPaymentRequest({ userMobile, userName, planId, amount, hits, utr, paymentDate });
    res.json({
      success: true,
      message: 'Payment request submitted successfully! Admin will verify and activate your plan shortly.',
      request
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 6. Approve Payment Request (Admin)
app.post('/api/admin/payments/approve', (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ success: false, message: 'Payment ID is required.' });

    const result = approvePayment(paymentId);
    res.json({
      success: true,
      message: `Payment request approved! ${result.payment.hits.toLocaleString()} hits credited to +91 ${result.payment.userMobile}.`,
      result
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 7. Reject Payment Request (Admin)
app.post('/api/admin/payments/reject', (req, res) => {
  try {
    const { paymentId, reason } = req.body;
    if (!paymentId) return res.status(400).json({ success: false, message: 'Payment ID is required.' });

    const rejected = rejectPayment(paymentId, reason);
    res.json({
      success: true,
      message: 'Payment request marked as Rejected.',
      payment: rejected
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ---------------- USER EXTERNAL API ENDPOINT (WITH HIT LIMIT DEDUCTION) ---------------- //
// Endpoint: /api/Mobile/OperatorFetchNew?ApiUserID={registered_mobile}&token={user_token}&Mobileno={target_mobile}

app.all(['/api/Mobile/OperatorFetchNew', '/api/mobile/operatorfetchnew'], async (req, res) => {
  const t0 = performance.now();
  const apiUserId = req.query.ApiUserID || req.query.apiuserid || req.query.apiUserId || req.query.ApiUserId || (req.body && (req.body.ApiUserID || req.body.apiuserid));
  const token = req.query.token || req.query.Token || (req.body && (req.body.token || req.body.Token));
  const mobileNo = req.query.Mobileno || req.query.mobileno || req.query.MobileNo || req.query.mobile || (req.body && (req.body.Mobileno || req.body.mobileno || req.body.mobile));

  // Authentication check
  const authenticatedUser = validateApiUser(apiUserId, token);

  if (!authenticatedUser) {
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

  // Hit Limit Check & Deduction
  const hitCheck = deductUserHit(authenticatedUser.mobile);
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

  // Mobile number validation
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
    // 1. Fast Memory Cache Check (<0.001 ms)
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
      // 2. Fetch LIVE directly from PlanAPI (https://planapi.in/OperatorLook.aspx)
      try {
        const liveRes = await browserManager.lookupOperator(cleanMobile);
        if (liveRes && liveRes.operator && liveRes.operator !== 'Unknown') {
          operator = liveRes.operator;
          circle = liveRes.circle;
          opCode = getOpCode(operator);
          circleCode = getCircleCode(circle);
        }
      } catch (liveErr) {
        console.warn(`[PlanAPI Live Scrape Notice for ${cleanMobile}]:`, liveErr.message);
      }

      // 3. Fallback to Series Engine only if PlanAPI live portal is unreachable
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
    console.log(`⚡ [API ${elapsedMs}ms | Hits Left: ${hitCheck.remainingHits}] ${cleanMobile} -> ${operator} (${circle})`);

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
    console.error('Error during API OperatorFetchNew:', error);
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "Mobile": cleanMobile,
      "Operator": "null",
      "OpCode": "null",
      "Circle": "null",
      "CircleCode": "null",
      "Message": "Operator lookup service temporarily busy"
    });
  }
});

// ---------------- MOBILE RECHARGE PLANS API ROUTES ---------------- //

// 1. Get Operators and Circles Metadata for Dropdowns
app.get('/api/plans/mobile/meta', (req, res) => {
  res.json({
    success: true,
    operators: OPERATORS_LIST,
    circles: CIRCLES_LIST
  });
});

// 2. User Dashboard Interactive Plan Query
app.post('/api/plans/mobile/query', (req, res) => {
  const t0 = performance.now();
  const { operatorCode, circleCode, userMobile } = req.body;

  if (!operatorCode || !circleCode) {
    return res.status(400).json({ success: false, message: 'Operator and Circle are required.' });
  }

  // Deduct 1 hit if user logged in
  let hitInfo = null;
  if (userMobile) {
    hitInfo = deductUserHit(userMobile);
    if (!hitInfo.allowed) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient hits remaining. Please recharge your plan from the Buy Plan page.'
      });
    }
  }

  const result = fetchOperatorPlans(operatorCode, circleCode);
  const elapsedMs = (performance.now() - t0).toFixed(4);

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
});

// 3. Official PlanAPI Plan Fetch Endpoint (GET / POST)
app.all(['/api/Mobile/Operatorplan', '/api/Mobile/PlanFetch'], (req, res) => {
  const t0 = performance.now();
  const params = { ...req.query, ...req.body };

  const apiUserId = params.ApiUserID || params.apiUserId || params.apimember_id || params.userMobile;
  const token = params.token || params.api_password;
  const opCode = params.operatorcode || params.OpCode || params.operatorCode || params.opcode;
  const circleCode = params.cricle || params.circle || params.Circle || params.CircleCode || params.circleCode;

  // Authentication check
  let authenticatedUser = null;
  if (apiUserId && token) {
    const cleanUserMobile = String(apiUserId).trim().replace(/\D/g, '').slice(-10);
    const user = findUserByMobile(cleanUserMobile);
    if (user && user.apiToken === String(token).trim()) {
      authenticatedUser = user;
    }
  }

  if (!authenticatedUser) {
    return res.status(200).json({
      "ERROR": "3",
      "STATUS": "3",
      "Operator": "null",
      "Circle": "null",
      "RDATA": null,
      "MESSAGE": "Authentication failed"
    });
  }

  // Hit Limit Check & Deduction
  const hitCheck = deductUserHit(authenticatedUser.mobile);
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
    const elapsedMs = (performance.now() - t0).toFixed(4);
    console.log(`⚡ [PlanFetch API ${elapsedMs}ms | Hits Left: ${hitCheck.remainingHits}] ${result.operator} - ${result.circle}`);

    return res.status(200).json({
      "ERROR": "0",
      "STATUS": "0",
      "Operator": result.operator,
      "Circle": result.circle,
      "RDATA": result.plans,
      "MESSAGE": "Operator Plan Successfully"
    });
  } catch (error) {
    console.error('Error in Operatorplan API:', error);
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

// ---------------- R-OFFER CHECK API ROUTES ---------------- //

// 1. Dashboard Interactive R-Offer Query
app.post('/api/roffer/query', async (req, res) => {
  const t0 = performance.now();
  const { mobile, operatorCode, userMobile } = req.body;

  if (!mobile || String(mobile).trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
  }

  // Deduct 1 hit if user logged in
  let hitInfo = null;
  if (userMobile) {
    hitInfo = deductUserHit(userMobile);
    if (!hitInfo.allowed) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient hits remaining. Please recharge your plan from the Buy Plan page.'
      });
    }
  }

  try {
    const result = await fetchRofferDetails(mobile, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (error) {
    console.error('Error during roffer query:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch R-Offers.' });
  }
});

// 2. Official PlanAPI R-Offer Check Endpoint (GET / POST)
// Endpoint: https://planapi.in/api/Mobile/RofferCheck?apimember_id=5411&api_password=123456&operator_code=[OpCode]&mobile_no=12XXXXXXX0
app.all(['/api/Mobile/RofferCheck', '/api/Mobile/roffercheck', '/api/mobile/roffercheck', '/api/Mobile/RofferData', '/api/Mobile/ROffersCheck'], async (req, res) => {
  const t0 = performance.now();
  const params = { ...req.query, ...req.body };

  const apiUserId = params.apimember_id || params.ApiUserID || params.apiuserid || params.userMobile;
  const token = params.api_password || params.token || params.Token;
  const opCode = params.operator_code || params.OpCode || params.operatorcode || params.opcode || params.operatorCode;
  const mobileNo = params.mobile_no || params.Mobileno || params.mobileno || params.mobile || params.MobileNo;

  // Authentication check
  let authenticatedUser = null;
  if (apiUserId && token) {
    const cleanUserMobile = String(apiUserId).trim().replace(/\D/g, '').slice(-10);
    const user = findUserByMobile(cleanUserMobile);
    if (user && (user.apiToken === String(token).trim() || user.mobile === cleanUserMobile)) {
      authenticatedUser = user;
    }
  }

  if (!authenticatedUser) {
    return res.status(200).json({
      "ERROR": "3",
      "STATUS": "3",
      "MOBILENO": mobileNo ? String(mobileNo).trim() : "null",
      "RDATA": null,
      "MESSAGE": "Authentication failed"
    });
  }

  // Hit Limit Check & Deduction
  const hitCheck = deductUserHit(authenticatedUser.mobile);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "ERROR": "4",
      "STATUS": "4",
      "MOBILENO": mobileNo ? String(mobileNo).trim() : "null",
      "RDATA": null,
      "MESSAGE": "Insufficient plan hits. Please recharge your plan."
    });
  }

  // Mobile number validation
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
    const elapsedMs = (performance.now() - t0).toFixed(4);
    console.log(`🎁 [R-Offer API ${elapsedMs}ms | Hits Left: ${hitCheck.remainingHits}] ${cleanMobile} (OpCode: ${opCode || 'auto'}) -> ${result.RDATA ? result.RDATA.length : 0} offers`);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in RofferCheck API:', error);
    return res.status(200).json({
      "ERROR": "1",
      "STATUS": "0",
      "MOBILENO": cleanMobile,
      "RDATA": null,
      "MESSAGE": "Service temporarily unavailable"
    });
  }
});

// ---------------- DTH INFO & LAST RECHARGE CHECK API ROUTES ---------------- //

// 1. Dashboard Interactive DTH Info Query (Scraped live from https://planapi.in/DTHinfoDetails.aspx)
app.post('/api/dth/query', async (req, res) => {
  const t0 = performance.now();
  const { dthNumber, operatorCode, userMobile } = req.body;

  if (!dthNumber || String(dthNumber).trim().length < 8) {
    return res.status(400).json({ success: false, message: 'Valid DTH VC / Customer Number is required.' });
  }

  // Deduct 1 hit if user logged in
  let hitInfo = null;
  if (userMobile) {
    hitInfo = deductUserHit(userMobile);
    if (!hitInfo.allowed) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient hits remaining. Please recharge your plan from the Buy Plan page.'
      });
    }
  }

  try {
    const result = await fetchDthInfoDetails(dthNumber, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (error) {
    console.error('Error during DTH query:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch DTH information.' });
  }
});

// 2. Dashboard Interactive Recharge Check Query (Scraped live from https://planapi.in/RechargeCheck.aspx)
app.post('/api/recharge/query', async (req, res) => {
  const t0 = performance.now();
  const { mobile, operatorCode, userMobile } = req.body;

  if (!mobile || String(mobile).trim().length < 8) {
    return res.status(400).json({ success: false, message: 'Valid Mobile number or DTH VC number is required.' });
  }

  // Deduct 1 hit if user logged in
  let hitInfo = null;
  if (userMobile) {
    hitInfo = deductUserHit(userMobile);
    if (!hitInfo.allowed) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient hits remaining. Please recharge your plan from the Buy Plan page.'
      });
    }
  }

  try {
    const result = await fetchLastRechargeDetails(mobile, operatorCode);
    const elapsedMs = (performance.now() - t0).toFixed(2);

    res.json({
      success: true,
      data: result,
      responseTime: `${elapsedMs} ms`,
      remainingHits: hitInfo ? hitInfo.remainingHits : undefined
    });
  } catch (error) {
    console.error('Error during recharge query:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to check last recharge.' });
  }
});

// 3. Official PlanAPI DTH Info With Last Recharge Date Endpoint (GET / POST)
// Endpoint: https://planapi.in/api/Mobile/DthInfoWithLastRechargeDate?apimember_id=5411&api_password=123456&mobile_no=12XXXXXXX0&Opcode=[OpCode]
app.all([
  '/api/Mobile/DthInfoWithLastRechargeDate',
  '/api/Mobile/dthinfowithlastrechargedate',
  '/api/mobile/dthinfowithlastrechargedate',
  '/api/Mobile/DthInfo',
  '/api/Mobile/DthInfoDetails',
  '/api/Mobile/LastRechargeCheck',
  '/api/Mobile/RechargeCheck',
  '/api/Mobile/LastRecharge'
], async (req, res) => {
  const t0 = performance.now();
  const params = { ...req.query, ...req.body };

  const apiUserId = params.apimember_id || params.ApiUserID || params.apiuserid || params.userMobile;
  const token = params.api_password || params.token || params.Token;
  const opCode = params.Opcode || params.opcode || params.operator_code || params.operatorcode || params.OpCode;
  const mobileNo = params.mobile_no || params.Mobileno || params.mobileno || params.mobile || params.MobileNo || params.VC || params.vc;

  // Authentication check
  let authenticatedUser = null;
  if (apiUserId && token) {
    const cleanUserMobile = String(apiUserId).trim().replace(/\D/g, '').slice(-10);
    const user = findUserByMobile(cleanUserMobile);
    if (user && (user.apiToken === String(token).trim() || user.mobile === cleanUserMobile)) {
      authenticatedUser = user;
    }
  }

  if (!authenticatedUser) {
    return res.status(200).json({
      "error": "3",
      "DATA": null,
      "Message": "Authentication failed"
    });
  }

  // Hit Limit Check & Deduction
  const hitCheck = deductUserHit(authenticatedUser.mobile);
  if (!hitCheck.allowed) {
    return res.status(200).json({
      "error": "4",
      "DATA": null,
      "Message": "Insufficient plan hits. Please recharge your plan."
    });
  }

  // Number validation
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
    // If DTH operator code (24, 25, 27, 28, 29) or DTH in path, query DTHinfoDetails
    const dthCodes = ['24', '25', '27', '28', '29', '21'];
    const cleanOpStr = String(opCode || '').trim();

    if (dthCodes.includes(cleanOpStr) || req.originalUrl.toLowerCase().includes('dth')) {
      result = await fetchDthInfoDetails(cleanNumber, opCode);
    } else {
      result = await fetchLastRechargeDetails(cleanNumber, opCode);
    }

    const elapsedMs = (performance.now() - t0).toFixed(4);
    console.log(`📡 [DTH/Recharge API ${elapsedMs}ms | Hits Left: ${hitCheck.remainingHits}] ${cleanNumber} (OpCode: ${opCode || 'auto'}) -> Error: ${result.error}`);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in DthInfo API:', error);
    return res.status(200).json({
      "error": "1",
      "DATA": null,
      "Message": "Service temporarily unavailable"
    });
  }
});

// ---------------- ADMIN ROUTES ---------------- //

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const settings = getSettings();

  if (username === settings.adminUsername && password === settings.adminPassword) {
    return res.json({
      success: true,
      token: 'admin_authenticated_session_' + Date.now(),
      message: 'Admin login successful.'
    });
  }

  return res.status(401).json({ success: false, message: 'Invalid Admin username or password.' });
});

// Get WhatsApp Settings
app.get('/api/admin/settings', (req, res) => {
  const settings = getSettings();
  const payments = getPayments();
  const pendingPayments = payments.filter(p => p.status === 'Pending').length;

  res.json({
    success: true,
    settings: {
      baseUrl: settings.baseUrl,
      token: settings.token,
      otpTemplate: settings.otpTemplate,
      adminUsername: settings.adminUsername
    },
    totalUsers: getUsers().length,
    pendingPayments
  });
});

// Save WhatsApp Settings
app.post('/api/admin/settings', (req, res) => {
  try {
    const { baseUrl, token, otpTemplate } = req.body;
    const updated = saveSettings({
      ...(baseUrl && { baseUrl }),
      ...(token && { token }),
      ...(otpTemplate && { otpTemplate })
    });
    res.json({ success: true, message: 'WhatsApp Settings saved successfully!', settings: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to save settings.' });
  }
});

// Test WhatsApp Message Dispatch
app.post('/api/admin/send-test', async (req, res) => {
  try {
    const { mobile, message } = req.body;
    if (!mobile || !message) {
      return res.status(400).json({ success: false, message: 'Mobile number and message are required.' });
    }

    const result = await sendWhatsAppMessage(mobile, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get All Users (Admin)
app.get('/api/admin/users', (req, res) => {
  const users = getUsers();
  res.json({ success: true, users });
});

// ---------------- LIVE USER DASHBOARD OPERATOR LOOKUP ROUTE ---------------- //

app.post(['/api/lookup/operator', '/api/lookup/full'], async (req, res) => {
  const t0 = performance.now();
  const { mobile, userMobile } = req.body;
  if (!mobile || String(mobile).trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
  }

  // Deduct hit if userMobile provided
  let hitInfo = { remainingHits: 100 };
  if (userMobile) {
    const hitCheck = deductUserHit(userMobile);
    if (!hitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: 'Your hit balance is 0. Please purchase a plan to continue.'
      });
    }
    hitInfo = hitCheck;
  }

  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);

  try {
    let result;
    if (browserManager.cache && browserManager.cache.has(cleanMobile)) {
      result = browserManager.cache.get(cleanMobile);
    } else {
      // Fetch LIVE directly from PlanAPI (https://planapi.in/OperatorLook.aspx)
      try {
        const liveRes = await browserManager.lookupOperator(cleanMobile);
        if (liveRes && liveRes.operator && liveRes.operator !== 'Unknown') {
          result = liveRes;
        }
      } catch (liveErr) {
        console.warn(`[PlanAPI UI Live Scrape Notice for ${cleanMobile}]:`, liveErr.message);
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
        remainingHits: hitInfo.remainingHits,
        responseTime: `${elapsedMs} ms`
      } 
    });
  } catch (error) {
    console.error('Error during operator lookup:', error);
    res.status(500).json({ success: false, message: error.message || 'Operator lookup failed.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 PlanAPI Web Portal is running live!`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`👤 User Panel: http://localhost:${PORT}`);
  console.log(`⚙️ Admin Panel: http://localhost:${PORT}#admin`);
  console.log(`📡 API Endpoint: http://localhost:${PORT}/api/Mobile/OperatorFetchNew`);
  console.log(`⚡ Speed: Micro-Second In-Memory Series Engine Active!`);
  console.log(`💳 Plans & Hit Limits Engine Active!`);
  console.log(`======================================================\n`);
});

