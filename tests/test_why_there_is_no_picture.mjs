/**
 * "no camera is off" — said over a message reading "This camera is off".
 *
 * She was right. There are three different ways to have no picture to draw
 * a seat layout on, and the canvas said the same wrong thing for all of
 * them — so it sent her to check a camera that was working perfectly.
 *
 *   never    nothing has ever sent a picture of this camera. By far the
 *            commonest, and nothing to do with the camera: a picture only
 *            goes up while something is COUNTING with it, so a camera
 *            plugged in with no counting page open has never sent one.
 *   offline  it was sending and has stopped, or it says it has no picture
 *            — unplugged, while the browser it was plugged into reports on.
 *   stale    it is reporting, but its last picture is too old to draw on.
 *
 * All three end the same way, because the answer is the same: Kyro will not
 * draw a layout over an old photograph, since every seat would land in the
 * wrong place. What changes is what you are being told to go and do.
 *
 * This is the same shape as "the camera had already lost sight of them"
 * under a question about a chair, and "Kyro couldn't follow people reliably
 * on this day" when no camera was set as a doorway. A reason that cannot be
 * true is worse than no reason.
 *
 *   node tests/test_why_there_is_no_picture.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-why-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const now = Date.now();
function hub({ snapAt, live }) {
  const store = new Map();
  if (snapAt !== undefined) store.set("snap:box:a", { at: snapAt, data: new Uint8Array([0xff, 0xd8]) });
  if (live) store.set("live", { "box:a": live });
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); },
                       delete: async (k) => { store.delete(k); } }, waitUntil: () => {} };
  return h;
}
const reportingNow = { updated_at: now, status: "ok" };

// ── The three reasons, each named ─────────────────────────────────────────
{
  // Nothing has ever sent one — the camera is plugged in and fine, but
  // nothing is counting with it.
  let res = await hub({ live: reportingNow }).getSnapshot("box:a");
  ok("never had a picture → 'never'", res.status === 404 && res.headers.get("X-Kyro-Why") === "never",
     `${res.status} / ${res.headers.get("X-Kyro-Why")}`);

  // It was sending and has stopped.
  res = await hub({ snapAt: now, live: { updated_at: now - 60 * 60_000, status: "ok" } }).getSnapshot("box:a");
  ok("stopped sending → 'offline'", res.headers.get("X-Kyro-Why") === "offline",
     `${res.headers.get("X-Kyro-Why")}`);

  // Unplugged: the browser it was plugged into reports on, saying plainly
  // that this camera has no picture.
  res = await hub({ snapAt: now, live: { updated_at: now, status: "error", no_picture: true } }).getSnapshot("box:a");
  ok("unplugged but still reported → 'offline'", res.headers.get("X-Kyro-Why") === "offline",
     `${res.headers.get("X-Kyro-Why")}`);

  // Reporting, but the last picture is too old to draw on.
  res = await hub({ snapAt: now - 10 * 60_000, live: reportingNow }).getSnapshot("box:a");
  ok("reporting with an old picture → 'stale'", res.headers.get("X-Kyro-Why") === "stale",
     `${res.headers.get("X-Kyro-Why")}`);

  // …and a camera that is on, with a fresh picture, hands it over.
  res = await hub({ snapAt: now - 5_000, live: reportingNow }).getSnapshot("box:a");
  ok("on, with a fresh picture → the picture", res.status === 200
     && res.headers.get("Content-Type") === "image/jpeg", `${res.status}`);
  ok("and nothing says why, because nothing is wrong",
     res.headers.get("X-Kyro-Why") === null);
}

// ── …and the canvas says the one it was told ──────────────────────────────
{
  const ed = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatLayoutEditor.tsx"), "utf8");
  ok("the page reads the reason it is given", /res\.headers\.get\("X-Kyro-Why"\)/.test(ed));
  ok("and only trusts one it recognises",
     /told === "never" \|\| told === "offline" \|\| told === "stale" \? told : null/.test(ed));
  ok("there is a sentence for each of the three",
     /NO_PICTURE_BECAUSE: Record<"never" \| "offline" \| "stale", string>/.test(ed));
  ok("the commonest one does not blame the camera",
     /Kyro has never had a picture from this camera\. The camera is probably fine/.test(ed));
  // The sentence is split across source lines, so match it on the text as
  // it will actually read rather than on how it is typed.
  // The joins are a mix of quotes and backticks — the last line of each is
  // a template literal — so both have to be stitched, not just one.
  const asRead = ed.replace(/["`]\s*\n\s*\+\s*["`]/g, "");
  ok("…and says what to do instead",
     /open the Live cameras page on the computer it is plugged into and leave it running/.test(asRead));
  ok("all three still refuse to draw over an old photograph",
     /const WONT_SHOW_AN_OLD_ONE =/.test(ed)
     && (ed.match(/\$\{WONT_SHOW_AN_OLD_ONE\}/g) || []).length === 3);
  // Only the lines that are CODE. The note explaining why it changed quotes
  // the old wording, which is where it belongs — reading the whole file
  // again is the same slip this test made the first time it was written.
  const code = ed.split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l));
  ok("nothing says 'This camera is off' any more",
     !code.some((l) => /This camera is off/.test(l)));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. It says which of the three it is.");
process.exit(fails ? 1 : 0);
