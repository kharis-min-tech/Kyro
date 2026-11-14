/**
 * "Does this room really have that many seats?"
 *
 * "but you didnt give me any questions to even see if it was — just
 * assuming and silent."
 *
 * Three hundred and seven seats found in a bedroom, asserted, without a
 * word. The reason is one clause in the seat finder: a place becomes a
 * QUESTION only when it is "uncertain", and that test ends `&& !chair`, so
 * anything the AI called a chair twice went straight to being a seat with
 * no question possible, ever. A bed and some pillows read as a sofa and a
 * chair.
 *
 * Asking about each of three hundred would be worse than silence. The
 * thing worth doubting is the FIGURE: Kyro says this room seats three
 * hundred and has never seen more than two people in it. That is one
 * sentence, and anybody can settle it in a second.
 *
 *   node tests/test_kyro_doubts_its_own_seat_count.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-doubt-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const now = Date.now();
function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, waitUntil: () => {} };
  h.store = store;
  return h;
}
async function ask(h, { seats, peak, from = "found", location = "indoor", online = true }) {
  const cams = { "box:a": { camera_id: "box:a", name: "Room", zone_name: "Room", location,
    zone_capacity: seats, capacity_from: from } };
  const live = { "box:a": { updated_at: online ? now : now - 60 * 60_000, status: "online", peak, people: peak } };
  await h.askAboutSeatCount(cams, live, now);
  return Object.values(h.store.get("questions") ?? {}).filter((q) => q.review_type === "how_many_seats");
}

// ── 1. The bedroom ────────────────────────────────────────────────────────
{
  const h = hub();
  const qs = await ask(h, { seats: 307, peak: 2 });
  ok("1. Kyro doubts it out loud", qs.length === 1, `${qs.length}`);
  ok("1. saying both figures it is doubting",
     /307 seats/.test(qs[0].why) && /is 2$/.test(qs[0].why), qs[0]?.why);
  ok("1. with an answer a person can give", qs[0].options.length === 2
     && /yes/i.test(qs[0].options[0]) && /no/i.test(qs[0].options[1]));
  ok("1. and nothing to wait for — it is a question about a number",
     qs[0].pictures === 0);
}

// ── 2. A real hall on a quiet day is not doubted ──────────────────────────
//
// A church is mostly empty most of the week. "More seats than people"
// proves nothing, and a Tuesday must not become a question.
{
  for (const [seats, peak, what] of [
    [300, 30, "a 300-seat hall, 30 came"],
    [300, 16, "a quiet service"],
    [114, 40, "her own hall, a normal Sunday"],
    [20, 1, "a small room"],
  ]) {
    ok(`2. ${what} is left alone`, (await ask(hub(), { seats, peak })).length === 0);
  }
}

// ── 3. Never a number somebody entered ────────────────────────────────────
{
  ok("3. a seat count entered by hand is not Kyro's to doubt",
     (await ask(hub(), { seats: 300, peak: 2, from: "admin" })).length === 0);
}

// ── 4. Nor a doorway, nor a camera that is off ────────────────────────────
{
  ok("4. a doorway has no seats to be wrong about",
     (await ask(hub(), { seats: 300, peak: 2, location: "entrance" })).length === 0);
  ok("4. and a camera that is not reporting is not asked about",
     (await ask(hub(), { seats: 307, peak: 2, online: false })).length === 0);
}

// ── 5. Once, not every two seconds ────────────────────────────────────────
{
  const h = hub();
  await ask(h, { seats: 307, peak: 2 });
  await ask(h, { seats: 307, peak: 2 });
  await ask(h, { seats: 307, peak: 2 });
  ok("5. the same figure is put once", (await ask(h, { seats: 307, peak: 2 })).length === 1);
  // …but a different figure is a different claim.
  const again = await ask(h, { seats: 512, peak: 2 });
  ok("5. and a new figure is a new question", again.length === 1 && /512/.test(again[0].why));
}

// ── 6. Saying no actually forgets them ────────────────────────────────────
{
  const worker = read("worker/venue.js");
  ok("6. the guess is dropped at once", /await this\.syncCapacity\(q\.ask\.camera, 0, "found"\);/.test(worker));
  ok("6. and the camera is told, since the seats live there",
     /kind: "how_many_seats" \}\);/.test(worker));
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("6. which forgets what it found", /cam\.seatFinder\.forgetFound\(\);/.test(ctx));
  ok("6. and writes that down", /localStorage\.setItem\(`kyro_seats_\$\{cam\.key\}`/.test(ctx));
}

// ── 7. And it is a question somebody can see ──────────────────────────────
{
  const panel = read("dashboard/src/components/ui/SamePerson.tsx");
  ok("7. the panel shows it", /q\.review_type === "how_many_seats"/.test(panel));
  ok("7. with the two answers", /Yes, about right/.test(panel) && /No, nothing like that/.test(panel));
  ok("7. and says what saying no will do",
     /makes it forget what it found here and look again/.test(panel));
  ok("7. and what it did afterwards",
     /Forgotten\. Kyro will work the seats out again from the picture\./.test(panel));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
