/**
 * Two cards, one building, and nothing to say why they disagree.
 *
 * "this is meant to be the session structure [...] so i dont know why its
 * like this" — one card reading Now 78, Peak 78, Entries 78, Capacity 91,
 * and the other, for the same minute, reading Here now 0, Busiest 0, Came
 * in 0, Seats — · set it on Cameras.
 *
 * Both were right, which is the whole trouble:
 *
 *   - "Here now" is built from cameras watching a ROOM, because a doorway
 *     sees everybody once on their way through and nobody after. A building
 *     whose only camera is set as a doorway has no room to be here now in.
 *   - "Seats" is built from capacities somebody ENTERED on a room, because
 *     Kyro's own guess at how many chairs it can see must not decide how
 *     full the building is said to be.
 *
 * Neither reason was anywhere on the screen, so the card just showed a
 * nought and asked her to set a number she had already set.
 *
 *   node tests/test_why_the_figure_is_nought.mjs
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
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-why-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

/** Her building, as the screenshots show it: one camera, seeing 78. */
function hub({ location = "entrance", capacityFrom = "found", capacity = 91 } = {}) {
  const store = new Map();
  const now = Date.now();
  store.set("devices", { box: { id: "box", name: "Church laptop" } });
  store.set("cameras", {
    "box:floor": {
      camera_id: "box:floor", device_id: "box", key: "floor",
      name: "Main Floor", zone_name: "Main Floor",
      location, zone_capacity: capacity, capacity_from: capacityFrom, zone_order: 0,
    },
  });
  store.set("live", {
    "box:floor": { current: 78, peak: 78, entries: 78, exits: 0, people: 78,
                   fps: 6, status: "online", updated_at: now, counted_at: now },
  });
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: {
    get: async (k) => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  } };
  h.faceCodes = new Map();
  h.register = null;
  h.seenAt = new Map([["box:floor", now]]);
  h.store = store;
  return h;
}

// ── 1. The hall camera set as a doorway ───────────────────────────────────
{
  const h = hub({ location: "entrance" });
  const v = await h.venueTotal();
  ok("1. the camera is plainly seeing people", v.zones[0]?.current === 78, `${v.zones[0]?.current}`);
  /**
   * A doorway that is keeping up still answers "here now": everybody it has
   * counted in, less everybody it has counted out. So a building with only
   * a door camera is not automatically nought — which is worth knowing,
   * because it was my first explanation of her screenshot and it was wrong.
   */
  ok("1. a doorway keeping up still says who is here", v.total_current === 78, `${v.total_current}`);
  ok("1. and the card is told there is no room camera",
     v.why_nothing?.no_room_camera === true, JSON.stringify(v.why_nothing));
  ok("1. and what the cameras can actually see between them",
     v.why_nothing?.cameras_seeing === 78, `${v.why_nothing?.cameras_seeing}`);
}

// ── 2. Set it to a room, and the figure appears ───────────────────────────
{
  const h = hub({ location: "indoor" });
  const v = await h.venueTotal();
  ok("2. with the camera on the room, here now is the room",
     v.total_current === 78, `${v.total_current}`);
  ok("2. and there is nothing left to explain",
     v.why_nothing?.no_room_camera === false, JSON.stringify(v.why_nothing));
}

// ── 3. "Seats —  set it on Cameras", with 91 already set ──────────────────
//
// Telling somebody to do what they have already done is the worst kind of
// empty figure: it looks like the thing is broken either way.
{
  const h = hub({ location: "entrance", capacityFrom: "admin", capacity: 91 });
  const v = await h.venueTotal();
  ok("3. a seat count on a doorway drives nothing", v.total_capacity === 0, `${v.total_capacity}`);
  ok("3. and the card is told that it exists",
     v.why_nothing?.seats_not_used?.seats === 91, JSON.stringify(v.why_nothing?.seats_not_used));
  ok("3. which camera it is on",
     v.why_nothing?.seats_not_used?.camera === "Main Floor");
  ok("3. and that a doorway is why", v.why_nothing?.seats_not_used?.because === "doorway");
}

// ── 4. …or because it is Kyro's own guess ─────────────────────────────────
{
  const h = hub({ location: "indoor", capacityFrom: "found", capacity: 91 });
  const v = await h.venueTotal();
  ok("4. a guessed seat count drives nothing either", v.total_capacity === 0, `${v.total_capacity}`);
  ok("4. and the card can say so rather than asking again",
     v.why_nothing?.seats_not_used?.because === "guess", JSON.stringify(v.why_nothing?.seats_not_used));
}

