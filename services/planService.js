const fs = require('fs');
const path = require('path');
const db = require('./db');
const { findUser, saveUser } = require('./userService');
const logger = require('./logger');

const PLANS_FILE = path.join(__dirname, '..', 'data', 'plans.json');
const PAYMENTS_FILE = path.join(__dirname, '..', 'data', 'payments.json');

const inFlightApprovals = new Set();

const DEFAULT_PLANS = [
  { id: 'PLAN_100', name: 'Starter Plan', amount: 100, hits: 20000, validity_days: 30, features: ['20,000 API Hits', 'High Speed Routing', 'All Operators Included'], is_active: true },
  { id: 'PLAN_200', name: 'Pro Plan', amount: 200, hits: 50000, validity_days: 30, features: ['50,000 API Hits', 'Priority Microsecond Engine', 'DTH + R-Offer Support'], is_active: true },
  { id: 'PLAN_500', name: 'Business Plan', amount: 500, hits: 150000, validity_days: 30, features: ['150,000 API Hits', 'Unlimited Concurrency', 'Dedicated Fast Node'], is_active: true },
  { id: 'PLAN_1000', name: 'Enterprise Plan', amount: 1000, hits: 350000, validity_days: 30, features: ['350,000 API Hits', 'Dedicated Server IP', '24/7 SLA Support'], is_active: true }
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------- PLANS MANAGEMENT ---------------- //

async function getPlans(includeInactive = false) {
  if (db.isConnected) {
    const queryStr = includeInactive 
      ? 'SELECT id, name, amount, hits, validity_days as "validityDays", features, is_active as "isActive", created_at as "createdAt" FROM plans ORDER BY amount ASC'
      : 'SELECT id, name, amount, hits, validity_days as "validityDays", features, is_active as "isActive", created_at as "createdAt" FROM plans WHERE is_active = TRUE ORDER BY amount ASC';
    
    const res = await db.query(queryStr);
    return res.rows;
  } else {
    try {
      ensureDir(PLANS_FILE);
      if (!fs.existsSync(PLANS_FILE)) {
        fs.writeFileSync(PLANS_FILE, JSON.stringify(DEFAULT_PLANS, null, 2));
        return DEFAULT_PLANS;
      }
      const content = fs.readFileSync(PLANS_FILE, 'utf8');
      const plans = JSON.parse(content);
      return includeInactive ? plans : plans.filter(p => p.active !== false && p.is_active !== false);
    } catch (err) {
      return DEFAULT_PLANS;
    }
  }
}

async function getPlanById(planId) {
  if (!planId) return null;
  if (db.isConnected) {
    const res = await db.query(
      'SELECT id, name, amount, hits, validity_days as "validityDays", features, is_active as "isActive" FROM plans WHERE id = $1',
      [planId]
    );
    return res.rows[0] || null;
  } else {
    const plans = await getPlans(true);
    return plans.find(p => p.id === planId) || null;
  }
}

async function savePlan({ id, name, amount, hits, validityDays = 30, features = [] }) {
  const amt = Number(amount);
  const hts = Number(hits);

  if (!amt || !hts || amt <= 0 || hts <= 0) {
    throw new Error('Valid positive Amount and Hits are required.');
  }

  // Duplicate plan check: reject same amount + same hits
  if (db.isConnected) {
    const dupCheck = await db.query(
      'SELECT id, name, amount, hits FROM plans WHERE amount = $1 AND hits = $2 AND is_active = TRUE AND id != $3',
      [amt, hts, id || '']
    );
    if (dupCheck.rows.length > 0) {
      throw new Error(`A plan with amount ₹${amt} and ${hts.toLocaleString()} hits already exists. Duplicate plans are not allowed.`);
    }
  }

  const plans = await getPlans(true);
  const duplicate = plans.find(p => 
    p.is_active !== false && 
    (p.id !== id) && 
    Number(p.amount) === amt && 
    Number(p.hits) === hts
  );
  if (duplicate) {
    throw new Error(`A plan with amount ₹${amt} and ${hts.toLocaleString()} hits already exists. Duplicate plans are not allowed.`);
  }

  const planId = id || ('PLAN_' + amt + '_' + Date.now());
  const planName = name || `₹${amt} Plan`;

  const newPlan = {
    id: planId,
    name: planName,
    amount: amt,
    hits: hts,
    validityDays: Number(validityDays) || 30,
    features: Array.isArray(features) ? features : (typeof features === 'string' ? JSON.parse(features || '[]') : []),
    isActive: true,
    is_active: true,
    createdAt: new Date().toISOString()
  };

  const existingIndex = plans.findIndex(p => p.id === planId);
  if (existingIndex >= 0) {
    plans[existingIndex] = newPlan;
  } else {
    plans.push(newPlan);
  }
  plans.sort((a, b) => a.amount - b.amount);
  ensureDir(PLANS_FILE);
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));

  if (db.isConnected) {
    const res = await db.query(
      `INSERT INTO plans (id, name, amount, hits, validity_days, features, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         amount = EXCLUDED.amount,
         hits = EXCLUDED.hits,
         validity_days = EXCLUDED.validity_days,
         features = EXCLUDED.features,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING id, name, amount, hits, validity_days as "validityDays", features, is_active as "isActive"`,
      [planId, planName, amt, hts, Number(validityDays) || 30, JSON.stringify(newPlan.features)]
    );
    return res.rows[0];
  }

  return newPlan;
}

