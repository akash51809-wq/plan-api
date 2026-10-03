const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./services/logger');
const ezytmAccountService = require('./services/ezytmAccountService');

const CACHE_FILE = path.join(__dirname, 'data', 'operator_cache.json');

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {}
  return new Map();
}

function savePersistentCache(cacheMap) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(cacheMap);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

/**
 * Single Persistent EzyTM Account Session Worker
 * Manages dedicated isolated Browser Context, Page, Login Session, and Sequential Queue
 */
class EzytmAccountSession {
  constructor(account, pool) {
    this.id = account.id;
    this.username = String(account.username || '').trim();
    this.password = String(account.password || '').trim();
    this.label = account.label || `EzyTM Node (${this.username})`;
    this.status = account.status || 'Active'; // Active or Disabled
    this.pool = pool;

    // Runtime session lifecycle state
    // 'UNINITIALIZED' | 'INITIALIZING' | 'READY' | 'BUSY' | 'ERROR' | 'CLOSED'
    this.sessionState = 'UNINITIALIZED';
    this.context = null;
    this.page = null;
    this.initPromise = null;

    // Statistics & diagnostics
    this.lastUsedAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
    this.totalHandled = 0;

    // Per-account sequential FIFO queue
    this.queue = [];
    this.maxQueueSize = 50;
    this.isProcessingQueue = false;
  }

  /**
   * Check if current page session is alive and ready
   */
  isHealthy() {
    return (
      (this.sessionState === 'READY' || this.sessionState === 'BUSY') &&
      this.page &&
      (typeof this.page.isClosed !== 'function' || !this.page.isClosed())
    );
  }

