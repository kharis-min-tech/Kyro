/**
 * Capture the screenshots used in the Kyro user guide.
 *
 * Signs in to Demo mode as the built-in admin and saves a light and a dark
 * version of every page into public/screenshots/ (name.png + name-dark.png).
 * Re-run whenever the dashboard changes so the guide stays accurate.
 *
 *   BASE_URL=http://localhost:8787 FIREFOX_PATH=/path/to/firefox npm run screenshots
 *
 * BASE_URL must serve the built dashboard (dashboard/out) — ideally through
 * `wrangler dev` so /api/* (notifications) works too.
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const FIREFOX = process.env.FIREFOX_PATH;
if (!FIREFOX) throw new Error("Set FIREFOX_PATH to a Firefox binary");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "screenshots");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

async function byText(page, tag, text, timeout = 15000) {
  return page.waitForSelector(`xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`, { timeout });
}

async function shot(page, name, theme, opts = {}) {
  const file = join(OUT, `${name}${theme === "dark" ? "-dark" : ""}.png`);
  if (opts.element) await opts.element.screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log("  ✓", file.split("/screenshots/")[1]);
}

async function go(page, path, settle = 1500) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await sleep(settle);
}

/** Answer (and so clear) any AI question card so it doesn't clutter shots. */
async function clearQuestions(page) {
  for (let i = 0; i < 3; i++) {
    const btn = await page.$("xpath/.//*[contains(., 'Kyro needs input')]/ancestor::div[contains(@class,'fixed')][1]//button[not(@aria-label) and string-length(normalize-space(.)) > 3]");
    if (!btn) return;
    await btn.click().catch(() => {});
    await sleep(500);
  }
}

