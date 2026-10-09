// Records a guided tour of Kyro (Demo mode) with a visible cursor, click
// ripples and step captions. Output: a WebM from Playwright, converted to
// MP4 afterwards with ffmpeg.
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "https://kyro.kharischurch.com";
const GUIDE = process.env.GUIDE_URL ?? "https://kyro-help.kharischurch.com";
const OUT_DIR = process.argv[2];
// Camera Mode needs a camera: a still picture played as a pretend webcam.
const CAMERA_Y4M = process.argv[3] ?? process.env.CAMERA_Y4M;
import { writeFileSync } from "node:fs";
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Overlay injected into every page: cursor, ripple, caption bar, title card ──
const OVERLAY = `
(() => {
  const css = \`
    #tour-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
      transition:transform var(--t,700ms) cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    .tour-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;
      border:3px solid #818cf8;background:rgba(129,140,248,.25);animation:tour-r .6s ease-out forwards}
    @keyframes tour-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #tour-caption{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;
      max-width:900px;padding:12px 22px;border-radius:14px;background:rgba(15,17,35,.92);color:#fff;
      font:500 19px/1.35 Inter,system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);
      border:1px solid rgba(129,140,248,.45);display:none;text-align:center}
    #tour-caption b{color:#a5b4fc;font-weight:700;margin-right:8px}
    #tour-title{position:fixed;inset:0;z-index:2147483644;display:none;align-items:center;justify-content:center;flex-direction:column;
      background:radial-gradient(circle at 50% 40%,#2b2a6b 0%,#0d0f1a 70%);color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center}
    #tour-title h1{font-size:64px;margin:0 0 12px;font-weight:800;letter-spacing:-1px}
    #tour-title p{font-size:24px;margin:0;color:#c7d2fe}
    #tour-title small{margin-top:28px;font-size:16px;color:#8b93c9}\`;
  function mount() {
    if (document.getElementById("tour-cursor")) return;
    const st = document.createElement("style"); st.textContent = css; document.documentElement.appendChild(st);
    const c = document.createElement("div"); c.id = "tour-cursor";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-3 1.6-3.9-7.5L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const cap = document.createElement("div"); cap.id = "tour-caption"; document.documentElement.appendChild(cap);
    const t = document.createElement("div"); t.id = "tour-title"; document.documentElement.appendChild(t);
    const pos = JSON.parse(sessionStorage.getItem("tour-pos") || '{"x":640,"y":360}');
    c.style.setProperty("--t", "0ms"); c.style.transform = \`translate(\${pos.x}px,\${pos.y}px)\`;
    const capSaved = sessionStorage.getItem("tour-cap");
    if (capSaved) { cap.innerHTML = capSaved; cap.style.display = "block"; }
  }
  window.__tourMove = (x, y, ms) => { mount(); const c = document.getElementById("tour-cursor");
    c.style.setProperty("--t", ms + "ms"); c.style.transform = \`translate(\${x}px,\${y}px)\`;
    sessionStorage.setItem("tour-pos", JSON.stringify({ x, y })); };
  window.__tourRipple = (x, y) => { mount(); const r = document.createElement("div"); r.className = "tour-ripple";
    r.style.left = x + "px"; r.style.top = y + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); };
  window.__tourCaption = (html) => { mount(); const cap = document.getElementById("tour-caption");
    if (!html) { cap.style.display = "none"; sessionStorage.removeItem("tour-cap"); return; }
    cap.innerHTML = html; cap.style.display = "block"; sessionStorage.setItem("tour-cap", html); };
  window.__tourTitle = (h, p, s) => { mount(); const t = document.getElementById("tour-title");
    if (!h) { t.style.display = "none"; return; }
    t.innerHTML = \`<h1>\${h}</h1><p>\${p || ""}</p>\${s ? "<small>" + s + "</small>" : ""}\`; t.style.display = "flex"; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();`;

