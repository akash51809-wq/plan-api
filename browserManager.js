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

class FastBrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
    this.isInitializing = false;
    this.initPromise = null;
    this.currentAccount = null;
    this.cache = loadPersistentCache();
    
    // Concurrency FIFO Queue (replaces busy-wait polling)
    this.queue = [];
    this.maxQueueSize = 50;
    this.isProcessingQueue = false;
  }

  /**
   * Safe initialization with lock to prevent concurrent duplicate launches
   */
  async init(retries = 3) {
    if (this.isReady && this.page && !this.page.isClosed() && this.browser && this.browser.isConnected()) {
      return this.page;
    }

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      logger.info('Initializing High-Speed Playwright Automation Session...');
      const t0 = performance.now();

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await this.cleanup();

          // Select active EzyTM account from pool (Round-robin)
          const account = await ezytmAccountService.getNextActiveAccount();
          this.currentAccount = account;

          this.browser = await chromium.launch({
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
          });

          this.context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
          });

          this.page = await this.context.newPage();

          // 1. Login to PlanAPI / EzyTM using selected account
          logger.info(`Authenticating automation worker with EzyTM node [${account.label}] (${account.username}) (Attempt ${attempt}/${retries})...`);
          await this.page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

          const userInput = this.page.locator('#ContentPlaceHolder1_txtUsername');
          await userInput.waitFor({ state: 'visible', timeout: 20000 });
          await userInput.fill(account.username || config.username || '8840457632');

          const passInput = this.page.locator('#ContentPlaceHolder1_Password');
          await passInput.waitFor({ state: 'visible', timeout: 20000 });
          await passInput.fill(account.password || config.password || '123456');

          await this.page.locator('#ContentPlaceHolder1_LinkButton1').click();
          await this.page.waitForTimeout(2000);

          // 2. Pre-warm page at OperatorLook.aspx
          await this.page.goto(config.operatorLookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.page.locator('#ContentPlaceHolder1_TxtRechMobLoo').waitFor({ state: 'visible', timeout: 20000 });

          this.isReady = true;
          this.isInitializing = false;
          if (this.currentAccount && this.currentAccount.id) {
            ezytmAccountService.recordAccountSuccess(this.currentAccount.id).catch(() => {});
          }
          const elapsed = (performance.now() - t0).toFixed(2);
          logger.info(`Automation Worker Ready & Pre-warmed on node [${account.label}] in ${elapsed}ms.`);
          return this.page;
        } catch (err) {
          logger.warn(`Automation worker init attempt ${attempt} failed: ${err.message}`);
          if (this.currentAccount && this.currentAccount.id) {
            ezytmAccountService.recordAccountFailure(this.currentAccount.id, err.message).catch(() => {});
          }
          await this.cleanup();
          if (attempt === retries) {
            this.isInitializing = false;
            this.isReady = false;
            throw err;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    })();

    return this.initPromise;
  }

  /**
   * Clean up browser resources safely
   */
  async cleanup() {
    this.isReady = false;
    try {
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser && this.browser.isConnected()) await this.browser.close().catch(() => {});
    } catch (e) {}
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  /**
   * Enqueue a task to execute sequentially with timeout & backpressure
   */
  async executeTask(taskFn, taskName = 'task', timeoutMs = 25000) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Automation queue is at maximum capacity. Please retry shortly.');
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
   * Process the queued tasks sequentially
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

      let timeoutTimer = null;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutTimer = setTimeout(() => {
            reject(new Error(`Operation ${item.taskName} exceeded execution timeout of ${item.timeoutMs}ms.`));
          }, item.timeoutMs - timeInQueue);
        });

        const result = await Promise.race([
          (async () => {
            const page = await this.init();
            return await item.taskFn(page);
          })(),
          timeoutPromise
        ]);

        clearTimeout(timeoutTimer);
        item.resolve(result);
      } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        logger.error(`Error executing automation task ${item.taskName}`, { error: err.message });
        // If crash/closed, reset ready flag so next task re-inits
        if (err.message.includes('closed') || err.message.includes('Target page') || err.message.includes('crash')) {
          this.isReady = false;
        }
        item.reject(err);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * 1. Operator Lookup Task
   */
  async lookupOperator(mobileNumber) {
    const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length !== 10) {
      throw new Error('Valid 10-digit mobile number required.');
    }

    // Check fast cache
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

    return await this.executeTask(async (page) => {
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

    const t0 = performance.now();

    return await this.executeTask(async (page) => {
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
   * 3. Check Last Recharge Task (Sanitized - No hardcoded dummy PII)
   */
  async checkLastRecharge(mobileOrVc, opCode = '2') {
    const cleanNumber = String(mobileOrVc).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      throw new Error('Valid Mobile number or DTH VC number is required.');
    }

    return await this.executeTask(async (page) => {
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
   * 4. Fetch DTH Info Task (Sanitized - No hardcoded dummy PII)
   */
  async fetchDthInfo(dthNumber, dropdownVal = '28') {
    const cleanNumber = String(dthNumber).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      throw new Error('Valid DTH VC / Customer Number is required.');
    }

    return await this.executeTask(async (page) => {
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
}

const fastBrowserManager = new FastBrowserManager();
// Pre-warm on startup asynchronously
fastBrowserManager.init().catch(err => logger.warn('Pre-warm warning', { error: err.message }));

module.exports = fastBrowserManager;
