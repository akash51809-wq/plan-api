const fs = require('fs');
const path = require('path');
const { getUsers, saveUser, findUserByMobile } = require('./userService');

const PLANS_FILE = path.join(__dirname, '..', 'data', 'plans.json');
const PAYMENTS_FILE = path.join(__dirname, '..', 'data', 'payments.json');

// Default initial plans matching user's reference
const DEFAULT_PLANS = [
  { id: 'PLAN_100', amount: 100, hits: 20000, active: true, createdAt: new Date().toISOString() },
  { id: 'PLAN_200', amount: 200, hits: 50000, active: true, createdAt: new Date().toISOString() },
  { id: 'PLAN_500', amount: 500, hits: 150000, active: true, createdAt: new Date().toISOString() },
  { id: 'PLAN_1000', amount: 1000, hits: 350000, active: true, createdAt: new Date().toISOString() }
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------- PLANS CRUD ---------------- //

function getPlans() {
  try {
    ensureDir(PLANS_FILE);
    if (!fs.existsSync(PLANS_FILE)) {
      fs.writeFileSync(PLANS_FILE, JSON.stringify(DEFAULT_PLANS, null, 2));
      return DEFAULT_PLANS;
    }
    const content = fs.readFileSync(PLANS_FILE, 'utf8');
    const plans = JSON.parse(content);
    return Array.isArray(plans) && plans.length > 0 ? plans : DEFAULT_PLANS;
  } catch (err) {
    console.error('Error reading plans:', err);
    return DEFAULT_PLANS;
  }
}

function savePlan({ amount, hits }) {
  const plans = getPlans();
  const amt = Number(amount);
  const hts = Number(hits);

  if (!amt || !hts || amt <= 0 || hts <= 0) {
    throw new Error('Valid Amount and Hits are required.');
  }

  const newPlan = {
    id: 'PLAN_' + Date.now(),
    amount: amt,
    hits: hts,
    active: true,
    createdAt: new Date().toISOString()
  };

  plans.push(newPlan);
  // Sort by amount ascending
  plans.sort((a, b) => a.amount - b.amount);
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
  return newPlan;
}

function deletePlan(id) {
  const plans = getPlans();
  const filtered = plans.filter(p => p.id !== id);
  fs.writeFileSync(PLANS_FILE, JSON.stringify(filtered, null, 2));
  return true;
}

// ---------------- PAYMENT REQUESTS ---------------- //

function getPayments() {
  try {
    ensureDir(PAYMENTS_FILE);
    if (!fs.existsSync(PAYMENTS_FILE)) {
      fs.writeFileSync(PAYMENTS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const content = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading payments:', err);
    return [];
  }
}

function createPaymentRequest({ userMobile, userName, planId, amount, hits, utr, paymentDate, paymentProof }) {
  const cleanMobile = String(userMobile).trim().replace(/\D/g, '').slice(-10);
  const user = findUserByMobile(cleanMobile);

  if (!cleanMobile) {
    throw new Error('User Mobile is required.');
  }
  if (!utr || String(utr).trim().length < 4) {
    throw new Error('Valid UTR / Transaction Reference Number is required.');
  }

  const payments = getPayments();

  // Check duplicate pending UTR
  const cleanUtr = String(utr).trim().toUpperCase();
  const existingUtr = payments.find(p => p.utr === cleanUtr && p.status === 'Pending');
  if (existingUtr) {
    throw new Error('A payment request with this UTR is already pending review.');
  }

  const newPayment = {
    id: 'REQ_' + Date.now(),
    userMobile: cleanMobile,
    userName: userName || (user ? user.name : 'User'),
    planId: planId || 'CUSTOM',
    amount: Number(amount) || 100,
    hits: Number(hits) || 20000,
    utr: cleanUtr,
    paymentDate: paymentDate || new Date().toISOString().split('T')[0],
    paymentProof: paymentProof || '',
    status: 'Pending',
    createdAt: new Date().toISOString()
  };

  payments.unshift(newPayment);
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));
  return newPayment;
}

function approvePayment(paymentId) {
  const payments = getPayments();
  const paymentIndex = payments.findIndex(p => p.id === paymentId);

  if (paymentIndex === -1) {
    throw new Error('Payment request not found.');
  }

  const payment = payments[paymentIndex];
  if (payment.status === 'Approved') {
    throw new Error('This payment request has already been approved.');
  }

  // Credit hits to user account
  const user = findUserByMobile(payment.userMobile);
  if (!user) {
    throw new Error(`User with mobile ${payment.userMobile} not found in database.`);
  }

  const currentHits = Number(user.remainingHits) || 0;
  const currentTotal = Number(user.totalHits) || 0;
  const addHits = Number(payment.hits) || 0;

  const updatedUser = saveUser({
    ...user,
    remainingHits: currentHits + addHits,
    totalHits: currentTotal + addHits,
    lastPlanAmount: payment.amount,
    lastPlanHits: addHits,
    lastRechargeDate: new Date().toISOString()
  });

  payment.status = 'Approved';
  payment.approvedAt = new Date().toISOString();
  payments[paymentIndex] = payment;

  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));
  return { payment, user: updatedUser };
}

function rejectPayment(paymentId, reason = 'Invalid payment / UTR verification failed') {
  const payments = getPayments();
  const paymentIndex = payments.findIndex(p => p.id === paymentId);

  if (paymentIndex === -1) {
    throw new Error('Payment request not found.');
  }

  const payment = payments[paymentIndex];
  payment.status = 'Rejected';
  payment.rejectedAt = new Date().toISOString();
  payment.rejectReason = reason;

  payments[paymentIndex] = payment;
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));
  return payment;
}

// ---------------- HIT USAGE / CONSUMPTION ---------------- //

function deductUserHit(mobile) {
  const cleanMobile = String(mobile).trim().replace(/\D/g, '').slice(-10);
  const user = findUserByMobile(cleanMobile);

  if (!user) {
    return { allowed: false, remainingHits: 0, message: 'User not found' };
  }

  // If remainingHits is undefined, give 50 initial trial hits
  let currentHits = typeof user.remainingHits === 'number' ? user.remainingHits : 50;

  if (currentHits <= 0) {
    return {
      allowed: false,
      remainingHits: 0,
      message: 'Insufficient hit balance. Please purchase a plan to continue.'
    };
  }

  currentHits -= 1;
  const usedHits = (Number(user.usedHits) || 0) + 1;

  saveUser({
    ...user,
    remainingHits: currentHits,
    usedHits
  });

  return {
    allowed: true,
    remainingHits: currentHits,
    usedHits
  };
}

module.exports = {
  getPlans,
  savePlan,
  deletePlan,
  getPayments,
  createPaymentRequest,
  approvePayment,
  rejectPayment,
  deductUserHit
};