const browser = await chromium.launch({
  args: CAMERA_Y4M ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${CAMERA_Y4M}`] : [],
});
const contextOpts = { viewport: { width: W, height: H }, colorScheme: "dark", permissions: ["camera", "clipboard-read", "clipboard-write"], serviceWorkers: "block" };
// Show the pretend webcam under a friendly name instead of its file path.
const CAMERA_NAME = () => {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return;
  const orig = md.enumerateDevices.bind(md);
  md.enumerateDevices = async () => (await orig()).map((d) => d.kind !== "videoinput" ? d
    : { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: "Main Hall camera", toJSON() { return this; } });
};
const context = await browser.newContext({ ...contextOpts, recordVideo: { dir: OUT_DIR, size: { width: W, height: H } } });
await context.addInitScript(CAMERA_NAME);
// Warm-up page (its recording is thrown away): download Camera Mode's AI once
// into this browser, so the tour doesn't sit on "Downloading the AI model".
{
  const wp = await context.newPage();
  await wp.goto(APP + "/login/");
  await wp.evaluate(() => { localStorage.clear(); localStorage.setItem("kyro_mode", "demo"); localStorage.setItem("kyro_token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo5OTk5OTk5OTk5fQ.demo_signature_not_verified"); localStorage.setItem("kyro_demo_role", "admin"); sessionStorage.setItem("kyro_active_login", "1"); });
  await wp.goto(APP + "/camera-mode/");
  await wp.getByRole("button", { name: /Start counting/ }).click().catch(() => {});
  for (let i = 0; i < 90; i++) { await sleep(2000); if (/Counts every/.test(await wp.locator("main").innerText().catch(() => ""))) break; }
  await wp.close();
}

await context.addInitScript(OVERLAY);
await context.addInitScript(() => {
  try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch {}
});
const page = await context.newPage();
// When each narrated part starts (seconds into the video) — narrate-tour.py
// lines the voice-over up with these.
const t0 = Date.now();
const timeline = [];
const mark = (id) => timeline.push({ id, t: +((Date.now() - t0) / 1000).toFixed(2) });

// ── Helpers ──
const caption = async (step, text) => page.evaluate(([s, t]) => window.__tourCaption(s ? `<b>${s}</b>${t}` : t), [step, text]);
const hideCaption = () => page.evaluate(() => window.__tourCaption(null));
async function moveTo(locator, ms = 750) {
  if (!(await locator.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false))) return null;
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const b = await locator.boundingBox({ timeout: 3000 }).catch(() => null);
  if (!b) return null;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.evaluate(([x, y, ms]) => window.__tourMove(x, y, ms), [x, y, ms]);
  await sleep(ms + 150);
  await page.mouse.move(x, y);
  return { x, y };
}
// Demo raises AI questions every few minutes; quietly answer any that pop up
// later so their cards never sit on top of the next thing we click.
let answering = false;
async function clearQuestions() {
  if (answering) return;
  answering = true;
  try {
    for (let i = 0; i < 4; i++) {
      if (!(await page.getByText("Kyro needs input").first().isVisible().catch(() => false))) break;
      // The answer buttons are the only ones labelled like this.
      const btn = page.getByRole("button", { name: /^(Ignore|Yes|No —)/ }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click({ timeout: 3000 }).catch(() => {});
      await sleep(500);
    }
  } finally { answering = false; }
}
async function click(locator, pause = 700) {
  await clearQuestions();
  const p = await moveTo(locator);
  if (p) await page.evaluate(([x, y]) => window.__tourRipple(x, y), [p.x, p.y]);
  await sleep(180);
  await locator.click({ timeout: 6000 }).catch(async () => {
    await clearQuestions();
    await locator.click({ force: true, timeout: 6000 });
  });
  await sleep(pause);
}
async function type(locator, text) {
  await click(locator, 200);
  await page.keyboard.type(text, { delay: 70 });
  await sleep(400);
}
async function go(path) {
  await page.goto(APP + path, { waitUntil: "networkidle" });
  await sleep(600);
}
async function nav(label) {
  await click(page.locator("aside, nav").getByRole("link", { name: label, exact: true }).first(), 1600);
}
async function smoothScroll(y, ms = 900) {
  await page.evaluate(([y, ms]) => new Promise((res) => {
    const el = document.querySelector("main") ?? document.scrollingElement;
    const start = el.scrollTop, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); el.scrollTop = start + (y - start) * (0.5 - Math.cos(Math.PI * k) / 2); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [y, ms]);
  await sleep(250);
}

// ── Title ──
await page.goto(APP + "/login/", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("kyro_theme", "dark"); });
await page.goto(APP + "/login/", { waitUntil: "networkidle" });
await page.evaluate(() => window.__tourTitle("Kyro", "A quick tour of the main features", "Live attendance · seating · alerts — Kharis Church"));
mark("intro");
await sleep(3800);
await page.evaluate(() => window.__tourTitle(null));
await sleep(400);

// ── Help is always one tap away ──
mark("help");
await caption("Tip", "Stuck at any point? Tap <i>Help</i> — the guide opens even before you sign in");
await moveTo(page.getByRole("link", { name: /Help/ }).first());
await sleep(3200);

// ── 1. Sign in ──
mark("signin");
await caption("Step 1", "Open Kyro and choose <i>Demo mode</i> to explore with sample data");
await sleep(2200);
await click(page.getByRole("button", { name: /Demo mode/ }), 1200);
await caption("Step 1", "Pick an account — <i>admin</i> can see every page");
await sleep(1800);
await click(page.getByRole("button", { name: /Full access/ }), 2500);

// ── 2. AI questions — Demo asks the first one ~8s after signing in ──
{
  const question = page.getByText("Kyro needs input").first();
  mark("ai_question");
  await caption("Step 2 · AI questions", "Kyro opens on <i>AI Count</i>. Within a few seconds the AI may ask you something…");
  if (await question.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) {
    await caption("Step 2 · AI questions", "When the AI isn't sure, it asks you — just tap the answer");
    await moveTo(question);
    await sleep(2800);
    const answer = page.getByRole("button", { name: /^Yes/ }).first();
    const pa = await moveTo(answer);
    if (pa) await page.evaluate(([x, y]) => window.__tourRipple(x, y), [pa.x, pa.y]);
    await answer.click({ timeout: 6000 }).catch(() => {});
    await caption("Step 2 · AI questions", "Your answer teaches Kyro — it won't ask the same thing again");
    await sleep(2400);
    await clearQuestions();
  }
}

// ── 2. AI Count ──
mark("ai_count");
await caption("Step 3 · AI Count", "How many people are in the building right now");
await moveTo(page.getByText(/Total people in building/i).first());
await sleep(2500);
await caption("Step 3 · AI Count", "Switch what the chart shows — people, occupancy, entries or exits");
// Open a menu (retrying if a pop-up got in the way), then pick an option.
async function pick(menuButton, option, pause) {
  for (let i = 0; i < 3; i++) {
    await click(menuButton, 700);
    if (await option.isVisible().catch(() => false)) { await click(option, pause); return; }
    await clearQuestions();
  }
}
await pick(page.getByRole("button", { name: /People Count/ }).first(), page.getByRole("button", { name: /^Occupancy %$/ }).first(), 1800);
await pick(page.getByRole("button", { name: /Occupancy %/ }).first(), page.getByRole("button", { name: /^People Count$/ }).first(), 1200);

mark("arrivals");
await caption("Step 4 · Arrival times", "See when people arrive and leave the most");
const arrivals = page.getByText("Arrival & exit times").first();
await moveTo(arrivals);
await sleep(1500);
await moveTo(page.getByText("Busiest arrival time").first());
await sleep(2200);
await click(page.getByRole("button", { name: "30 min" }), 1500);
const bars = page.locator('svg[role="img"] rect[fill="transparent"]');
if (await bars.count()) { await moveTo(bars.nth(3)); await sleep(1800); }
await caption("Step 4 · Arrival times", "Tap <i>Table</i> to see every time slot as a list");
await click(page.getByRole("button", { name: /Table/ }), 2200);
await click(page.getByRole("button", { name: /Chart/ }), 800);
await smoothScroll(0);

// ── 5. Manual Count ──
mark("manual");
await caption("Step 5 · Manual Count", "Ushers count rooms that don't have a camera");
await nav("Manual Count");
await type(page.locator('input[placeholder^="e.g. Overflow"]'), "Youth Hall");
await caption("Step 5 · Manual Count", "Enter the number — the quick buttons add 5, 10 or 25");
await click(page.getByRole("button", { name: "+25" }), 350);
await click(page.getByRole("button", { name: "+25" }), 350);
await click(page.getByRole("button", { name: "+10" }), 800);
await caption("Step 5 · Manual Count", "Tap <i>Review &amp; submit</i>, check it, then <i>Confirm &amp; save</i>");
await click(page.getByRole("button", { name: /Review & submit/ }), 1300);
await click(page.getByRole("button", { name: /Confirm & save/ }), 1800);
mark("approve");
await caption("Step 6 · Approve", "At the end of the service, approve the final count so it's added to the total");
await click(page.getByRole("button", { name: /Approve final count/ }), 1800);
await click(page.getByRole("button", { name: /^Approve$/ }), 2200);

// ── 7. Live Cameras ──
mark("live_cameras");
await caption("Step 7 · Live Cameras", "Every room at a glance — how full it is and how many seats are left");
await nav("Live Cameras");
await moveTo(page.getByText(/SEATS LEFT/i).first());
await sleep(2200);
await caption("Step 7 · Live Cameras", "<i>Outside queue</i> tells you whether the people waiting will fit");
await moveTo(page.getByText(/OUTSIDE QUEUE/i).first());
await sleep(2600);
const expand = page.getByRole("button", { name: "Expand" }).first();
if (await expand.count()) {
  await caption("Step 7 · Live Cameras", "Open any camera to see that room bigger");
  await click(expand, 2400);
  await click(page.getByRole("button", { name: "Close" }).first(), 900);
}

// ── 8. Camera Mode ──
mark("camera_mode");
await caption("Step 8 · Camera Mode", "Plug a camera into any computer and open <i>Camera Mode</i> — nothing to install");
await nav("Camera Mode");
await sleep(1200);
await caption("Step 8 · Camera Mode", "Press <i>Start counting</i> and allow the camera");
await click(page.getByRole("button", { name: /Start counting/ }), 600);
for (let i = 0; i < 60; i++) { if (/Counts every/.test(await page.locator("main").innerText().catch(() => ""))) break; await sleep(500); }
mark("camera_mode_counting");
await caption("Step 8 · Camera Mode", "Kyro draws a box round everyone it counts — and the count goes to your dashboard");
await moveTo(page.getByText(/people now/).first());
await sleep(1800);
await moveTo(page.locator("video").first());
await sleep(3200);
// Stop before moving on, so the page is quick to respond again.
await page.getByRole("button", { name: /^Stop$/ }).click().catch(() => {});
mark("camera_mode_install");
await caption("Step 8 · Camera Mode", "Want it running without a page open? Copy this one line into the computer's terminal");
const installCard = page.getByText("Want the installed version?").first();
await moveTo(installCard, 900);
await sleep(2400);
await click(page.getByRole("button", { name: /Copy the command/ }), 4200);
await smoothScroll(0);

// ── 9. Seat Map ──
mark("seat_map");
await caption("Step 9 · Seat Map", "Every seat as a dot: red is taken, dark is free, purple is reserved");
await nav("Seat Map");
await sleep(1600);
const freeSeat = page.locator('button[title*="· available"]').first();
await caption("Step 9 · Seat Map", "Tap a free seat to reserve it for a guest");
await click(freeSeat, 1300);
await click(page.getByRole("button", { name: /Reserve Unit/ }), 700);
await page.keyboard.type("Guest speaker", { delay: 70 });
await sleep(500);
await click(page.getByRole("button", { name: /^Confirm$/ }), 2200);

// ── 10. Notifications ──
mark("notifications");
await caption("Step 10 · Notifications", "Turn on alerts once — they reach your phone even when it's locked");
await nav("Notifications");
// Turn on is greyed out in the recording browser (no phone push), so point at
// the card it lives on.
await moveTo(page.getByText(/Notifications (off|enabled)|Browser not supported/).first());
await sleep(2600);
await caption("Step 10 · Notifications", "Choose when Kyro should alert you");
await click(page.getByRole("button", { name: /Adjust thresholds/ }), 2200);

// ── 10. Help guide ──
mark("help_guide");
await caption("Need help?", "<i>Help guide</i> in the menu opens the guide for the page you're on");
await moveTo(page.getByRole("link", { name: /Help guide/ }).first());
await sleep(2800);
await page.goto(GUIDE + "/", { waitUntil: "networkidle" });
await sleep(1200);
await caption("Need help?", "The Kyro guide explains every page, step by step, with pictures");
await sleep(2200);
await click(page.getByRole("link", { name: "Get started" }).first(), 2600);

// ── End card ──
await hideCaption();
mark("end");
await page.evaluate(() => window.__tourTitle("You're ready", "Start in Demo mode, then sign in to Live for the real thing", "Guide: kyro-help.kharischurch.com"));
await sleep(5600);

mark("finish");
writeFileSync(OUT_DIR + "/timeline.json", JSON.stringify(timeline, null, 1));
const video = page.video();
await context.close();
await browser.close();
console.log("WEBM:", await video.path());