async function deletePlan(id) {
  if (db.isConnected) {
    // Soft delete / deactivate to preserve historical integrity
    const res = await db.query(
      'UPDATE plans SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    return res.rowCount > 0;
  } else {
    const plans = await getPlans(true);
    const filtered = plans.filter(p => p.id !== id);
    fs.writeFileSync(PLANS_FILE, JSON.stringify(filtered, null, 2));
    return true;
  }
}

// ---------------- PAYMENT REQUESTS & ATOMIC APPROVAL ---------------- //

async function getPayments(userMobile = null) {
  if (db.isConnected) {
    if (userMobile) {
      const cleanMobile = String(userMobile).trim().replace(/\D/g, '').slice(-10);
      const res = await db.query(
        `SELECT id, user_mobile as "userMobile", user_name as "userName", plan_id as "planId",
                plan_name as "planName", amount, hits, utr_number as "utr", payment_date as "paymentDate",
                screenshot, status, approved_by as "approvedBy", approved_at as "approvedAt",
                rejected_at as "rejectedAt", reject_reason as "rejectReason", created_at as "createdAt"
         FROM payments
         WHERE user_mobile = $1
         ORDER BY created_at DESC`,
        [cleanMobile]
      );
      return res.rows;
    } else {
      const res = await db.query(
        `SELECT id, user_mobile as "userMobile", user_name as "userName", plan_id as "planId",
                plan_name as "planName", amount, hits, utr_number as "utr", payment_date as "paymentDate",
                screenshot, status, approved_by as "approvedBy", approved_at as "approvedAt",
                rejected_at as "rejectedAt", reject_reason as "rejectReason", created_at as "createdAt"
         FROM payments
         ORDER BY created_at DESC`
      );
      return res.rows;
    }
  } else {
    try {
      ensureDir(PAYMENTS_FILE);
      if (!fs.existsSync(PAYMENTS_FILE)) return [];
      const payments = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'));
      if (userMobile) {
        const cleanMobile = String(userMobile).trim().replace(/\D/g, '').slice(-10);
        return payments.filter(p => p.userMobile === cleanMobile);
      }
      return payments;
    } catch (e) {
      return [];
    }
  }
}

/**
 * Create Payment Request (Guaranteed Server-Side Authority on Amount & Hits)
 */
async function createPaymentRequest({ userMobile, userName, planId, utr, paymentDate, paymentProof }) {
  const cleanMobile = String(userMobile).trim().replace(/\D/g, '').slice(-10);
  const cleanUtr = String(utr || '').trim().toUpperCase();

  if (!cleanMobile || cleanMobile.length !== 10) {
    throw new Error('Valid 10-digit User Mobile is required.');
  }
  if (!cleanUtr || cleanUtr.length < 4) {
    throw new Error('Valid UTR / Transaction Reference Number is required.');
  }

  // 1. Verify User exists
  const user = await findUser(cleanMobile);
  if (!user) {
    throw new Error('User not found. Please register your account first.');
  }

  // 2. Fetch server-side plan authority (Never trust client-supplied amount or hits)
  let verifiedPlan = null;
  if (planId) {
    verifiedPlan = await getPlanById(planId);
  }

  if (!verifiedPlan) {
    // Fallback: search plan by amount if known, else reject
    const allPlans = await getPlans();
    if (allPlans.length > 0) {
      verifiedPlan = allPlans[0];
    } else {
      throw new Error('Invalid or inactive plan selected.');
    }
  }

  const serverAmount = Number(verifiedPlan.amount);
  const serverHits = Number(verifiedPlan.hits);
  const serverPlanName = verifiedPlan.name || `₹${serverAmount} Plan`;
  const paymentId = 'REQ_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  // 3. Strict Global UTR Uniqueness Check (Never accept previously used UTR from any user)
  if (db.isConnected) {
    const existingUtr = await db.query(
      'SELECT id, user_mobile as "userMobile", status FROM payments WHERE UPPER(TRIM(utr_number)) = $1',
      [cleanUtr]
    );
    if (existingUtr.rows.length > 0) {
      throw new Error('This UTR number has already been used in the system. Duplicate UTR reference is not allowed.');
    }
  }

  const allPayments = await getPayments();
  const utrExists = allPayments.some(p => String(p.utr || '').trim().toUpperCase() === cleanUtr);
  if (utrExists) {
    throw new Error('This UTR number has already been used in the system. Duplicate UTR reference is not allowed.');
  }

  if (db.isConnected) {
    try {
      const res = await db.query(
        `INSERT INTO payments (id, user_mobile, user_name, plan_id, plan_name, amount, hits, utr_number, payment_date, screenshot, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending', NOW(), NOW())
         RETURNING id, user_mobile as "userMobile", user_name as "userName", plan_id as "planId", plan_name as "planName", amount, hits, utr_number as "utr", status, created_at as "createdAt"`,
        [
          paymentId,
          cleanMobile,
          userName || user.name || 'User',
          verifiedPlan.id,
          serverPlanName,
          serverAmount,
          serverHits,
          cleanUtr,
          paymentDate || new Date().toISOString().split('T')[0],
          paymentProof || ''
        ]
      );
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') { // Unique constraint violation (duplicate UTR)
        throw new Error('This UTR number has already been used in the system. Duplicate UTR reference is not allowed.');
      }
      throw err;
    }
  } else {
    const newPayment = {
      id: paymentId,
      userMobile: cleanMobile,
      userName: userName || user.name || 'User',
      planId: verifiedPlan.id,
      planName: serverPlanName,
      amount: serverAmount,
      hits: serverHits,
      utr: cleanUtr,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      screenshot: paymentProof || '',
      status: 'Pending',
      createdAt: new Date().toISOString()
    };
    allPayments.unshift(newPayment);
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(allPayments, null, 2));
    return newPayment;
  }
}

