/**
 * "this data is not correct, nor is it functional" — a zone table with
 * three rows for two cameras:
 *
 *     HuddleCamHD (2e7e:0737)      now 0   peak 0
 *     HD Pro Webcam C920 …         now 0   peak 0
 *     HuddleCamHD (2e7e:0737)      now 2   peak 4
 *
 * The first and third are the same camera in the same socket.
 *
 * A camera is keyed by a hash of the deviceId the browser gives it, and a
 * browser hands out a NEW deviceId when its site data is cleared or when
 * camera permission is granted again. The same camera then arrives as
 * somebody new, and the record it had before stays where it is — in the
 * list, in the table, and in anything that adds rooms together.
 *
 * The one left behind is recognisable: same computer, same name, never
 * counted a single person, and not reporting while its twin is. That is
 * not a camera, it is the ghost of one.
 *
 * It is hidden, never deleted, and only while the live twin is actually
 * there — unplug the real one and the old row comes back rather than the
 * room disappearing. A camera somebody has set up (a seat count entered,
 * a room named) is never hidden, whatever it has counted.
 *
 *   node tests/test_one_camera_one_row.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-twin-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const now = Date.now();
const cam = (key, name, extra = {}) => ({
  camera_id: `box:${key}`, device_id: "box", key, kind: "usb", name, zone_name: name,
  zone_capacity: 0, zone_order: 1, location: "indoor", hidden: false, pending: false, ...extra,
});
function hub(cams, live, devices = { box: { id: "box", name: "the office computer" } }) {
  const store = new Map([
    ["cameras", Object.fromEntries(cams.map((c) => [c.camera_id, c]))],
    ["live", live],
    ["devices", devices],
  ]);
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async () => {}, delete: async () => {} } };
  h.seenAt = new Map();          // which cameras have reported to this copy
  return h;
}
const reporting = { updated_at: now, status: "ok", current: 2, peak: 4 };
const gone = { updated_at: now - 60 * 60_000, status: "ok", current: 0, peak: 0 };

// ── The ghost goes, the camera stays ──────────────────────────────────────
{
  const list = await hub(
    [cam("web-old", "HuddleCamHD (2e7e:0737)"), cam("web-new", "HuddleCamHD (2e7e:0737)"),
     cam("web-c920", "HD Pro Webcam C920 (046d:08e5)")],
    { "box:web-new": reporting, "box:web-old": gone, "box:web-c920": gone },
  ).cameraList();
  ok("the same camera twice becomes one row", list.length === 2, `${list.length} rows`);
  ok("and it is the live one that stays",
     list.some((c) => c.camera_id === "box:web-new") && !list.some((c) => c.camera_id === "box:web-old"));
  ok("the other camera is untouched, though it is quiet too",
     list.some((c) => c.camera_id === "box:web-c920"));
}

// ── Nothing is hidden without a live twin ─────────────────────────────────
{
  const list = await hub(
    [cam("web-old", "HuddleCamHD (2e7e:0737)"), cam("web-new", "HuddleCamHD (2e7e:0737)")],
    { "box:web-new": gone, "box:web-old": gone },
  ).cameraList();
  ok("with neither reporting, both rows stay", list.length === 2, `${list.length}`);
}
{
  // The same name on a DIFFERENT computer is a different camera.
  const two = [cam("web-a", "HuddleCamHD (2e7e:0737)"),
               { ...cam("web-b", "HuddleCamHD (2e7e:0737)"), camera_id: "pi:web-b", device_id: "pi" }];
  const list = await hub(two, { "box:web-a": reporting, "pi:web-b": gone },
                         { box: { id: "box" }, pi: { id: "pi" } }).cameraList();
  ok("the same name on another computer is another camera", list.length === 2, `${list.length}`);
}

// ── A camera somebody set up is never a ghost ─────────────────────────────
{
  const list = await hub(
    [cam("web-old", "HuddleCamHD (2e7e:0737)", { zone_capacity: 90, capacity_from: "admin" }),
     cam("web-new", "HuddleCamHD (2e7e:0737)")],
    { "box:web-new": reporting, "box:web-old": gone },
  ).cameraList();
  ok("one with a seat count somebody entered keeps its row", list.length === 2, `${list.length}`);
}
{
  // …nor is one that has actually counted somebody, however long ago.
  const list = await hub(
    [cam("web-old", "HuddleCamHD (2e7e:0737)"), cam("web-new", "HuddleCamHD (2e7e:0737)")],
    { "box:web-new": reporting, "box:web-old": { ...gone, peak: 7 } },
  ).cameraList();
  ok("one that counted people once keeps its row", list.length === 2, `${list.length}`);
}

// ── Nothing is deleted ────────────────────────────────────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const fn = worker.slice(worker.indexOf("async cameraList("), worker.indexOf("\n  async ", worker.indexOf("async cameraList(") + 10));
  ok("the ghost is filtered out of the list, not removed from the store",
     /\.filter\(\(c\) => includeHidden \|\| !ghost\(c\)\)/.test(fn)
     && !/storage\.delete/.test(fn));
  ok("and asking for everything still shows it",
     /includeHidden \|\| !ghost\(c\)/.test(fn));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One camera, one row.");
process.exit(fails ? 1 : 0);
