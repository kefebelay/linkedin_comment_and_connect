const { chromium } = require('playwright');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const profileUrl = process.argv[2];

  if (!profileUrl) {
    console.log(JSON.stringify({ ok: false, error: 'profileUrl required' }));
    return;
  }

  // Skip company pages entirely.
  if (/\/company\//i.test(profileUrl)) {
    console.log(
      JSON.stringify({ ok: true, profileUrl, connectionSent: false, reason: 'skipped_company_url' })
    );
    return;
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || (await browser.newContext());
  // Avoid reusing an existing page that may get closed by the user/browser.
  const page = await context.newPage();

  const result = {
    ok: true,
    profileUrl,
    connectionSent: false,
    reason: null
  };

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await sleep(500);

    // If already connected/pending, do nothing.
    // IMPORTANT: use isVisible() not count(); lots of hidden/irrelevant elements can match.
    // Also: do NOT treat the always-present "Message" CTA as already-connected.
    const already = page
      .locator('button, a')
      .filter({ hasText: /\bpending\b|\bconnected\b|\bwithdraw\b|\bremove connection\b/i })
      .first();
    if (await already.isVisible().catch(() => false)) {
      result.reason = 'already_connected_or_pending';
      console.log(JSON.stringify(result));
      await browser.close();
      return;
    }

    // 1) Prefer the *direct page* connect anchor/button inside the relationship-building component.
    // This variant is typically an <a> without role=button.
    const directConnect = page
      .locator(
        '[data-view-name="relationship-building-button"] [data-view-name="edge-creation-connect-action"] a[aria-label*="Invite"], [data-view-name="edge-creation-connect-action"] a:has-text("Connect")'
      )
      .first();

    if (await directConnect.isVisible().catch(() => false)) {
      const href = await directConnect.getAttribute('href').catch(() => null);
      // If it's a link to /preload/custom-invite/, clicking can be flaky; navigate directly.
      if (href && href.startsWith('/preload/custom-invite/')) {
        await page.goto(`https://www.linkedin.com${href}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await sleep(1200);
      } else {
        await directConnect.click({ timeout: 10000, force: true });
        await sleep(900);
      }
    } else {
      // 2) Otherwise, open overflow menu (More / ...) and look for a Connect menu item.
      // Click can be blocked by pointer-event interceptors on LinkedIn; keyboard open is more reliable.
      const overflow = page
        .locator(
          '[data-view-name="profile-overflow-button"] button[aria-label="More"], button[aria-label="More"], button:has-text("More")'
        )
        .first();

      if (await overflow.isVisible().catch(() => false)) {
        await overflow.focus().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        await sleep(250);
        // Fallback
        await page.keyboard.press('Space').catch(() => {});
        await sleep(900);
      }

      const menuConnect = page
        .locator(
          '[data-view-name="edge-creation-connect-action"] a[role="menuitem"], a[role="menuitem"]:has(p:has-text("Connect")), a[role="menuitem"]:has-text("Connect")'
        )
        .first();

      if (!(await menuConnect.isVisible().catch(() => false))) {
        const follow = page.locator('button, a').filter({ hasText: /^\s*Follow\s*$/i }).first();
        if (await follow.isVisible().catch(() => false)) {
          result.reason = 'follow_only_no_connect';
        } else {
          result.reason = 'connect_not_available';
        }
        console.log(JSON.stringify(result));
        await browser.close();
        return;
      }

      const href = await menuConnect.getAttribute('href').catch(() => null);
      if (href && href.startsWith('/preload/custom-invite/')) {
        await page.goto(`https://www.linkedin.com${href}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await sleep(900);
      } else {
        await menuConnect.click({ timeout: 10000, force: true });
        await sleep(900);
      }
    }

    // If an invite flow/dialog appears with a "Send" button, click it.
    // LinkedIn often shows a modal with primary action "Send without a note".
    const inviteModal = page
      .locator('[data-test-modal-id="send-invite-modal"], #artdeco-modal-outlet [role="dialog"].send-invite')
      .first();
    if (await inviteModal.isVisible().catch(() => false)) {
      const sendWithoutNote = inviteModal
        .locator('button[aria-label="Send without a note"], button:has-text("Send without a note")')
        .first();
      if (await sendWithoutNote.isVisible().catch(() => false)) {
        await sendWithoutNote.click({ timeout: 15000 });
        await sleep(1500);
      }
    }

    // Fallback: plain "Send" button variants.
    const sendBtn = page.locator('button').filter({ hasText: /^\s*Send\s*$/i }).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click({ timeout: 15000 });
      await sleep(1500);
    } else {
      const sendAny = page.getByRole('button', { name: /send/i }).first();
      if (await sendAny.isVisible().catch(() => false)) {
        await sendAny.click({ timeout: 15000 });
        await sleep(1500);
      }
    }

    // Confirm by navigating back to the profile and checking for Pending.
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1200);

    const pending = page
      .locator('button, a, p, span')
      .filter({ hasText: /^\s*Pending\s*$/i })
      .first();
    if (await pending.isVisible().catch(() => false)) {
      result.connectionSent = true;
      result.reason = 'pending_confirmed';
    } else {
      result.connectionSent = false;
      result.reason = 'no_pending_confirmation';
    }

    console.log(JSON.stringify(result));
    await browser.close();
  } catch (e) {
    result.ok = false;
    result.error = typeof e?.message === 'string' ? e.message : String(e);
    console.log(JSON.stringify(result));
    await browser.close();
  }
}

main();