/**
 * Concurrency-Safe Atomic Payment Approval (Transaction with Row Lock)
 * Strictly prevents double-credit race condition.
 */
async function approvePayment(paymentId, adminUsername = 'Admin') {
  if (!paymentId) throw new Error('Payment ID is required.');

  if (db.isConnected) {
    return await db.transaction(async (client) => {
      // 1. Lock payment row with FOR UPDATE
      const payRes = await client.query(
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId]
      );

      if (payRes.rowCount === 0) {
        throw new Error('Payment request not found.');
      }

      const payment = payRes.rows[0];
      if (payment.status === 'Approved') {
        throw new Error('This payment request has already been approved.');
      }
      if (payment.status === 'Rejected') {
        throw new Error('Cannot approve a rejected payment request.');
      }

      const addHits = Number(payment.hits);

      // 2. Atomically update payment status
      await client.query(
        `UPDATE payments 
         SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW() 
         WHERE id = $2 AND status = 'Pending'`,
        [adminUsername, paymentId]
      );

      // 3. Atomically credit user hits
      const userRes = await client.query(
        `UPDATE users 
         SET remaining_hits = remaining_hits + $1, 
             total_hits = total_hits + $1, 
             updated_at = NOW() 
         WHERE mobile = $2 
         RETURNING id, mobile, remaining_hits as "remainingHits", total_hits as "totalHits"`,
        [addHits, payment.user_mobile]
      );

      if (userRes.rowCount === 0) {
        throw new Error(`User with mobile ${payment.user_mobile} not found for hit crediting.`);
      }

      logger.info('Payment approved atomically', {
        paymentId,
        userMobile: payment.user_mobile,
        hitsCredited: addHits,
        admin: adminUsername
      });

      return {
        payment: {
          id: payment.id,
          userMobile: payment.user_mobile,
          amount: payment.amount,
          hits: addHits,
          utr: payment.utr_number,
          status: 'Approved'
        },
        user: userRes.rows[0]
      };
    });
  } else {
    // Local fallback with Mutex lock
    if (inFlightApprovals.has(paymentId)) {
      throw new Error('Payment approval is already in progress.');
    }
    inFlightApprovals.add(paymentId);

    try {
      const payments = await getPayments();
      const index = payments.findIndex(p => p.id === paymentId);
      if (index === -1) throw new Error('Payment request not found.');

      const payment = payments[index];
      if (payment.status === 'Approved') throw new Error('Payment has already been approved.');
      if (payment.status === 'Rejected') throw new Error('Cannot approve a rejected payment request.');

      const user = await findUser(payment.userMobile);
      if (!user) throw new Error('User not found.');

      const addHits = Number(payment.hits);
      user.remainingHits = (Number(user.remainingHits) || 0) + addHits;
      user.totalHits = (Number(user.totalHits) || 0) + addHits;
      await saveUser(user);

      payment.status = 'Approved';
      payment.approvedBy = adminUsername;
      payment.approvedAt = new Date().toISOString();
      fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));

      return { payment, user };
    } finally {
      inFlightApprovals.delete(paymentId);
    }
  }
}

