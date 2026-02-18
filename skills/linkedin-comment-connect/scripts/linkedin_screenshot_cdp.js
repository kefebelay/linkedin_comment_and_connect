// Take a screenshot of the current page in an existing logged-in Chromium via CDP.
//
// Usage:
//   node linkedin_screenshot_cdp.js
// Env:
//   CDP_URL (default: http://127.0.0.1:9222)
//   SCREENSHOT_PATH (default: /work/linkedin_last.png)

const { chromium } = require('playwright');

async function main() {
  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const screenshotPath = process.env.SCREENSHOT_PATH || '/work/linkedin_last.png';

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context && context.pages()[0];
  if (!page) throw new Error('No page found');

  await page.waitForTimeout(800);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('OK: Screenshot saved to:', screenshotPath);

  await browser.close();
}

main().catch((e) => {
  console.error('ERROR:', e && e.stack ? e.stack : String(e));
  process.exit(1);
});