  /**
   * Initialize and log in this specific account session
   */
  async init(retries = 3) {
    if (this.isHealthy()) {
      return this.page;
    }

    if (this.sessionState === 'INITIALIZING' && this.initPromise) {
      return this.initPromise;
    }

    this.sessionState = 'INITIALIZING';
    this.initPromise = (async () => {
      const t0 = performance.now();
      logger.info(`[Pool Node: ${this.label}] Initializing dedicated browser session (${this.username})...`);

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await this.cleanupSession();

          const browser = await this.pool.getBrowser();

          // Create isolated browser context (independent cookies, storage, cache)
          this.context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            ignoreHTTPSErrors: true
          });

          this.page = await this.context.newPage();

          // Set up failure detectors on page
          this.page.on('crash', () => {
            logger.warn(`[Pool Node: ${this.label}] Page crashed. Resetting session.`);
            this.sessionState = 'ERROR';
          });
          this.page.on('close', () => {
            if (this.sessionState !== 'CLOSED') {
              this.sessionState = 'UNINITIALIZED';
            }
          });

          // 1. Navigate to Login Page
          logger.info(`[Pool Node: ${this.label}] Authenticating with EzyTM (Attempt ${attempt}/${retries})...`);
          await this.page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

          const userInput = this.page.locator('#ContentPlaceHolder1_txtUsername');
          await userInput.waitFor({ state: 'visible', timeout: 10000 });
          await userInput.fill(this.username || config.username || '8840457632');

          const passInput = this.page.locator('#ContentPlaceHolder1_Password');
          await passInput.waitFor({ state: 'visible', timeout: 10000 });
          await passInput.fill(this.password || config.password || '123456');

          await this.page.locator('#ContentPlaceHolder1_LinkButton1').click();
          await this.page.waitForTimeout(1500);

          // 2. Pre-warm page at OperatorLook.aspx
          await this.page.goto(config.operatorLookUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await this.page.locator('#ContentPlaceHolder1_TxtRechMobLoo').waitFor({ state: 'visible', timeout: 10000 });

          this.sessionState = 'READY';
          this.consecutiveErrors = 0;
          this.lastError = null;
          ezytmAccountService.recordAccountSuccess(this.id).catch(() => {});

          const elapsed = (performance.now() - t0).toFixed(2);
          logger.info(`[Pool Node: ${this.label}] Session READY & Pre-warmed successfully in ${elapsed}ms.`);
          return this.page;
        } catch (err) {
          logger.warn(`[Pool Node: ${this.label}] Session init attempt ${attempt} failed: ${err.message}`);
          this.lastError = err.message;
          this.consecutiveErrors++;
          ezytmAccountService.recordAccountFailure(this.id, err.message).catch(() => {});

          await this.cleanupSession();

          if (attempt === retries) {
            this.sessionState = 'ERROR';
            this.initPromise = null;
            throw err;
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    })();

    try {
      const page = await this.initPromise;
      return page;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Execute a task on this account's sequential queue
   */
  async executeTask(taskFn, taskName = 'task', timeoutMs = 25000) {
    if (this.status !== 'Active') {
      throw new Error(`EzyTM account ${this.label} is currently disabled.`);
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Queue for ${this.label} is at maximum capacity (${this.maxQueueSize}).`);
    }

    return new Promise((resolve, reject) => {
      const queueItem = {
        taskFn,
        taskName,
        timeoutMs,
        resolve,
        reject,
        queuedAt: Date.now()
      };

      this.queue.push(queueItem);
      this.processQueue();
    });
  }

  /**
   * Process queued tasks sequentially for this account
   */
  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const timeInQueue = Date.now() - item.queuedAt;

      if (timeInQueue > item.timeoutMs) {
        item.reject(new Error(`Task ${item.taskName} timed out in queue after ${timeInQueue}ms.`));
        continue;
      }

      this.sessionState = 'BUSY';

      let timeoutTimer = null;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutTimer = setTimeout(() => {
            reject(new Error(`Operation ${item.taskName} on ${this.label} exceeded execution timeout of ${item.timeoutMs}ms.`));
          }, item.timeoutMs - timeInQueue);
        });

        const result = await Promise.race([
          (async () => {
            const page = this.isHealthy() ? this.page : await this.init();

            // Verify session hasn't been logged out or expired
            const currentUrl = (page && typeof page.url === 'function') ? page.url() : '';
            if (currentUrl.toLowerCase().includes('login.aspx')) {
              logger.warn(`[Pool Node: ${this.label}] Session expired (redirected to Login.aspx). Re-authenticating...`);
              await this.cleanupSession();
              const freshPage = await this.init();
              return await item.taskFn(freshPage);
            }

            return await item.taskFn(page);
          })(),
          timeoutPromise
        ]);

        clearTimeout(timeoutTimer);
        this.lastUsedAt = new Date().toISOString();
        this.lastSuccessAt = new Date().toISOString();
        this.lastError = null;
        this.consecutiveErrors = 0;
        this.totalHandled++;
        this.sessionState = 'READY';

        ezytmAccountService.recordAccountSuccess(this.id).catch(() => {});
        item.resolve(result);
      } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        logger.error(`[Pool Node: ${this.label}] Error executing automation task ${item.taskName}`, { error: err.message });

        this.lastError = err.message;
        this.consecutiveErrors++;
        ezytmAccountService.recordAccountFailure(this.id, err.message).catch(() => {});

        // If crash/closed, mark error and clean up so next task re-inits cleanly
        if (
          err.message.includes('closed') ||
          err.message.includes('Target page') ||
          err.message.includes('crash') ||
          err.message.includes('Navigation failed')
        ) {
          this.sessionState = 'ERROR';
          await this.cleanupSession();
        } else {
          this.sessionState = 'READY';
        }

        item.reject(err);
      }
    }

    if (this.sessionState === 'BUSY') {
      this.sessionState = 'READY';
    }
    this.isProcessingQueue = false;
  }

  /**
   * Update account credentials and reset session
   */
  async updateCredentials(username, password, label, status) {
    let credentialsChanged = false;
    if (username && username !== this.username) {
      this.username = username;
      credentialsChanged = true;
    }
    if (password && password !== this.password) {
      this.password = password;
      credentialsChanged = true;
    }
    if (label) this.label = label;
    if (status) this.status = status;

    if (this.status === 'Disabled') {
      await this.close();
      return;
    }

    if (credentialsChanged) {
      logger.info(`[Pool Node: ${this.label}] Credentials updated. Resetting session...`);
      await this.cleanupSession();
      this.sessionState = 'UNINITIALIZED';
      this.init().catch(e => logger.warn(`[Pool Node: ${this.label}] Background re-init error: ${e.message}`));
    }
  }

  /**
   * Clean up page and context resources
   */
  async cleanupSession() {
    try {
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      if (this.context) await this.context.close().catch(() => {});
    } catch (e) {}
    this.page = null;
    this.context = null;
  }

  /**
   * Fully close and destroy this account session
   */
  async close() {
    this.sessionState = 'CLOSED';
    // Reject any queued tasks
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item.reject(new Error(`Account session ${this.label} was closed.`));
    }
    await this.cleanupSession();
  }

  /**
   * Get runtime metrics for admin reporting
   */
  getMetrics() {
    return {
      id: this.id,
      label: this.label,
      username: this.username,
      status: this.status,
      sessionState: this.sessionState,
      queueLength: this.queue.length,
      isProcessing: this.isProcessingQueue,
      totalHandled: this.totalHandled,
      consecutiveErrors: this.consecutiveErrors,
      lastUsedAt: this.lastUsedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError
    };
  }
}

/**
 * High-Speed Multi-Account Persistent Session Pool Manager
 */
class EzytmSessionPool {
  constructor() {
    this.sessions = new Map(); // id -> EzytmAccountSession
    this.sharedBrowser = null;
    this.browserLaunchPromise = null;
    this.isStarting = false;
    this.isStarted = false;
    this.roundRobinIndex = 0;
    this.cache = loadPersistentCache();

    // Hook auto-detection listeners from ezytmAccountService
    ezytmAccountService.addAccountChangeListener((event, data) => {
      this.handleAccountChangeEvent(event, data);
    });
  }

  /**
   * Get or launch the shared Playwright Chromium Browser process
   */
  async getBrowser() {
    if (this.sharedBrowser && this.sharedBrowser.isConnected()) {
      return this.sharedBrowser;
    }

    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }

    this.browserLaunchPromise = (async () => {
      try {
        logger.info('Launching Chromium browser instance for EzyTM Multi-Session Pool...');
        const launchOptions = {
          headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        };

        try {
          this.sharedBrowser = await chromium.launch(launchOptions);
        } catch (launchErr) {
          const errMsg = launchErr.message || '';
          if (
            errMsg.includes("Executable doesn't exist") ||
            errMsg.includes('playwright install') ||
            errMsg.includes('chrome-headless-shell') ||
            errMsg.includes('chromium')
          ) {
            logger.warn('Playwright Chromium binary missing from system cache. Running automatic background installation (npx playwright install chromium)...');
            const { execSync } = require('child_process');
            try {
              execSync('npx playwright install chromium', { stdio: 'inherit' });
              logger.info('Playwright Chromium installed successfully. Retrying browser launch...');
              this.sharedBrowser = await chromium.launch(launchOptions);
            } catch (installErr) {
              logger.error('Failed to auto-install Playwright chromium binary', { error: installErr.message });
              throw launchErr;
            }
          } else {
            throw launchErr;
          }
        }

        this.sharedBrowser.on('disconnected', () => {
          logger.warn('Chromium browser process disconnected. Will relaunch on demand.');
          this.sharedBrowser = null;
          // Mark all sessions uninitialized so they recreate contexts
          for (const session of this.sessions.values()) {
            if (session.sessionState !== 'CLOSED') {
              session.sessionState = 'UNINITIALIZED';
            }
          }
        });

        return this.sharedBrowser;
      } finally {
        this.browserLaunchPromise = null;
      }
    })();

    return this.browserLaunchPromise;
  }

  /**
   * Start the multi-account session pool (background non-blocking)
   */
  async startPool() {
    if (this.isStarting || this.isStarted) return;
    this.isStarting = true;

    try {
      logger.info('Starting EzyTM Multi-Account Persistent Session Pool...');
      const accounts = await ezytmAccountService.getActiveAccounts();

      if (accounts.length === 0) {
        logger.info('No active EzyTM accounts found. Spawning default fallback session...');
        const fallbackAcc = {
          id: 'EZY_FALLBACK_DEFAULT',
          username: config.username || '8840457632',
          password: config.password || '123456',
          label: 'Default Fallback Node',
          status: 'Active'
        };
        const session = new EzytmAccountSession(fallbackAcc, this);
        this.sessions.set(fallbackAcc.id, session);
        session.init().catch(err => logger.warn(`Fallback session pre-warm warning: ${err.message}`));
      } else {
        logger.info(`Found ${accounts.length} active EzyTM accounts. Initializing pool sessions in parallel...`);
        for (const acc of accounts) {
          const session = new EzytmAccountSession(acc, this);
          this.sessions.set(acc.id, session);
          // Parallel background init with error isolation
          session.init().catch(err => logger.warn(`Session [${acc.label}] initial pre-warm notice: ${err.message}`));
        }
      }

      this.isStarted = true;
    } catch (err) {
      logger.error('Error starting EzyTM Session Pool', { error: err.message });
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Handle hot account mutations (Add, Update, Toggle, Delete)
   */
  async handleAccountChangeEvent(event, data) {
    try {
      if (event === 'add' && data && data.id) {
        logger.info(`[Pool Hot-Add] Detected new EzyTM account [${data.label}]. Spawning session...`);
        const session = new EzytmAccountSession(data, this);
        this.sessions.set(data.id, session);
        session.init().catch(e => logger.warn(`[Pool Hot-Add] Init error for ${data.label}: ${e.message}`));
      } else if ((event === 'update' || event === 'toggle') && data && data.id) {
        let session = this.sessions.get(data.id);
        if (session) {
          logger.info(`[Pool Hot-Update] Updating session for [${data.label}] (Status: ${data.status})...`);
          await session.updateCredentials(data.username, data.password, data.label, data.status);
        } else if (data.status === 'Active') {
          logger.info(`[Pool Hot-Update] Enabling session for [${data.label}]...`);
          session = new EzytmAccountSession(data, this);
          this.sessions.set(data.id, session);
          session.init().catch(e => logger.warn(`[Pool Hot-Update] Init error for ${data.label}: ${e.message}`));
        }
      } else if (event === 'delete' && data) {
        const id = typeof data === 'string' ? data : data.id;
        const session = this.sessions.get(id);
        if (session) {
          logger.info(`[Pool Hot-Delete] Closing and removing session ${id} from pool...`);
          this.sessions.delete(id);
          session.close().catch(() => {});
        }
      }
    } catch (err) {
      logger.error('Error processing account change in pool', { event, error: err.message });
    }
  }

  /**
   * Acquire the best available session:
   * 1. Idle & READY session (via Round-Robin / LRU)
   * 2. Least loaded READY session
   * 3. Initializing / active session with smallest queue
   * 4. Auto-fallback / on-demand initialization
   */
  async acquireBestSession() {
    const activeSessions = Array.from(this.sessions.values()).filter(
      s => s.status === 'Active' && s.sessionState !== 'CLOSED'
    );

    if (activeSessions.length === 0) {
      // If pool has no sessions, dynamically sync or create fallback
      await this.startPool();
      const retrySessions = Array.from(this.sessions.values()).filter(
        s => s.status === 'Active' && s.sessionState !== 'CLOSED'
      );
      if (retrySessions.length > 0) return retrySessions[0];
      throw new Error('No active EzyTM accounts available in pool.');
    }

    // 1. Look for Idle & READY sessions
    const idleReadySessions = activeSessions.filter(
      s => s.sessionState === 'READY' && s.queue.length === 0
    );

    if (idleReadySessions.length > 0) {
      const idx = this.roundRobinIndex % idleReadySessions.length;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % idleReadySessions.length;
      return idleReadySessions[idx];
    }

    // 2. Look for any READY session with smallest queue
    const allReadySessions = activeSessions.filter(s => s.sessionState === 'READY');
    if (allReadySessions.length > 0) {
      allReadySessions.sort((a, b) => a.queue.length - b.queue.length);
      return allReadySessions[0];
    }

    // 3. Look for INITIALIZING or BUSY sessions with capacity
    const availableSessions = activeSessions.filter(s => s.sessionState !== 'ERROR');
    if (availableSessions.length > 0) {
      availableSessions.sort((a, b) => a.queue.length - b.queue.length);
      return availableSessions[0];
    }

    // 4. If all in ERROR, pick the one with fewest consecutive errors and trigger recovery
    activeSessions.sort((a, b) => a.consecutiveErrors - b.consecutiveErrors);
    const candidate = activeSessions[0];
    candidate.init().catch(() => {});
    return candidate;
  }

  /**
   * Dispatch a task across the session pool with automatic failover
   */
  async dispatchTask(taskFn, taskName = 'task', timeoutMs = 25000) {
    const session = await this.acquireBestSession();
    try {
      return await session.executeTask(taskFn, taskName, timeoutMs);
    } catch (err) {
      // If initial session failed before processing and other ready sessions exist, failover once
      const otherReady = Array.from(this.sessions.values()).filter(
        s => s.id !== session.id && s.status === 'Active' && s.sessionState === 'READY'
      );

      if (otherReady.length > 0) {
        logger.warn(`Task ${taskName} failed on [${session.label}]. Attempting failover to [${otherReady[0].label}]...`);
        return await otherReady[0].executeTask(taskFn, taskName, timeoutMs);
      }

      throw err;
    }
  }

  /**
   * 1. Operator Lookup Task
   */
  async lookupOperator(mobileNumber) {
    const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length !== 10) {
      throw new Error('Valid 10-digit mobile number required.');
    }

    // Check fast cache (<0.001 ms)
    const t0 = performance.now();
    if (this.cache.has(cleanMobile)) {
      const cached = this.cache.get(cleanMobile);
      const elapsedMs = (performance.now() - t0).toFixed(3);
      return {
        ...cached,
        cached: true,
        responseTime: `${elapsedMs} ms`
      };
    }

    return await this.dispatchTask(async (page) => {
      if (!page.url().includes('OperatorLook.aspx')) {
        await page.goto(config.operatorLookUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      const input = page.locator('#ContentPlaceHolder1_TxtRechMobLoo');
      await input.fill(cleanMobile);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      const bodyText = await page.locator('body').innerText();
      const operatorMatch = bodyText.match(/Operator\s*Name\s*:\s*([^\r\n]+)/i);
      const circleMatch = bodyText.match(/Circle\s*Name\s*:\s*([^\r\n]+)/i);
      const mobileMatch = bodyText.match(/Mobile\s*No\s*:\s*([^\r\n]+)/i);

      const elapsedMs = (performance.now() - t0).toFixed(2);
      const result = {
        mobile: mobileMatch ? mobileMatch[1].trim() : cleanMobile,
        operator: operatorMatch ? operatorMatch[1].trim() : 'Unknown',
        circle: circleMatch ? circleMatch[1].trim() : 'Unknown',
        cached: false,
        responseTime: `${elapsedMs} ms`
      };

      if (result.operator !== 'Unknown') {
        this.cache.set(cleanMobile, result);
        savePersistentCache(this.cache);
      }

      return result;
    }, `lookup_${cleanMobile}`);
  }

  /**
   * 2. Fetch R-Offers Task
   */
  async fetchRoffer(mobileNumber, dropdownValue = '2') {
    const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length !== 10) {
      throw new Error('Valid 10-digit mobile number required.');
    }

    return await this.dispatchTask(async (page) => {
      if (!page.url().includes('RofferData.aspx')) {
        await page.goto('https://planapi.in/RofferData.aspx', { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await page.locator('#ContentPlaceHolder1_TxtRechMobLoo').fill(cleanMobile);
      await page.locator('#ContentPlaceHolder1_ddlMobRC').selectOption(String(dropdownValue));

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      const parsed = await page.evaluate((mobile) => {
        const msgEl = document.querySelector('#ContentPlaceHolder1_Message');
        const message = msgEl ? msgEl.innerText.trim() : 'Offer Successfully Checked';
        const validityNodes = Array.from(document.querySelectorAll('.validity'));
        const offers = [];

        validityNodes.forEach(node => {
          const pPrice = node.querySelector('.rchge-one p');
          const pDesc = node.querySelector('.rchge-three p');
          const pComm = node.querySelector('.rchge-four p');

          const price = pPrice ? pPrice.innerText.trim() : '';
          const desc = pDesc ? pDesc.innerText.trim() : '';
          const comm = pComm ? pComm.innerText.trim() : '0';

          if (price && desc) {
            offers.push({
              price,
              commissionUnit: "A",
              ofrtext: desc,
              logdesc: desc,
              commissionAmount: comm || "0"
            });
          }
        });

        return { message, offers };
      }, cleanMobile);

      return {
        ERROR: "0",
        STATUS: "1",
        MOBILENO: cleanMobile,
        RDATA: parsed.offers,
        MESSAGE: parsed.message || "Offer Successfully Checked"
      };
    }, `roffer_${cleanMobile}`);
  }

  /**
   * 3. Check Last Recharge Task
   */
  async checkLastRecharge(mobileOrVc, opCode = '2') {
    const cleanNumber = String(mobileOrVc).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      throw new Error('Valid Mobile number or DTH VC number is required.');
    }

    return await this.dispatchTask(async (page) => {
      if (!page.url().includes('RechargeCheck.aspx')) {
        await page.goto(config.rechargeCheckUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await page.locator('#ContentPlaceHolder1_TxtRechMobLoo').fill(cleanNumber);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      const parsed = await page.evaluate((num) => {
        const op = document.getElementById('ContentPlaceHolder1_opcodetxt')?.innerText.trim() || '';
        const amount = document.getElementById('ContentPlaceHolder1_LblAmount')?.innerText.trim() || '';
        const mobile = document.getElementById('ContentPlaceHolder1_mobileno')?.innerText.trim() || num;
        const expiry = document.getElementById('ContentPlaceHolder1_lblExprydate')?.innerText.trim() || '';
        const lastRecharge = document.getElementById('ContentPlaceHolder1_lblstats')?.innerText.trim() || '';
        const err = document.getElementById('ContentPlaceHolder1_errlblrc')?.innerText.trim() || '';

        return { op, amount, mobile, expiry, lastRecharge, err };
      }, cleanNumber);

      if (parsed.err && !parsed.amount && !parsed.lastRecharge) {
        return {
          error: "7",
          Message: parsed.err || "Invalid VC or Operator"
        };
      }

      return {
        error: "0",
        DATA: {
          VC: cleanNumber,
          Name: "",
          Rmn: cleanNumber.length >= 10 ? cleanNumber.slice(-10) : cleanNumber,
          Balance: parsed.amount || "0.00",
          Monthly: parsed.amount || "",
          "Next Recharge Date": parsed.expiry || "",
          Plan: parsed.amount ? `₹${parsed.amount} Plan` : "",
          Address: "",
          City: "",
          District: "",
          State: "",
          "PIN Code": "",
          "Last Recharge Date": parsed.lastRecharge || "",
          Operator: parsed.op || "Mobile/DTH"
        },
        Message: "Offer Successfully Checked"
      };
    }, `recharge_${cleanNumber}`);
  }

  /**
   * 4. Fetch DTH Info Task
   */
  async fetchDthInfo(dthNumber, dropdownVal = '28') {
    const cleanNumber = String(dthNumber).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      throw new Error('Valid DTH VC / Customer Number is required.');
    }

    return await this.dispatchTask(async (page) => {
      if (!page.url().includes('DTHinfoDetails.aspx')) {
        await page.goto('https://planapi.in/DTHinfoDetails.aspx', { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await page.locator('#ContentPlaceHolder1_DTHopertaorinfo').selectOption(String(dropdownVal));
      await page.locator('#ContentPlaceHolder1_DTHMobileno').fill(cleanNumber);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      const parsed = await page.evaluate((num) => {
        const opName = document.getElementById('ContentPlaceHolder1_Operatorname')?.innerText.trim() || '';
        const vc = document.getElementById('ContentPlaceHolder1_VC')?.innerText.trim() || num;
        const name = document.getElementById('ContentPlaceHolder1_Name')?.innerText.trim() || '';
        const mobile = document.getElementById('ContentPlaceHolder1_Mobileno')?.innerText.trim() || '';
        const balance = document.getElementById('ContentPlaceHolder1_Balance')?.innerText.trim() || '';
        const monthly = document.getElementById('ContentPlaceHolder1_Monthly')?.innerText.trim() || '';
        const duedate = document.getElementById('ContentPlaceHolder1_Duedate')?.innerText.trim() || '';
        const plan = document.getElementById('ContentPlaceHolder1_plan')?.innerText.trim() || '';
        const address = document.getElementById('ContentPlaceHolder1_Address')?.innerText.trim() || '';
        const message = document.getElementById('ContentPlaceHolder1_Message')?.innerText.trim() || '';

        return { opName, vc, name, mobile, balance, monthly, duedate, plan, address, message };
      }, cleanNumber);

      if (parsed.message === 'Invalid ID' || (!parsed.name && !parsed.balance && !parsed.monthly && parsed.message.includes('Invalid'))) {
        return {
          error: "7",
          Message: "Invalid VC or Operator"
        };
      }

      return {
        error: "0",
        DATA: {
          VC: parsed.vc || cleanNumber,
          Name: parsed.name || "",
          Rmn: parsed.mobile || cleanNumber,
          Balance: parsed.balance || "0.00",
          Monthly: parsed.monthly || "",
          "Next Recharge Date": parsed.duedate || "",
          Plan: parsed.plan || "",
          Address: parsed.address || "",
          City: "",
          District: "",
          State: "",
          "PIN Code": "",
          Operator: parsed.opName || "DTH"
        },
        Message: "Offer Successfully Checked"
      };
    }, `dth_${cleanNumber}`);
  }

  /**
   * Force re-initialization / reconnect of an account session
   */
  async reconnectAccount(id) {
    let session = this.sessions.get(id);
    if (!session) {
      const accounts = await ezytmAccountService.getAllAccounts();
      const target = accounts.find(a => a.id === id);
      if (target) {
        session = new EzytmAccountSession(target, this);
        this.sessions.set(id, session);
      }
    }
    if (session) {
      logger.info(`[Pool Reconnect] Re-authenticating session for [${session.label}]...`);
      session.sessionState = 'UNINITIALIZED';
      session.consecutiveErrors = 0;
      session.lastError = null;
      session.init(2).catch(e => logger.warn(`[Pool Reconnect] Error for ${session.label}: ${e.message}`));
      return true;
    }
    return false;
  }

  /**
   * Reconnect all active sessions currently in ERROR state
   */
  reconnectAllErrorSessions() {
    for (const session of this.sessions.values()) {
      if (session.status === 'Active' && session.sessionState === 'ERROR') {
        session.sessionState = 'UNINITIALIZED';
        session.consecutiveErrors = 0;
        session.init(2).catch(() => {});
      }
    }
  }

  /**
   * Get real-time status of all accounts in the pool
   */
  getPoolStatus() {
    return Array.from(this.sessions.values()).map(s => s.getMetrics());
  }

  /**
   * Clean up all browser resources and close all sessions cleanly
   */
  async cleanup() {
    logger.info('Shutting down EzyTM Multi-Session Pool and cleaning up resources...');
    for (const session of this.sessions.values()) {
      await session.close().catch(() => {});
    }
    this.sessions.clear();

    if (this.sharedBrowser && this.sharedBrowser.isConnected()) {
      await this.sharedBrowser.close().catch(() => {});
    }
    this.sharedBrowser = null;
    this.isStarted = false;
  }
}

const ezytmSessionPool = new EzytmSessionPool();

// Pre-warm pool in background asynchronously on module load
ezytmSessionPool.startPool().catch(err => logger.warn('Session pool startup notice', { error: err.message }));

module.exports = ezytmSessionPool;
