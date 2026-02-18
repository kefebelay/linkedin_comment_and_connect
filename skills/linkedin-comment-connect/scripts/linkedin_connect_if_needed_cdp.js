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
  const page = context.pages()[0] || (await context.newPage());

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

    // If already connected / pending / message, do nothing.
    const already = page
      .locator('button, a')
      .filter({ hasText: /\bmessage\b|\bpending\b|\bin mail\b|\bconnected\b/i })
      .first();
    if (await already.count()) {
      result.reason = 'already_connected_or_pending';
      console.log(JSON.stringify(result));
      await browser.close();
      return;
    }

    // If already following + Connect is not directly visible, Connect may be under the overflow (...) menu.
    // Requirement: if it's a Follow button, don't click Follow; but we MAY still try connecting via More.

    // If Connect is directly visible on-page, prefer that.
    const directConnect = page.locator('[data-view-name="edge-creation-connect-action"]').first();
    if (await directConnect.isVisible().catch(() => false)) {
      await directConnect.click({ timeout: 10000 });
      await sleep(600);
    } else {
      // Click overflow menu (More / ...)
      const overflow = page.locator('[data-view-name="profile-overflow-button"] button[aria-label="More"], button[aria-label="More"], button:has-text("More")').first();
      if (await overflow.isVisible().catch(() => false)) {
        await overflow.click({ timeout: 10000 });
        await sleep(500);
      }

      // In the menu, Connect is often an <a role="menuitem"> with data-view-name edge-creation-connect-action.
      const menuConnect = page.locator('a[role="menuitem"][data-view-name="edge-creation-connect-action"], [data-view-name="edge-creation-connect-action"] a[role="menuitem"], a[role="menuitem"]:has-text("Connect")').first();
      if (!(await menuConnect.isVisible().catch(() => false))) {
        // If Follow is present and Connect isn't in overflow, do nothing.
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

      await menuConnect.click({ timeout: 10000 });
      await sleep(700);
    }

    // If a dialog appears with "Send" button, click it.
    const sendBtn = page.getByRole('button', { name: /^\s*Send\s*$/i }).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click({ timeout: 10000 });
      await sleep(1200);
    }

    // Confirm by presence of Pending state somewhere near actions/menu.
    // On success, LinkedIn typically changes Connect -> Pending.
    const pending = page.locator('button, a, p, span').filter({ hasText: /^\s*Pending\s*$/i }).first();
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
