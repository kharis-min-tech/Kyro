/**
 * A seat editor you can only use while something else is running.
 *
 * "still an error" — a third screenshot of the same dark rectangle, this
 * time with the right explanation on it. The words were finally true and
 * she still could not draw a seat layout.
 *
 * Counting happens in a browser. A camera sends pictures only while the
 * Live cameras page is open on the computer it is plugged into — so for
 * most of the week no picture of now exists, and the seat editor refused
 * to show the one it had. It was holding a photograph of the room the
 * whole time.
 *
 * The refusal was right for the reason given: a layout drawn over a
 * photograph of a different day puts every seat in the wrong place. But
 * that is a decision for the person drawing, not for Kyro — the chairs in
 * a church do not move, and only they can see whether the camera has.
 *
 * So the old picture is OFFERED, never taken: a button that appears only
 * when there is one, saying when it was taken, and a band across the top
 * of the canvas afterwards saying it is old and to check the camera hasn't
 * moved. Nothing is drawn on it until somebody asks.
 *
 * Everything else still refuses an old picture outright — a tile, an
 * alert, a question all claim to show NOW, and a picture that outlives
 * what it shows is worse than none.
 *
 *   node tests/test_the_last_picture_is_offered.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-last-"));
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
const quiet = { updated_at: now - 60 * 60_000, status: "ok" };

// ── Asked for, it hands over the old picture ──────────────────────────────
{
  const h = () => hub({ snapAt: now - 3 * 3600_000, live: quiet });
  const refused = await h().getSnapshot("box:a");
  ok("nothing has changed for anybody who did not ask",
     refused.status === 404 && refused.headers.get("X-Kyro-Why") === "offline",
     `${refused.status}`);
  ok("…and the refusal says when the last one was taken, so it can be offered",
     !!refused.headers.get("X-Last-Picture"));

  const given = await h().getSnapshot("box:a", true);
  ok("asked for, the old picture comes back", given.status === 200
     && given.headers.get("Content-Type") === "image/jpeg", `${given.status}`);
  ok("marked as old", given.headers.get("X-Kyro-Old") === "1");
  ok("and dated, so the page can say how old",
     !!given.headers.get("X-Taken-At"));
}

// ── …but there has to BE one ──────────────────────────────────────────────
{
  const none = await hub({ live: quiet }).getSnapshot("box:a", true);
  ok("nothing to offer is still nothing", none.status === 404
     && none.headers.get("X-Kyro-Why") === "never", `${none.status}`);
}

// ── A camera that IS on still gives the live picture ──────────────────────
{
  const fresh = await hub({ snapAt: now - 5_000, live: { updated_at: now, status: "ok" } })
    .getSnapshot("box:a", true);
  ok("a live camera's own picture is not labelled old",
     fresh.status === 200 && fresh.headers.get("X-Kyro-Old") === null);
}

// ── The page offers it rather than taking it ──────────────────────────────
{
  const ed = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatLayoutEditor.tsx"), "utf8");
  ok("it asks only when somebody presses the button",
     /\?last=1/.test(ed) && /const useLastPicture = useCallback\(async \(\) => \{/.test(ed));
  ok("the button appears only when there is an old picture to offer",
     /\{bgError && lastPictureAt && \(/.test(ed));
  ok("and says when it was taken", /Draw on the last picture \(\{lastPictureAt\.toLocaleTimeString/.test(ed));
  ok("the canvas keeps saying it is old, on the picture itself",
     /if \(usingOld\) \{/.test(ed)
     && /This is the last picture Kyro has/.test(ed)
     && /check the camera hasn't moved/.test(ed));
  ok("nothing loads an old picture by itself",
     !/setUsingOld\(true\)[\s\S]{0,200}loadBackgroundFromCamera/.test(ed));
}

// ── Everything else still refuses one ─────────────────────────────────────
// A tile, an alert and a question all claim to show NOW. Only the seat
// editor may ask for an old picture, and only because somebody pressed it.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("only one route may ask for the last picture",
     (worker.match(/getSnapshot\(decodeURIComponent/g) || []).length === 1
     && /url\.searchParams\.get\("last"\) === "1"/.test(worker));
  ok("and it is off unless asked for", /async getSnapshot\(camera_id, lastWillDo = false\)/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The last picture is offered, not taken.");
process.exit(fails ? 1 : 0);