/**
 * Concurrency-Safe Atomic Payment Rejection
 */
async function rejectPayment(paymentId, reason = 'Verification failed', adminUsername = 'Admin') {
  if (!paymentId) throw new Error('Payment ID is required.');

  if (db.isConnected) {
    const res = await db.query(
      `UPDATE payments 
       SET status = 'Rejected', rejected_at = NOW(), reject_reason = $1, approved_by = $2, updated_at = NOW() 
       WHERE id = $3 AND status = 'Pending' 
       RETURNING id, user_mobile as "userMobile", amount, utr_number as "utr", status`,
      [reason, adminUsername, paymentId]
    );

    if (res.rowCount === 0) {
      throw new Error('Payment request not found or already processed.');
    }

    return res.rows[0];
  } else {
    const payments = await getPayments();
    const index = payments.findIndex(p => p.id === paymentId);
    if (index === -1) throw new Error('Payment request not found.');

    const payment = payments[index];
    if (payment.status !== 'Pending') throw new Error('Payment is not pending.');

    payment.status = 'Rejected';
    payment.rejectReason = reason;
    payment.rejectedAt = new Date().toISOString();
    payment.approvedBy = adminUsername;
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));
    return payment;
  }
}

async function deletePaymentsByMobile(mobile) {
  if (!mobile) return;
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);

  if (db.isConnected) {
    try {
      await db.query('DELETE FROM payments WHERE user_mobile = $1 OR user_mobile LIKE $2', [cleanMobile, `%${cleanMobile}%`]);
    } catch(e) {}
  }

  const payments = await getPayments();
  const filtered = payments.filter(p => !p.userMobile.includes(cleanMobile));
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(filtered, null, 2));
}

module.exports = {
  getPlans,
  getPlanById,
  savePlan,
  deletePlan,
  getPayments,
  createPaymentRequest,
  approvePayment,
  rejectPayment,
  deletePaymentsByMobile
};
