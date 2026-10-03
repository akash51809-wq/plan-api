const BasePage = require('./basePage');

class OperatorLookPage extends BasePage {
  async runLookup(page, mobileNumber) {
    await this.waitForReady(page);

    // Exact input selector for mobile number on OperatorLook.aspx
    const mobileInput = page.locator('#ContentPlaceHolder1_TxtRechMobLoo');
    await mobileInput.waitFor({ state: 'visible', timeout: 15000 });
    await mobileInput.fill(String(mobileNumber).trim());

    // Exact search/fetch button on OperatorLook.aspx
    const searchBtn = page.locator('#ContentPlaceHolder1_LinkButton1');
    await searchBtn.waitFor({ state: 'visible', timeout: 10000 });
    await searchBtn.click();

    // Wait for response and DOM update
    await page.waitForTimeout(3000);
    await this.waitForReady(page);

    // Extract structured result
    const bodyText = await page.locator('body').innerText();

    const operatorMatch = bodyText.match(/Operator\s*Name\s*:\s*([^\r\n]+)/i);
    const circleMatch = bodyText.match(/Circle\s*Name\s*:\s*([^\r\n]+)/i);
    const mobileMatch = bodyText.match(/Mobile\s*No\s*:\s*([^\r\n]+)/i);

    const result = {
      mobile: mobileMatch ? mobileMatch[1].trim() : String(mobileNumber).trim(),
      operator: operatorMatch ? operatorMatch[1].trim() : null,
      circle: circleMatch ? circleMatch[1].trim() : null,
      rawText: [operatorMatch ? operatorMatch[0] : '', circleMatch ? circleMatch[0] : '', mobileMatch ? mobileMatch[0] : ''].filter(Boolean).join(' | ')
    };

    return result;
  }
}

module.exports = OperatorLookPage;
