const assert = require('assert');
const http = require('http');
const { app } = require('../server');

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3099,
        path: path,
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting /ping endpoint integration test suite...');
  const server = app.listen(3099, '127.0.0.1');

  try {
    // Test 1: JSON response via query param
    console.log('Test 1: GET /ping?format=json');
    const r1 = await makeRequest('/ping?format=json');
    assert.strictEqual(r1.statusCode, 200, 'Status should be 200');
    assert(r1.headers['content-type'].includes('application/json'), 'Content-Type should be JSON');
    const json1 = JSON.parse(r1.body);
    assert.strictEqual(json1.status, 'ok', 'Status in JSON should be ok');
    assert.strictEqual(json1.message, 'pong', 'Message should be pong');
    assert(typeof json1.uptime === 'number', 'Uptime should be a number');
    console.log('✅ Test 1 Passed: JSON response received');

    // Test 2: JSON response via Accept header
    console.log('Test 2: GET /ping with Accept: application/json');
    const r2 = await makeRequest('/ping', {
      headers: { Accept: 'application/json' }
    });
    assert.strictEqual(r2.statusCode, 200);
    const json2 = JSON.parse(r2.body);
    assert.strictEqual(json2.message, 'pong');
    console.log('✅ Test 2 Passed: Accept header respected');

    // Test 3: Raw text response
    console.log('Test 3: GET /ping?format=text');
    const r3 = await makeRequest('/ping?format=text');
    assert.strictEqual(r3.statusCode, 200);
    assert.strictEqual(r3.body, 'pong');
    console.log('✅ Test 3 Passed: Raw pong text returned');

    // Test 4: HEAD request
    console.log('Test 4: HEAD /ping');
    const r4 = await makeRequest('/ping', { method: 'HEAD' });
    assert.strictEqual(r4.statusCode, 200);
    console.log('✅ Test 4 Passed: HEAD request returned 200 OK');

    // Test 5: Browser request with Accept: text/html
    console.log('Test 5: GET /ping with Accept: text/html (Browser View)');
    const r5 = await makeRequest('/ping', {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-dest': 'document',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    assert.strictEqual(r5.statusCode, 200);
    assert(r5.body.includes('Render Keep-Alive'), 'HTML should contain page title');
    assert(r5.body.includes('Cron-Job Target Ping URL'), 'HTML should contain cronjob card');
    console.log('✅ Test 5 Passed: HTML page served to browser');

    // Test 6: Static /ping.html
    console.log('Test 6: GET /ping.html');
    const r6 = await makeRequest('/ping.html');
    assert.strictEqual(r6.statusCode, 200);
    assert(r6.body.includes('<!doctype html>'), 'Static ping.html served');
    console.log('✅ Test 6 Passed: Static ping.html served');

    console.log('\n🎉 ALL /ping INTEGRATION TESTS PASSED SUCCESSFULLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    server.close();
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
