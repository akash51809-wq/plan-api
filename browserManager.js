const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const CACHE_FILE = path.join(__dirname, 'data', 'operator_cache.json');

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch(e) {}
  return new Map();
}

function savePersistentCache(cacheMap) {
  try {
    const obj = Object.fromEntries(cacheMap);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch(e) {}
}

class FastBrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
    this.isBusy = false;
    // Load persistent cache on startup
    this.cache = loadPersistentCache();
  }

  async init(retries = 3) {
    if (this.isReady && this.page && !this.page.isClosed()) {
      return this.page;
    }

    console.log('⚡ Initializing High-Speed Automation Session...');
    const t0 = performance.now();

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!this.browser || !this.browser.isConnected()) {
          this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu']
          });
          this.context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
          });
          this.page = await this.context.newPage();
        }

        // 1. Perform Login
        console.log(`🔑 Logging in to PlanAPI (Attempt ${attempt}/${retries})...`);
        await this.page.goto(config.loginUrl, { waitUntil: 'load', timeout: 35000 }).catch(async () => {
          return this.page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        });

        const userInput = this.page.locator('#ContentPlaceHolder1_txtUsername');
        await userInput.waitFor({ state: 'visible', timeout: 20000 });
        await userInput.fill(config.username);

        const passInput = this.page.locator('#ContentPlaceHolder1_Password');
        await passInput.waitFor({ state: 'visible', timeout: 20000 });
        await passInput.fill(config.password);

        await this.page.locator('#ContentPlaceHolder1_LinkButton1').click();
        await this.page.waitForTimeout(2000);

        // 2. Pre-warm page right at OperatorLook.aspx
        console.log('🚀 Pre-warming at OperatorLook.aspx...');
        await this.page.goto(config.operatorLookUrl, { waitUntil: 'load', timeout: 35000 }).catch(async () => {
          return this.page.goto(config.operatorLookUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        });
        await this.page.locator('#ContentPlaceHolder1_TxtRechMobLoo').waitFor({ state: 'visible', timeout: 20000 });

        this.isReady = true;
        console.log(`✅ Session Pre-warmed and ready in ${(performance.now() - t0).toFixed(2)}ms!`);
        return this.page;
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err.message);
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  async lookupOperator(mobileNumber) {
    const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length !== 10) {
      throw new Error('Valid 10-digit mobile number required.');
    }

    // 1. Check in-memory Cache (Microsecond response)
    const t0 = performance.now();
    if (this.cache.has(cleanMobile)) {
      const cached = this.cache.get(cleanMobile);
      const elapsedMs = (performance.now() - t0).toFixed(3);
      console.log(`⚡ [CACHE HIT - ${elapsedMs} ms] ${cleanMobile} -> ${cached.operator} (${cached.circle})`);
      return {
        ...cached,
        cached: true,
        responseTime: `${elapsedMs} ms`
      };
    }

    // 2. Queue for active browser page
    while (this.isBusy) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isBusy = true;

    try {
      const page = await this.init();

      // Ensure we are on OperatorLook.aspx
      if (!page.url().includes('OperatorLook.aspx')) {
        await page.goto(config.operatorLookUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      const input = page.locator('#ContentPlaceHolder1_TxtRechMobLoo');
      await input.fill(cleanMobile);

      // Click Search and wait for response without arbitrary delay
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      // Parse result from page body
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

      // Store in memory & persistent disk cache
      if (result.operator !== 'Unknown') {
        this.cache.set(cleanMobile, result);
        savePersistentCache(this.cache);
      }

      console.log(`🚀 [LIVE FETCH - ${elapsedMs} ms] ${cleanMobile} -> ${result.operator} (${result.circle})`);
      return result;

    } catch (err) {
      console.error('Error during OperatorLook:', err);
      this.isReady = false; // Trigger re-init on error
      throw err;
    } finally {
      this.isBusy = false;
    }
  }

  async fetchRoffer(mobileNumber, dropdownValue = '2') {
    const cleanMobile = String(mobileNumber).trim().replace(/\D/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length !== 10) {
      throw new Error('Valid 10-digit mobile number required.');
    }

    const t0 = performance.now();

    while (this.isBusy) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isBusy = true;

    try {
      const page = await this.init();

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
              price: price,
              commissionUnit: "A",
              ofrtext: desc,
              logdesc: desc,
              commissionAmount: comm || "0"
            });
          }
        });

        return { message, offers };
      }, cleanMobile);

      const elapsedMs = (performance.now() - t0).toFixed(2);
      console.log(`🎁 [ROFFER FETCH - ${elapsedMs} ms] ${cleanMobile} (OpVal: ${dropdownValue}) -> Found ${parsed.offers.length} offers`);

      return {
        ERROR: "0",
        STATUS: "1",
        MOBILENO: cleanMobile,
        RDATA: parsed.offers,
        MESSAGE: parsed.message || "Offer Successfully Checked"
      };

    } catch (err) {
      console.error('Error during Roffer fetch:', err);
      this.isReady = false;
      throw err;
    } finally {
      this.isBusy = false;
    }
  }

  async checkLastRecharge(mobileOrVc, opCode = '2') {
    const cleanNumber = String(mobileOrVc).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 9) {
      throw new Error('Valid Mobile number or DTH VC number is required.');
    }

    const t0 = performance.now();

    while (this.isBusy) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isBusy = true;

    try {
      const page = await this.init();

      if (!page.url().includes('RechargeCheck.aspx')) {
        await page.goto(config.rechargeCheckUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await page.locator('#ContentPlaceHolder1_TxtRechMobLoo').fill(cleanNumber);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        page.locator('#ContentPlaceHolder1_LinkButton1').click()
      ]);

      const parsed = await page.evaluate((num) => {
        const op = document.getElementById('ContentPlaceHolder1_opcodetxt')?.innerText.trim() || 'Airtel';
        const amount = document.getElementById('ContentPlaceHolder1_LblAmount')?.innerText.trim() || '';
        const mobile = document.getElementById('ContentPlaceHolder1_mobileno')?.innerText.trim() || num;
        const expiry = document.getElementById('ContentPlaceHolder1_lblExprydate')?.innerText.trim() || '';
        const lastRecharge = document.getElementById('ContentPlaceHolder1_lblstats')?.innerText.trim() || '';
        const err = document.getElementById('ContentPlaceHolder1_errlblrc')?.innerText.trim() || '';

        return { op, amount, mobile, expiry, lastRecharge, err };
      }, cleanNumber);

      const elapsedMs = (performance.now() - t0).toFixed(2);
      console.log(`📱 [RECHARGE CHECK - ${elapsedMs} ms] ${cleanNumber} -> Amount: ₹${parsed.amount || '0'}, Last: ${parsed.lastRecharge || 'NA'}`);

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
          Name: "MR Subscriber .",
          Rmn: cleanNumber.length >= 10 ? cleanNumber.slice(-10) : cleanNumber,
          Balance: parsed.amount || "0.00",
          Monthly: parsed.amount || "",
          "Next Recharge Date": parsed.expiry || "",
          Plan: parsed.amount ? `₹${parsed.amount} Plan` : "",
          Address: "Flat no apartment, Vadala Pathardi Road, In",
          City: "",
          District: "40",
          State: "",
          "PIN Code": "422009",
          "Last Recharge Date": parsed.lastRecharge || "",
          Operator: parsed.op || "Airtel"
        },
        Message: "Offer Successfully Checked"
      };

    } catch (err) {
      console.error('Error during RechargeCheck fetch:', err);
      this.isReady = false;
      throw err;
    } finally {
      this.isBusy = false;
    }
  }

  async fetchDthInfo(dthNumber, dropdownVal = '28') {
    const cleanNumber = String(dthNumber).trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      throw new Error('Valid DTH VC / Customer Number is required.');
    }

    const t0 = performance.now();

    while (this.isBusy) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isBusy = true;

    try {
      const page = await this.init();

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

      const elapsedMs = (performance.now() - t0).toFixed(2);
      console.log(`📺 [DTH INFO FETCH - ${elapsedMs} ms] ${cleanNumber} (OpVal: ${dropdownVal}) -> Result: ${parsed.message || 'Checked'}`);

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
          Name: parsed.name || "MR Subscriber .",
          Rmn: parsed.mobile || cleanNumber,
          Balance: parsed.balance || "0.00",
          Monthly: parsed.monthly || "",
          "Next Recharge Date": parsed.duedate || "",
          Plan: parsed.plan || "",
          Address: parsed.address || "Flat no sppartment, Vadala Pathardi Road, In",
          City: "",
          District: "40",
          State: "",
          "PIN Code": "422009",
          Operator: parsed.opName || "DTH"
        },
        Message: "Offer Successfully Checked"
      };

    } catch (err) {
      console.error('Error during DthInfo fetch:', err);
      this.isReady = false;
      throw err;
    } finally {
      this.isBusy = false;
    }
  }
}

const fastBrowserManager = new FastBrowserManager();
// Pre-warm immediately on server startup
fastBrowserManager.init().catch(err => console.error('Pre-warm error:', err.message));

module.exports = fastBrowserManager;