// ── 5. A number somebody entered, on a room, is simply used ───────────────
{
  const h = hub({ location: "indoor", capacityFrom: "admin", capacity: 91 });
  const v = await h.venueTotal();
  ok("5. an entered seat count on a room is the seat count", v.total_capacity === 91, `${v.total_capacity}`);
  ok("5. and nothing is explained that does not need explaining",
     v.why_nothing?.seats_not_used === null, JSON.stringify(v.why_nothing?.seats_not_used));
}

// ── 6. An entered seat count survives the trip to the figure ─────────────
//
// It did not. The list venueTotal() reads left capacity_from out, so every
// seat count in the building arrived as a guess however carefully it had
// been typed in — and a guess is deliberately not allowed to drive
// anything. "Seats —  set it on Cameras", every time, whatever she set.
{
  const h = hub({ location: "indoor", capacityFrom: "admin", capacity: 91 });
  const list = await h.cameraList();
  ok("6. the camera list says where the seat count came from",
     list[0]?.capacity_from === "admin", JSON.stringify(list[0]?.capacity_from));
  const v = await h.venueTotal();
  ok("6. and so the figure can tell an entered number from a guess",
     v.zones[0]?.capacity_from === "admin", `${v.zones[0]?.capacity_from}`);
}

// ── 7. The cards say it, not just the server ──────────────────────────────
{
  const card = read("dashboard/src/components/ui/AutoServices.tsx");
  ok("7. the service card explains a nought here-now",
     /every camera is set as a doorway/.test(card));
  ok("7. with what the cameras do see, so the two cards agree out loud",
     /cameras see \$\{venue\.why_nothing\.cameras_seeing\}/.test(card));
  ok("7. and a way to put it right", /set one to a room/.test(card));
  ok("7. it stops telling her to set a seat count she has set",
     /set on \$\{unused\.camera\}, which is a doorway/.test(card)
     && /is Kyro's guess — enter it to use it/.test(card));
  // …and only when the figure is actually nought.
  ok("7. and says none of it when the figures are fine",
     /const noRoom = !venue\?\.total_current && !!why\?\.no_room_camera;/.test(card)
     && /const unused = !venue\?\.total_capacity \?/.test(card));

  const sessions = read("dashboard/src/app/sessions/page.tsx");
  ok("7. and the other card no longer calls a guess a capacity",
     /capacity_from === "found" \? "Seats \(Kyro's guess\)" : "Capacity"/.test(sessions));
}

// ── 8. The live site is not a demonstration ──────────────────────────────
//
// Fifteen files read "there is no FastAPI backend" as "this is a demo", and
// that variable is unset on every Cloudflare build — the church's. Mostly
// harmless, because most of them ask isEdgeLive() first. Where it was not
// harmless it was invisible: the seat panel drew coloured dots marked
// SCHEMATIC instead of the camera, on a live site, for ever.
{
  const mode = read("dashboard/src/lib/mode.ts");
  ok("8. there is one place that decides it", /export function inDemoMode/.test(mode));
  ok("8. and a live edge is never a demonstration",
     /return noBackend\(\) && !isEdgeLive\(\);/.test(mode));
  ok("8. with the other question under its own name",
     /export function noBackend/.test(mode));

  const copies = [];
  for (const f of [
    "app/attendance/page.tsx", "app/cameras/page.tsx", "app/sessions/page.tsx",
    "app/rota/page.tsx", "app/users/page.tsx", "app/live-cameras/page.tsx",
    "app/seating/page.tsx", "app/notifications/page.tsx", "app/analytics/page.tsx",
    "components/layout/Sidebar.tsx", "hooks/usePipelineStream.ts", "hooks/useAuth.ts",
    "lib/api.ts", "lib/ReviewContext.tsx", "lib/CameraContext.tsx",
  ]) {
    const src = read(`dashboard/src/${f}`);
    if (/const inDemoMode = \(\) =>/.test(src)) copies.push(f);
  }
  ok("8. and nobody keeps their own copy of the answer", copies.length === 0, copies.join(", "));

  // The seat panel is the one that was actually wrong, so it asks the
  // question it means. The rest meant "there is no backend to call" — on
  // the edge the sessions and the rest live in the browser because there is
  // nowhere else — and now say so.
  const seating = read("dashboard/src/app/seating/page.tsx");
  ok("8. the seat panel asks whether this is a demonstration",
     /import \{ inDemoMode \} from "@\/lib\/mode";/.test(seating));
  const sessions = read("dashboard/src/app/sessions/page.tsx");
  ok("8. and the pages that meant 'no backend' ask that instead",
     /import \{ noBackend as inDemoMode \} from "@\/lib\/mode";/.test(sessions));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