async function run(theme) {
  console.log(`\n${theme} theme`);
  const browser = await puppeteer.launch({
    browser: "firefox", executablePath: FIREFOX, headless: true,
    extraPrefsFirefox: {
      "permissions.default.desktop-notification": 1,
      "dom.push.enabled": true,
      "dom.push.serverURL": "wss://push.services.mozilla.com/",
      "dom.push.connection.enabled": true,
    },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ── Login screens ──
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle0" });
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("kyro_theme", t); }, theme);
  await go(page, "/login/");
  await shot(page, "login", theme);
  await (await byText(page, "button", "Live mode")).click();
  await sleep(600);
  await page.type('input[autocomplete="username"]', "admin");
  await page.type('input[autocomplete="current-password"]', "MyPassword1");
  await (await page.$('button[aria-label="Show password"]')).click();
  await sleep(300);
  await shot(page, "login-live", theme);
  await (await byText(page, "button", "Back")).click();
  await sleep(500);
  await (await byText(page, "button", "Demo mode")).click();
  await sleep(600);
  await shot(page, "login-demo", theme);
  await (await byText(page, "button", "Full access")).click();
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await page.evaluate((t) => localStorage.setItem("kyro_theme", t), theme);

  // ── AI question (arrives ~8s after a Demo admin signs in) ──
  try {
    const card = await page.waitForSelector("xpath/.//*[contains(., 'Kyro needs input')]/ancestor::div[contains(@class,'fixed')][1]", { timeout: 25000 });
    await sleep(800);
    await shot(page, "ai-question", theme, { element: card });
    await clearQuestions(page);
  } catch { console.log("  (no AI question appeared)"); }

  // ── AI Count ──
  await go(page, "/attendance/", 2500);
  await clearQuestions(page);
  await shot(page, "ai-count", theme);
  const arrivals = await page.$("xpath/.//p[contains(., 'Arrival') and contains(., 'exit times')]/ancestor::div[contains(@class,'rounded-2xl')][1]");
  if (arrivals) { await arrivals.scrollIntoView(); await sleep(400); await shot(page, "arrival-times", theme, { element: arrivals }); }

  // ── Manual Count (seeded with realistic counts for today) ──
  const now = Math.floor(Date.now() / 1000);
  await page.evaluate((sid, now) => {
    const rec = (id, zone, count, by, mins, approved) => ({
      id, zone, count, counted_by: by, counted_at: now - mins * 60, session_id: sid,
      camera_also_counting: false, approved,
      ...(approved ? { approved_at: now - 5 * 60, approved_by: "admin" } : {}),
    });
    localStorage.setItem("kyro_demo_manual_counts", JSON.stringify([
      rec("mc-1", "Overflow Room", 64, "Grace", 12, false),
      rec("mc-2", "Mothers' Room", 18, "Grace", 20, false),
      rec("mc-3", "Youth Hall", 112, "Daniel", 25, false),
      rec("mc-4", "Prayer Room", 9, "Daniel", 40, true),
    ]));
  }, today, now);
  await go(page, "/manual-count/");
  await shot(page, "manual-count", theme);
  const approve = await page.$("xpath/.//button[contains(., 'Approve final count')]");
  if (approve) {
    await approve.click(); await sleep(600);
    await shot(page, "manual-count-approve", theme);
    await (await byText(page, "button", "Not yet")).click();
  }

  // ── Other pages ──
  for (const [path, name, settle] of [
    ["/live-cameras/", "live-cameras", 2500],
    ["/seating/", "seat-map", 2500],
    ["/cameras/", "cameras", 1500],
    ["/layout-editor/", "seat-editor", 2000],
    ["/sessions/", "sessions", 1500],
    ["/analytics/", "analytics", 2500],
    ["/users/", "users", 1500],
  ]) {
    await go(page, path, settle);
    await clearQuestions(page);
    await shot(page, name, theme);
  }

  // Rota — open the manual entry form
  await go(page, "/rota/");
  const addManual = await page.$("xpath/.//button[contains(., 'Add entry manually')]");
  if (addManual) { await addManual.click(); await sleep(600); }
  await shot(page, "rota", theme);

  // Integrations — with an example webhook URL typed in
  await go(page, "/integrations/");
  await page.type('input[type="url"]', "https://hooks.zapier.com/hooks/catch/123456/abcdef/");
  await sleep(300);
  await shot(page, "integrations", theme);

  // Notifications — turned on, so the full set of cards shows
  await go(page, "/notifications/");
  await shot(page, "notifications-off", theme);
  const on = await page.$("xpath/.//button[contains(., 'Turn on')]");
  if (on) {
    await on.click();
    await page.waitForSelector("xpath/.//*[contains(., 'Notifications enabled')]", { timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  await shot(page, "notifications", theme);
  // Crop to the two cards that matter: the lock-screen test and the list of
  // alerts that reach a closed app.
  const lockCard = await page.$("xpath/.//p[contains(., 'Test with your phone locked')]/ancestor::div[contains(@class,'rounded-2xl')][1]");
  const reachCard = await page.$("xpath/.//p[contains(., 'reach you while Kyro is closed')]/ancestor::div[contains(@class,'rounded-2xl')][1]");
  if (lockCard && reachCard) {
    await lockCard.scrollIntoView(); await sleep(400);
    const a = await lockCard.boundingBox(), b = await reachCard.boundingBox();
    // boundingBox() is relative to the viewport; clip is relative to the page.
    const scrollY = await page.evaluate(() => window.scrollY);
    const pad = 16, x = Math.min(a.x, b.x) - pad, y = Math.min(a.y, b.y) - pad + scrollY;
    const clip = { x, y, width: Math.max(a.x + a.width, b.x + b.width) + pad - x, height: Math.max(a.y + a.height, b.y + b.height) + scrollY + pad - y };
    await page.screenshot({ path: join(OUT, `notifications-tests${theme === "dark" ? "-dark" : ""}.png`), clip });
    console.log("  ✓ notifications-tests (cropped)");
  }

  // ── Phone-sized views ──
  await page.setViewport({ width: 390, height: 844 });
  await go(page, "/manual-count/");
  await shot(page, "phone-manual-count", theme);
  const menu = await page.$('button[aria-label="Open menu"]');
  if (menu) { await menu.click(); await sleep(600); await shot(page, "phone-menu", theme); }

  await browser.close();
}

await run("light");
await run("dark");
console.log("\nDone.");
