class BasePage {
  async findFirst(page, selectors = [], options = {}) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count > 0) {
        return locator.first();
      }
    }

    if (options.throwOnMissing) {
      throw new Error(`No matching element found for selectors: ${selectors.join(', ')}`);
    }

    return null;
  }

  async waitForReady(page) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
  }

  async fillIfExists(page, selectors, value) {
    const element = await this.findFirst(page, selectors, { throwOnMissing: false });
    if (element) {
      await element.fill(value);
      return true;
    }
    return false;
  }

  async clickIfExists(page, selectors) {
    const element = await this.findFirst(page, selectors, { throwOnMissing: false });
    if (element) {
      await element.click();
      return true;
    }
    return false;
  }
}

module.exports = BasePage;
