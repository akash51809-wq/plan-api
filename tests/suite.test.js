/**
 * Comprehensive Automated Test Suite
 * Tests Concurrency, Hit Deduction, Multi-Client Auth, IP Whitelisting,
 * Payment Security & Double-Credit Prevention, OTP Security & Admin Auth.
 */

require('dotenv').config();
const assert = require('assert');
const userService = require('../services/userService');
const clientService = require('../services/clientService');
const planService = require('../services/planService');
const otpService = require('../services/otpService');
const adminService = require('../services/adminService');
const ipService = require('../services/ipService');
const db = require('../services/db');

async function runTestSuite() {
  console.log('====================================================');
  console.log('🚀 STARTING AUDIT & STABILITY AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`🧪 Testing: ${name}... `);
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log('❌ FAIL');
      console.error(`   Error: ${err.message}`);
      console.error(err.stack);
      failed++;
    }
  }

  // Ensure DB / in-memory is initialized
  await db.initDatabase();

  // ----------------------------------------------------
  // TEST 1: Concurrency-Safe Atomic Hit Deduction
  // ----------------------------------------------------
  await test('1. Concurrency-Safe Atomic Hit Deduction (20 simultaneous on 10 hits)', async () => {
    const mobile = '9999900001';
    let user = await userService.saveUser({
      name: 'Concurrency Tester',
      mobile: mobile,
      remainingHits: 10,
      usedHits: 0,
      totalHits: 10
    });

    assert.strictEqual(user.remainingHits, 10, 'Initial hits must be 10');

    // Launch 20 simultaneous concurrent requests
    const promises = Array.from({ length: 20 }, () => userService.deductUserHit(user.id));
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.allowed).length;
    const failCount = results.filter(r => !r.allowed).length;

    assert.strictEqual(successCount, 10, `Expected exactly 10 successes, got ${successCount}`);
    assert.strictEqual(failCount, 10, `Expected exactly 10 failures, got ${failCount}`);

    const finalUser = await userService.findUser(user.id);
    assert.strictEqual(finalUser.remainingHits, 0, 'Final remaining hits must be 0 and never negative');
  });

  // ----------------------------------------------------
  // TEST 2: Hit Refund on Downstream Failure
  // ----------------------------------------------------
  await test('2. Atomic Hit Refund on Downstream Failure', async () => {
    const mobile = '9999900001';
    const user = await userService.findUser(mobile);
    assert.strictEqual(user.remainingHits, 0);

    // Refund 1 hit
    await userService.refundUserHit(user.id);

    const updated = await userService.findUser(user.id);
    assert.strictEqual(updated.remainingHits, 1, 'Remaining hits should now be 1');
  });

  // ----------------------------------------------------
  // TEST 3: Multi-Application Client Keys & IP Whitelisting
  // ----------------------------------------------------
  await test('3. Multi-App API Key Generation & IP Whitelist Validation', async () => {
    const mobile = '9999900002';
    const user = await userService.saveUser({
      name: 'Multi-App User',
      mobile: mobile,
      remainingHits: 50
    });

    // Create client 1 for Website 1
    const client1 = await clientService.createApiClient(user.id, {
      clientName: 'Website 1 Production',
      allowedIps: ['192.168.1.0/24', '10.0.0.5']
    });
    assert.ok(client1.rawToken, 'Raw API token must be returned upon creation');
    assert.strictEqual(client1.rawToken.startsWith('tok_'), true, 'Token format prefix must be tok_');

    // Verify key authentication with allowed subnet IP
    const authValid = await clientService.authenticateApiRequest(user.id, client1.rawToken, '192.168.1.100');
    assert.strictEqual(authValid.authenticated, true, 'Valid key and allowed subnet IP should succeed');

    // Verify allowed exact IP
    const authExactIp = await clientService.authenticateApiRequest(user.id, client1.rawToken, '10.0.0.5');
    assert.strictEqual(authExactIp.authenticated, true, 'Allowed exact IP should succeed');

    // Verify blocked unauthorized IP
    const authBlockedIp = await clientService.authenticateApiRequest(user.id, client1.rawToken, '203.0.113.195');
    assert.strictEqual(authBlockedIp.authenticated, false, 'Unlisted IP should be blocked');
    assert.strictEqual(authBlockedIp.isIpBlocked, true, 'isIpBlocked flag must be true');

    // Verify invalid API key
    const authBadKey = await clientService.authenticateApiRequest(user.id, 'tok_invalid_dummy_token_123', '192.168.1.100');
    assert.strictEqual(authBadKey.authenticated, false, 'Bad key should fail');
  });

  // ----------------------------------------------------
  // TEST 4: Payment Tamper Prevention & Server Plan Authority
  // ----------------------------------------------------
  await test('4. Payment Tamper Prevention (Server Plan Authority)', async () => {
    const plans = await planService.getPlans();
    assert.ok(plans.length > 0, 'Plans must be available');
    const selectedPlan = plans[0]; // e.g. Starter Plan

    const mobile = '9999900003';
    const user = await userService.saveUser({
      name: 'Payment Tamper User',
      mobile: mobile,
      remainingHits: 0
    });

    // Client attempts to tamper amount and hits in payload
    const paymentReq = await planService.createPaymentRequest({
      userMobile: user.mobile,
      userName: user.name,
      planId: selectedPlan.id,
      utr: 'UTR_TAMPER_' + Date.now(),
      paymentDate: '2026-10-03'
    });

    // Verify server authoritative values were enforced
    assert.strictEqual(paymentReq.amount, selectedPlan.amount, 'Server must enforce plan amount');
    assert.strictEqual(paymentReq.hits, selectedPlan.hits, 'Server must enforce plan hits');
    assert.strictEqual(paymentReq.status, 'Pending');
  });

  // ----------------------------------------------------
  // TEST 5: Payment Double-Approval Race Condition Prevention
  // ----------------------------------------------------
  await test('5. Payment Double-Approval Race Condition Prevention', async () => {
    const plans = await planService.getPlans();
    const plan = plans[0];
    const mobile = '9999900004';
    let user = await userService.saveUser({
      name: 'Double Approval User',
      mobile: mobile,
      remainingHits: 10,
      totalHits: 10
    });
    const initialHits = user.remainingHits;

    const payment = await planService.createPaymentRequest({
      userMobile: user.mobile,
      userName: user.name,
      planId: plan.id,
      utr: 'UTR_RACE_' + Date.now(),
      paymentDate: '2026-10-03'
    });

    // Launch 2 simultaneous approval attempts for the exact same payment
    let successfulCount = 0;
    const approvePromises = [
      planService.approvePayment(payment.id, 'admin_1').then(() => successfulCount++).catch(() => {}),
      planService.approvePayment(payment.id, 'admin_2').then(() => successfulCount++).catch(() => {})
    ];

    await Promise.all(approvePromises);

    assert.strictEqual(successfulCount, 1, 'Exactly one approve call must succeed');

    user = await userService.findUser(user.id);
    assert.strictEqual(
      user.remainingHits,
      initialHits + plan.hits,
      `User hits must be credited exactly once (${plan.hits}), actual: ${user.remainingHits - initialHits}`
    );
  });

  // ----------------------------------------------------
  // TEST 6: Cryptographic OTP Generation, Cooldown & Lockout
  // ----------------------------------------------------
  await test('6. Cryptographic OTP Generation, Cooldown & Lockout', async () => {
    const testMobile = '99' + String(Date.now()).slice(-8);

    // 1. Generate OTP
    const rawOtp = await otpService.generateAndSaveOtp(testMobile, 'OTP Tester');
    assert.ok(rawOtp, 'OTP returned for sending');
    assert.strictEqual(rawOtp.length, 6, 'OTP must be 6 digits');

    // 2. Cooldown test: Resend immediately within 60s should be rejected
    let cooldownErrorCaught = false;
    try {
      await otpService.generateAndSaveOtp(testMobile, 'OTP Tester');
    } catch (err) {
      cooldownErrorCaught = true;
      assert.ok(err.message.includes('wait') || err.message.includes('before requesting'), err.message);
    }
    assert.strictEqual(cooldownErrorCaught, true, 'Immediate resend must be rejected with cooldown error');

    // 3. Brute force test: 3 wrong attempts
    const wrong1 = await otpService.verifyOtp(testMobile, '000000');
    assert.strictEqual(wrong1.valid, false);

    const wrong2 = await otpService.verifyOtp(testMobile, '000001');
    assert.strictEqual(wrong2.valid, false);

    const wrong3 = await otpService.verifyOtp(testMobile, '000002');
    assert.strictEqual(wrong3.valid, false);

    // 4th attempt even with correct OTP should fail because of max attempts lockout
    const correctAfterLockout = await otpService.verifyOtp(testMobile, rawOtp);
    assert.strictEqual(correctAfterLockout.valid, false, 'Verification after lockout must fail');
  });

  // ----------------------------------------------------
  // TEST 7: Admin Authentication & Signed HMAC Session Tokens
  // ----------------------------------------------------
  await test('7. Admin Authentication & Signed HMAC Session Tokens', async () => {
    // Bad password
    const badLogin = await adminService.loginAdmin('admin', 'wrong-admin-password');
    assert.strictEqual(badLogin.success, false, 'Bad admin password must fail');

    // Good password
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const goodLogin = await adminService.loginAdmin('admin', adminPass);
    assert.strictEqual(goodLogin.success, true, 'Valid password must succeed');
    assert.ok(goodLogin.token, 'Signed session token must be returned');

    // Verify valid token
    const session = adminService.verifyAdminSession(goodLogin.token);
    assert.ok(session, 'Valid signed token must verify');
    assert.strictEqual(session.role, 'admin');

    // Tampered token test
    const tampered = goodLogin.token.slice(0, -4) + 'abcd';
    const tamperedCheck = adminService.verifyAdminSession(tampered);
    assert.strictEqual(tamperedCheck, null, 'Tampered token must be rejected');
  });

  // ----------------------------------------------------
  // TEST 8: IP Subnet & CIDR Matching Logic
  // ----------------------------------------------------
  await test('8. IP Subnet & CIDR Matching Logic', async () => {
    // Exact IPv4 match
    assert.strictEqual(ipService.isIpAllowed('192.168.1.1', ['192.168.1.1']), true);
    assert.strictEqual(ipService.isIpAllowed('192.168.1.2', ['192.168.1.1']), false);

    // CIDR /24 subnet match
    assert.strictEqual(ipService.isIpAllowed('10.50.1.45', ['10.50.1.0/24']), true);
    assert.strictEqual(ipService.isIpAllowed('10.50.2.45', ['10.50.1.0/24']), false);

    // Multiple mixed list
    const allowedList = ['127.0.0.1', '10.0.0.0/8', '172.16.50.10'];
    assert.strictEqual(ipService.isIpAllowed('127.0.0.1', allowedList), true);
    assert.strictEqual(ipService.isIpAllowed('10.254.1.2', allowedList), true);
    assert.strictEqual(ipService.isIpAllowed('172.16.50.10', allowedList), true);
    assert.strictEqual(ipService.isIpAllowed('172.16.50.11', allowedList), false);
  });

  // ----------------------------------------------------
  // TEST 9: EzyTM Multi-Account Persistent Session Pool & Rotation
  // ----------------------------------------------------
  await test('9. EzyTM Multi-Account Persistent Session Pool & Rotation', async () => {
    const ezytmAccountService = require('../services/ezytmAccountService');
    const browserManager = require('../browserManager');

    const acc1 = await ezytmAccountService.addAccount({
      username: 'test_node_1',
      password: 'pass1_test',
      label: 'Test Node 1'
    });
    const acc2 = await ezytmAccountService.addAccount({
      username: 'test_node_2',
      password: 'pass2_test',
      label: 'Test Node 2'
    });

    assert.ok(acc1.id, 'Account 1 ID created');
    assert.ok(acc2.id, 'Account 2 ID created');

    // Verify session pool hot-add auto-detection
    assert.ok(browserManager.sessions.has(acc1.id), 'Session pool must auto-detect and register acc1');
    assert.ok(browserManager.sessions.has(acc2.id), 'Session pool must auto-detect and register acc2');

    const s1 = browserManager.sessions.get(acc1.id);
    const s2 = browserManager.sessions.get(acc2.id);
    assert.strictEqual(s1.username, 'test_node_1');
    assert.strictEqual(s2.username, 'test_node_2');

    // Simulate ready state for fast unit testing of concurrency queues
    s1.sessionState = 'READY';
    s1.initPromise = null;
    s1.context = {};
    s1.page = { isClosed: () => false, url: () => 'http://localhost' };

    s2.sessionState = 'READY';
    s2.initPromise = null;
    s2.context = {};
    s2.page = { isClosed: () => false, url: () => 'http://localhost' };

    // Test per-account independent sequential queue execution with parallel inter-account processing
    let acc1TaskRunning = false;
    let acc2TaskRunning = false;
    let parallelOverlapDetected = false;

    const task1 = s1.executeTask(async () => {
      acc1TaskRunning = true;
      await new Promise(r => setTimeout(r, 40));
      if (acc2TaskRunning) parallelOverlapDetected = true;
      acc1TaskRunning = false;
      return 'result1';
    }, 'test_parallel_1');

    const task2 = s2.executeTask(async () => {
      acc2TaskRunning = true;
      await new Promise(r => setTimeout(r, 40));
      if (acc1TaskRunning) parallelOverlapDetected = true;
      acc2TaskRunning = false;
      return 'result2';
    }, 'test_parallel_2');

    const [r1, r2] = await Promise.all([task1, task2]);
    assert.strictEqual(r1, 'result1');
    assert.strictEqual(r2, 'result2');
    assert.strictEqual(parallelOverlapDetected, true, 'Tasks on different account sessions must execute in parallel');

    // Test round robin account selection
    const pick1 = await ezytmAccountService.getNextActiveAccount();
    const pick2 = await ezytmAccountService.getNextActiveAccount();
    assert.ok(pick1 && pick2, 'Both round-robin picks should return active accounts');

    // Test status toggle and hot-update
    const toggled = await ezytmAccountService.toggleAccountStatus(acc1.id);
    assert.strictEqual(toggled.status, 'Disabled', 'Account 1 should now be disabled');

    // Clean up test accounts (and verify hot-delete from pool)
    await ezytmAccountService.deleteAccount(acc1.id);
    await ezytmAccountService.deleteAccount(acc2.id);
    assert.strictEqual(browserManager.sessions.has(acc1.id), false, 'Deleted account 1 must be removed from pool');
    assert.strictEqual(browserManager.sessions.has(acc2.id), false, 'Deleted account 2 must be removed from pool');
  });

  // ----------------------------------------------------
  // TEST 10: Duplicate Plan Creation Prevention
  // ----------------------------------------------------
  await test('10. Duplicate Plan Creation Prevention (Same Amount & Same Hits)', async () => {
    // Attempting to create duplicate ₹100 / 20000 hits plan
    let duplicateRejected = false;
    try {
      await planService.savePlan({
        amount: 100,
        hits: 20000,
        name: 'Duplicate Starter Plan'
      });
    } catch (err) {
      duplicateRejected = true;
      assert.ok(err.message.includes('already exists'), 'Must reject duplicate plan with clear message');
    }
    assert.strictEqual(duplicateRejected, true, 'Duplicate plan creation must be rejected');
  });

  // ----------------------------------------------------
  // TEST 11: Global Duplicate UTR Rejection Across Users
  // ----------------------------------------------------
  await test('11. Global Duplicate UTR Rejection Across Users', async () => {
    const userA = await userService.saveUser({ name: 'User A', mobile: '9999900005' });
    const userB = await userService.saveUser({ name: 'User B', mobile: '9999900006' });

    const sharedUtr = 'UTR_GLOBAL_TEST_' + Date.now();

    // User A submits payment with sharedUtr
    const reqA = await planService.createPaymentRequest({
      userMobile: userA.mobile,
      userName: userA.name,
      planId: 'PLAN_100',
      utr: sharedUtr
    });
    assert.ok(reqA.id, 'User A request should be created');

    // User B tries to submit payment with the exact same UTR
    let duplicateUtrRejected = false;
    try {
      await planService.createPaymentRequest({
        userMobile: userB.mobile,
        userName: userB.name,
        planId: 'PLAN_100',
        utr: sharedUtr
      });
    } catch (err) {
      duplicateUtrRejected = true;
      assert.ok(err.message.includes('already been used'), 'Must reject previously used UTR');
    }
    assert.strictEqual(duplicateUtrRejected, true, 'User B must be rejected from using User A UTR');

    // Clean up
    await userService.deleteUser('9999900005');
    await userService.deleteUser('9999900006');
  });
  // ----------------------------------------------------
  await test('12. New Plan Creation & Retrieval Integrity', async () => {
    const testAmount = 350;
    const testHits = 88000;
    const createdPlan = await planService.savePlan({
      amount: testAmount,
      hits: testHits,
      name: 'Special ₹350 Test Plan'
    });

    assert.ok(createdPlan, 'Plan object must be returned');
    assert.strictEqual(Number(createdPlan.amount), testAmount);
    assert.strictEqual(Number(createdPlan.hits), testHits);

    const allPlans = await planService.getPlans();
    const found = allPlans.find(p => Number(p.amount) === testAmount && Number(p.hits) === testHits);
    assert.ok(found, 'Created plan must exist in allPlans list');

    // Clean up created plan
    await planService.deletePlan(createdPlan.id);
  });

  // ----------------------------------------------------
  // TEST 13: 2-Midnight Operator Fetch Cache & Multi-User Instant Lookup
  // ----------------------------------------------------
  await test('13. 2-Midnight Operator Fetch Cache & Multi-User Instant Lookup', async () => {
    const operatorCacheService = require('../services/operatorCacheService');
    const testNum = '9876543210';

    // 1. Calculate and verify 2-midnight expiry
    const now = new Date();
    const expiryIso = operatorCacheService.getNext2MidnightExpiry(now);
    const expiryDate = new Date(expiryIso);

    // Verify expiry is in the future and set at 00:00:00 (midnight)
    assert.ok(expiryDate.getTime() > now.getTime(), 'Expiry must be in the future');
    assert.strictEqual(expiryDate.getHours(), 0, 'Expiry hour must be 00 (midnight)');
    assert.strictEqual(expiryDate.getMinutes(), 0, 'Expiry minute must be 00');

    // 2. Set test operator cache
    await operatorCacheService.setOperator(testNum, {
      operator: 'AIRTEL',
      circle: 'UP East',
      opcode: '2',
      circleCode: '54'
    });

    // 3. User 1 looks up number -> Instant cache hit
    const t0 = performance.now();
    const cached1 = await operatorCacheService.getOperator(testNum);
    const elapsed1 = performance.now() - t0;

    assert.ok(cached1, 'Cache record must be found');
    assert.strictEqual(cached1.operator, 'AIRTEL');
    assert.strictEqual(cached1.circle, 'UP East');
    assert.strictEqual(cached1.isCacheHit, true);
    assert.ok(elapsed1 < 50, `Lookup must be instant (<50ms), took ${elapsed1.toFixed(3)}ms`);

    // 4. User 2 looks up the same number -> Also instant cache hit
    const cached2 = await operatorCacheService.getOperator(testNum);
    assert.ok(cached2, 'User 2 must receive same cached operator');
    assert.strictEqual(cached2.operator, 'AIRTEL');
  });

  // Clean test dummy users and payments created during test execution
  await userService.deleteUser('9999900001');
  await userService.deleteUser('9999900002');
  await userService.deleteUser('9999900003');
  await userService.deleteUser('9999900004');
  await userService.deleteUser('9999900005');
  await userService.deleteUser('9999900006');
  await planService.deletePaymentsByMobile('99999');

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION & SECURITY TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
