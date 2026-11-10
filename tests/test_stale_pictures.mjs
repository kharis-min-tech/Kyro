/**
 * A camera that is off shows nothing, not Sunday.
 *
 * The Live Cameras page went on showing the last picture each camera sent —
 * a hall full of people, in colour — with the word "Offline" in the corner.
 * A photograph is the most convincing thing on a screen and a label cannot
 * argue with it. The Seat Editor had it worse: it offered that same old
 * picture to draw a seat layout on, which would put every seat in the place
 * somebody happened to be standing on Sunday.
 *
 * And: a deleted service is kept for thirty days and can be brought back.
 * The worker kept them all along; nothing ever showed them, so deleting one
 * looked permanent while a message said it could be recovered.
 *
 *   node tests/test_stale_pictures.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── The picture ────────────────────────────────────────────────────────────
{
  const snap = worker.slice(worker.indexOf("async getSnapshot(camera_id)"), worker.indexOf("// ── Live video"));
  ok("a picture is only served while the camera is reporting",
     /const reporting = this\.isOnline\(live\[camera_id\]\);/.test(snap));
  ok("and only while it is recent", /age > SNAPSHOT_STALE_MS/.test(snap));
  ok("otherwise nothing is served at all", /status: 404/.test(snap));
  ok("but when the last one was is still said", /X-Last-Picture/.test(snap));
  ok("'recent' is minutes, not hours", /const SNAPSHOT_STALE_MS = 3 \* 60_000;/.test(worker));

  const edge = fs.readFileSync(path.join(root, "dashboard/src/lib/edgeVenue.ts"), "utf8");
  ok("the page lets go of the picture it was showing", /setUrl\(null\);\s*\n\s*setTakenAt\(res\.headers\.get\("X-Last-Picture"\)\);/.test(edge));

  const live = fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8");
  ok("and says the camera is off, with when it last sent one",
     /This camera is off\. Nothing is being shown, because the last picture/.test(live));

  const editor = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatLayoutEditor.tsx"), "utf8");
  ok("the seat editor refuses to draw on an old picture",
     /drawing a seat layout over a photograph of a different day puts every seat in the wrong place/.test(editor));
}

// ── The deleted service ────────────────────────────────────────────────────
{
  ok("a deleted service is kept whole, not as a note about one",
     /log\.unshift\(\{ \.\.\.s, counts_deleted: !!alsoCounts/.test(worker));
  ok("it can be brought back", /async restoreService\(id, user\)/.test(worker));
  ok("with the counts that went with it", /if \(counts_deleted && svc\.started_at && svc\.ended_at\)/.test(worker));
  ok("it really goes after thirty days", /tidyDeletedServices\(log, now = Date\.now\(\)\)/.test(worker)
     && /now - DELETED_KEPT_DAYS \* 86400_000/.test(worker));
  ok("and the list is tidied as it is read, so it never over-promises",
     /const log = this\.tidyDeletedServices\(await this\.get\("deleted_services", \[\]\)\);/.test(worker));
  ok("bringing one back is for administrators",
     /Only administrators can bring a service back/.test(worker));

  const page = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");
  ok("the Services page shows Recently deleted", /Recently deleted \(\{binned\.length\}\)/.test(page));
  ok("with when each one goes for good", /gone for good \$\{gone\.toLocaleDateString/.test(page));
  ok("and a way to bring it back", /Bring it back/.test(page));
  ok("the delete warning says where it goes", /goes to <strong>Recently deleted<\/strong>/.test(page));
}

// ── The other half: the live-video socket ──────────────────────────────────
//
// The still endpoint was taught to refuse an old picture, and the camera tile
// went on showing one anyway — labelled "Picture from 6s ago", flickering
// between that and "this camera is off". Two paths were fighting: one
// clearing the picture, the other pushing it straight back. The live-video
// socket sends the last stored picture the instant anybody connects, and the
// page stamps whatever arrives over that socket as taken this second.
{
  const watch = worker.slice(worker.indexOf("async watch(camera_id, request)"), worker.indexOf("async watch(camera_id, request)") + 2000);
  ok("the live socket only pushes a picture of now",
     /const fresh = snap\?\.data && this\.isOnline\(live\[camera_id\]\) && Date\.now\(\) - \(snap\.at \|\| 0\) <= SNAPSHOT_STALE_MS;/.test(watch));
  ok("and pushes nothing otherwise", /if \(fresh\) \{ try \{ server\.send\(snap\.data\); \} catch \{\} \}/.test(watch));
  ok("so the two paths agree rather than fight",
     /one\s*\n?\s*\* clearing the picture, the other pushing it straight back/.test(watch.replace(/\s+/g, " "))
     || /clearing the picture, the other pushing it straight back/.test(watch));
}

// ── Lengths of time somebody can read ──────────────────────────────────────
{
  const { howLong } = await import("../worker/health.js");
  ok("seconds stay seconds", howLong(5_000) === "5 seconds");
  ok("a minute reads as a minute", howLong(61_000) === "1 min 1s");
  ok("an hour reads as an hour", howLong(3_601_000) === "1 h");
  ok("and nine days does not read as 791909s", howLong(791_909_000) === "9 days 3 h", howLong(791_909_000));
  ok("nothing anywhere prints raw seconds past a minute",
     !/\$\{Math\.round\(since \/ 1000\)\}s ago/.test(fs.readFileSync(path.join(root, "worker/health.js"), "utf8")));

  for (const f of ["dashboard/src/app/live-cameras/page.tsx", "dashboard/src/components/ui/SystemHealth.tsx"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    ok(`${f.split("/").pop()} says days once it is past two`, /days \$\{rh\} h ago|\$\{d\} days ago/.test(src));
  }
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Off means off, and deleted means recoverable.");
process.exit(fails ? 1 : 0);
