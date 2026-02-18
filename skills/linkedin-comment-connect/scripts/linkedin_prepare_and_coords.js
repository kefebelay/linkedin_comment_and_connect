// Connect to an existing logged-in Chromium via CDP and prepare a LinkedIn comment.
// Outputs a single JSON line with click coordinates (viewport + window metrics)
// so the caller can perform an OS-level click via xdotool.
//
// Usage:
//   node linkedin_prepare_and_coords.js "<postUrl>" "<commentText>"
// Env:
//   CDP_URL (default: http://127.0.0.1:9222)
//
// Key idea:
// - LinkedIn often ignores synthetic Playwright clicks for submit.
// - There are multiple buttons named "Comment" (action-row vs blue submit).
// - Target submit by class substring:
//     button[class*="comments-comment-box__submit-button"]

const { chromium } = require('playwright');

async function main() {
  const postUrl = process.argv[2];
  const commentText = process.argv[3];

  if (!postUrl || !commentText) {
    console.error('Usage: node linkedin_prepare_and_coords.js "<postUrl>" "<commentText>"');
    process.exit(2);
  }

  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const browser = await chromium.connectOverCDP(cdpUrl);

  // Prefer the existing persistent context if present.
  const context = browser.contexts()[0] || (await browser.newContext());

  // Pick a page/tab that best matches the target URL (or any LinkedIn tab).
  const pages = context.pages();
  const baseUrl = postUrl.split('?')[0];
  let page =
    pages.find((p) => (p.url() || '').includes(baseUrl)) ||
    pages.find((p) => (p.url() || '').includes('linkedin.com')) ||
    (pages[0] ?? (await context.newPage()));

  page.setDefaultTimeout(45_000);

  try {
    await page.bringToFront().catch(() => {});
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    // Expand the composer by clicking the action-row Comment button under the post.
    // LinkedIn reuses the label "Comment" for multiple buttons.
    // NOTE: We intentionally do NOT click the action-row "Comment" button here.
    // LinkedIn often auto-scrolls deep into the comments list after that click,
    // which makes OS-level coordinate clicks unreliable and disrupts debugging.

    // Locate composer with minimal page movement.
    // Strategy:
    // 1) Try to find the composer immediately after clicking the action-row comment button.
    // 2) If not found, do a small local scroll search (bounded) to avoid ending up deep in the comments list.
    const scanSteps = Number(process.env.COMPOSER_SCAN_STEPS || '6');
    const scanStepPx = Number(process.env.COMPOSER_SCAN_STEP_PX || '450');

    let scanStepsUsed = 0;
    let form = page.locator('form.comments-comment-box__form').first();
    let box = page.locator('form.comments-comment-box__form .ql-editor[role="textbox"]:visible').first();

    for (let i = 0; i < scanSteps; i++) {
      scanStepsUsed = i;
      form = page.locator('form.comments-comment-box__form').first();
      box = page.locator('form.comments-comment-box__form .ql-editor[role="textbox"]:visible').first();
      const ok = await box.isVisible().catch(() => false);
      if (ok) break;
      if (i < scanSteps - 1) {
        await page.evaluate((px) => window.scrollBy(0, px), scanStepPx).catch(() => {});
        await page.waitForTimeout(250);
      }
    }

    // Anchor: pick the visible editor we will type into, then derive its closest composer form.
    // This prevents accidentally scrolling to a different composer further down the page.
    const fallbackBox = page.locator('div[role="textbox"]:visible').first();
    let boxSelectorUsed = 'ql-editor';

    if (await box.isVisible().catch(() => false)) {
      await box.scrollIntoViewIfNeeded().catch(() => {});
      await box.click();
    } else {
      boxSelectorUsed = 'role=textbox';
      await fallbackBox.waitFor({ state: 'visible' });
      await fallbackBox.scrollIntoViewIfNeeded().catch(() => {});
      await fallbackBox.click();
    }

    // Recompute form from the focused editor element.
    const formHandle = await page.evaluateHandle(() => {
      const el = document.activeElement;
      if (!el) return null;
      return el.closest && el.closest('form.comments-comment-box__form');
    }).catch(() => null);
    if (formHandle) {
      form = page.locator('form.comments-comment-box__form').filter({ has: page.locator('#does-not-exist') });
      // Use a scoped locator via evaluate (we can't directly convert handle→locator reliably),
      // so we later scope submit selection using DOM evaluation.
    }

    // Clear + type
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(commentText, { delay: 20 });

    // Nudge Quill/LinkedIn editor state on the actual .ql-editor when present.
    await page
      .evaluate(() => {
        const el = document.querySelector('form.comments-comment-box__form .ql-editor[role="textbox"]') ||
          document.querySelector('div[role="textbox"]');
        if (!el) return;
        const opts = { bubbles: true, composed: true };
        try { el.dispatchEvent(new InputEvent('input', opts)); } catch {}
        el.dispatchEvent(new Event('input', opts));
        el.dispatchEvent(new Event('change', opts));
        el.dispatchEvent(new Event('keyup', opts));
      })
      .catch(() => {});

    // IMPORTANT: pick the BLUE submit button inside the active composer.
    // UI variants include:
    // - comments-comment-box__submit-button
    // - comments-comment-box__submit-button--cr
    // The submit button often appears only after the editor is non-empty.
    // Scope to the composer with :focus-within so we don't match other posts.

    const scopedSubmit = page
      .locator('form.comments-comment-box__form:has(:focus-within) button[class*="comments-comment-box__submit-button"]:visible')
      .first();

    await scopedSubmit.waitFor({ state: 'visible' });

    // Center the active textbox (not the submit button) to avoid scrolling below the field.
    await page
      .evaluate(() => {
        const active = document.activeElement;
        if (!active) return;
        active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      })
      .catch(() => {});
    await page.waitForTimeout(300);

    const bb = await scopedSubmit.boundingBox();
    if (!bb) throw new Error('No bounding box for submit button');

    const centerX = bb.x + bb.width / 2;
    const centerY = bb.y + bb.height / 2;

    // Optional marker to visually confirm the computed point.
    await page
      .evaluate(
        ({ x, y }) => {
          const id = 'openclaw-click-marker';
          const old = document.getElementById(id);
          if (old) old.remove();
          const marker = document.createElement('div');
          marker.id = id;
          marker.style.position = 'fixed';
          marker.style.left = `${x - 6}px`;
          marker.style.top = `${y - 6}px`;
          marker.style.width = '12px';
          marker.style.height = '12px';
          marker.style.background = 'red';
          marker.style.border = '2px solid white';
          marker.style.borderRadius = '50%';
          marker.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.4)';
          marker.style.zIndex = '2147483647';
          marker.style.pointerEvents = 'none';
          document.body.appendChild(marker);
        },
        { x: centerX, y: centerY }
      )
      .catch(() => {});

    const win = await page.evaluate(() => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerHeight: window.outerHeight,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }));

    const uiOffset = win.outerHeight && win.innerHeight ? win.outerHeight - win.innerHeight : 0;

    const scrollInfo = await page.evaluate(() => ({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement?.scrollHeight || document.body?.scrollHeight || null,
    })).catch(() => ({}));

    const payload = {
      postUrl,
      submitText: await scopedSubmit.innerText().catch(() => null),
      submitClass: await scopedSubmit.getAttribute('class').catch(() => null),
      boxSelectorUsed,
      // scan telemetry
      scanStepsUsed,
      scanStepPx,
      scrollInfo,
      // viewport coords
      centerX,
      centerY,
      // window metrics
      screenX: win.screenX,
      screenY: win.screenY,
      uiOffset,
      devicePixelRatio: win.devicePixelRatio,
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
