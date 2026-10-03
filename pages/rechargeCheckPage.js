const BasePage = require('./basePage');

class RechargeCheckPage extends BasePage {
  async checkLastRecharge(page, mobileNumber, operator = '') {
    await this.waitForReady(page);

    // If operator is known and not Airtel, RechargeCheck on PlanAPI only supports Airtel
    const isAirtel = !operator || /airtel/i.test(operator);
    if (!isAirtel) {
      return {
        mobile: String(mobileNumber).trim(),
        operator: operator,
        amount: null,
        expiryDate: null,
        lastRechargeDate: null,
        note: `Last recharge check is currently supported only for Airtel numbers on PlanAPI. (Detected: ${operator})`
      };
    }

    // 1. Fill mobile number
    const mobileInput = page.locator('#ContentPlaceHolder1_TxtRechMobLoo');
    await mobileInput.waitFor({ state: 'visible', timeout: 10000 });
    await mobileInput.fill(String(mobileNumber).trim());

    // 2. Click Search button
    const searchBtn = page.locator('#ContentPlaceHolder1_LinkButton1');
    await searchBtn.waitFor({ state: 'visible', timeout: 10000 });
    await searchBtn.click();

    // 3. Wait for results
    await page.waitForTimeout(3000);
    await this.waitForReady(page);

    // 4. Parse result
    const bodyText = await page.locator('body').innerText();

    if (/invalid operator|please try again later/i.test(bodyText)) {
      return {
        mobile: String(mobileNumber).trim(),
        operator: operator || 'Airtel',
        amount: null,
        expiryDate: null,
        lastRechargeDate: null,
        note: 'Portal returned: Invalid Operator or Not Available'
      };
    }

    const operatorMatch = bodyText.match(/Operator\s*Name\s*:\s*([^\r\n]+)/i);
    const amountMatch = bodyText.match(/Amount\s*:\s*([0-9.]+)/i);
    const mobileMatch = bodyText.match(/Mobile\s*No\s*:\s*([0-9]+)/i);
    const expiryMatch = bodyText.match(/Expiry\s*Date\s*:\s*([0-9\-\/]+)/i);
    const lastRechargeMatch = bodyText.match(/Last\s*Recharge\s*Date\s*:\s*([0-9\-\/]+)/i);

    return {
      mobile: mobileMatch ? mobileMatch[1].trim() : String(mobileNumber).trim(),
      operator: operatorMatch ? operatorMatch[1].trim() : operator || 'Airtel',
      amount: amountMatch ? amountMatch[1].trim() : null,
      expiryDate: expiryMatch ? expiryMatch[1].trim() : null,
      lastRechargeDate: lastRechargeMatch ? lastRechargeMatch[1].trim() : null,
      note: null
    };
  }
}

module.exports = RechargeCheckPage;
