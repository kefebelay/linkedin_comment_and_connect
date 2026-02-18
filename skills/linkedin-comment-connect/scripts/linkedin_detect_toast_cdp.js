// Detect LinkedIn error/success toast messages after attempting to post a comment.
// Usage:
//   node linkedin_detect_toast_cdp.js "<postUrl>"
// Env:
//   CDP_URL (default http://127.0.0.1:9222)
//   TOAST_TIMEOUT_MS (default 5000)
// Output: one JSON line
//   { ok, found, text, kind, elapsedMs }

const { chromium } = require('playwright');

async function main() {
  const postUrl = process.argv[2];
  if (!postUrl) {
    console.error('Usage: node linkedin_detect_toast_cdp.js "<postUrl>"');
    process.exit(2);
  }

  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const timeoutMs = Number(process.env.TOAST_TIMEOUT_MS || '5000');

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || (await browser.newContext());
  const pages = context.pages();
  const baseUrl = postUrl.split('?')[0];
  const page =
    pages.find((p) => (p.url() || '').includes(baseUrl)) ||
    pages.find((p) => (p.url() || '').includes('linkedin.com')) ||
    (pages[0] ?? (await context.newPage()));

  page.setDefaultTimeout(10_000);

  const start = Date.now();
  try {
    await page.bringToFront().catch(() => {});

    // Toasts are typically in aria-live regions.
    const toastLocator = page.locator('[role="alert"], [aria-live="assertive"], [aria-live="polite"]');

    let text = '';
    while (Date.now() - start < timeoutMs) {
      const t = await toastLocator
        .allTextContents()
        .then((arr) => arr.map((s) => (s || '').trim()).filter(Boolean).join('\n'))
        .catch(() => '');
      if (t) {
        text = t;
        break;
      }
      await page.waitForTimeout(200);
    }

    const norm = (s) => (s || '').toLowerCase();
    let kind = null;
    const n = norm(text);
    if (n.includes('could not be created') || n.includes("couldn’t be created") || n.includes('try again')) kind = 'error';
    else if (n.includes('comment') && (n.includes('posted') || n.includes('published'))) kind = 'success';

    const payload = {
      ok: kind === 'success',
      found: !!text,
      text: text || null,
      kind,
      elapsedMs: Date.now() - start,
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('ERROR:', e && e.stack ? e.stack : String(e));
  process.exit(1);
});
