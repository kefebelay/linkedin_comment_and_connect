// Verify a LinkedIn comment was posted by checking if the comment text appears in the comments list.
// Strict mode: we look for the exact comment text in likely comment-body elements and scroll to load more.
//
// Usage:
//   node linkedin_verify_comment_cdp.js "<postUrl>" "<commentText>"
// Env:
//   CDP_URL (default http://127.0.0.1:9222)
//   VERIFY_TIMEOUT_MS (default 60000)
//   VERIFY_POLL_MS (default 2000)
// Output:
//   One JSON line: { ok, method, attempts, elapsedMs, foundCount }

const { chromium } = require('playwright');

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const postUrl = process.argv[2];
  const commentText = process.argv[3];
  if (!postUrl || !commentText) {
    console.error('Usage: node linkedin_verify_comment_cdp.js "<postUrl>" "<commentText>"');
    process.exit(2);
  }

  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || '60000');
  const pollMs = Number(process.env.VERIFY_POLL_MS || '2000');
  const start = Date.now();

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || (await browser.newContext());

  try {
    const pages = context.pages();
    const baseUrl = postUrl.split('?')[0];
    const page =
      pages.find((p) => (p.url() || '').includes(baseUrl)) ||
      pages.find((p) => (p.url() || '').includes('linkedin.com')) ||
      pages[0] ||
      (await context.newPage());

    await page.bringToFront().catch(() => {});

    // Re-load to reduce "stale" UI issues.
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

    const needle = norm(commentText);
    let attempts = 0;
    let foundCount = 0;

    // Likely selectors for comment body text across LinkedIn variants.
    const commentBodySelectors = [
      'span.comments-comment-item__main-content',
      'div.comments-comment-item__main-content',
      'span.comments-comment-item__comment-text',
      'div.comments-comment-item__comment-text',
      // Generic fallbacks inside comment items
      'article.comments-comment-item span[dir="ltr"]',
      'article.comments-comment-item div[dir="ltr"]'
    ];

    while (Date.now() - start < timeoutMs) {
      attempts += 1;

      // Ensure comments are visible and try to load more.
      await page
        .getByRole('button', { name: /load more comments|see more comments|more comments/i })
        .first()
        .click({ timeout: 800 })
        .catch(() => {});

      // Avoid raw page scrolling: it leaves the browser far down the page and can disrupt
      // the user's ability to inspect state. Prefer clicking explicit "load more" controls.
      await page.waitForTimeout(200);

      // Strict check: count matches in likely comment-body nodes.
      foundCount = await page
        .evaluate(({ needle, sels }) => {
          const norm2 = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const out = [];
          for (const sel of sels) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const t = norm2(el.textContent || '');
              if (t && t.includes(needle)) out.push({ sel });
            }
          }
          return out.length;
        }, { needle, sels: commentBodySelectors })
        .catch(() => 0);

      if (foundCount > 0) break;
      await page.waitForTimeout(pollMs);
    }

    const elapsedMs = Date.now() - start;
    const payload = { ok: foundCount > 0, method: 'commentBodySelectorIncludes', attempts, elapsedMs, foundCount };
    process.stdout.write(JSON.stringify(payload) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('ERROR:', e && e.stack ? e.stack : String(e));
  process.exit(1);
});
