/**
 * "can you only ask questions when i actually start a session, because i
 * just opened the website and already you asked questions like relax"
 *
 * Opening the website is not counting. Every question Kyro asks is about
 * counting people — which seat is which, whether two cameras are looking at
 * the same chair, how many seats a room has — and none of it is wanted by
 * somebody opening the site on a Tuesday to look at last Sunday's figures.
 * A camera left running is not a reason to be asked anything.
 *
 * The register already worked this way and said why, in as many words: "a
 * register of people needs a reason to exist, and somebody left a camera
 * running is not one". The questions never got the same rule.
 *
 * Two gates, because one is not enough:
 *
 *   · nothing is ASKED outside a service — otherwise questions pile up
 *     quietly while nobody is counting;
 *   · and nothing is HANDED OUT outside one either — otherwise a question
 *     put in the last minute of a service sits there afterwards and greets
 *     whoever next opens the website, which is exactly what happened.
 *
 * Nothing is thrown away. A guess worth asking about is still worth asking
 * about when counting next starts, and the asking is once per thing, so
 * nothing piles up while it waits.
 *
 *   node tests/test_questions_wait_for_a_service.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-quiet-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const now = Date.now();
function hub(serviceOn) {
  const store = new Map();
  if (serviceOn) store.set("service_live", { id: "svc-1", name: "Sunday", started_at: now });
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: {
    get: async (k) => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  }, waitUntil: () => {} };
  h.store = store;
  return h;
}
const aQuestion = (id) => ({
  type: "review_request", review_id: id, review_type: "how_many_seats",
  target_role: "operator", question: "How many seats are there in Room?",
  where: "Room", pictures: 0, created_at: now / 1000, options: ["ok"],
});

// ── Nothing is handed out between services ────────────────────────────────
{
  const h = hub(false);
  h.store.set("questions", { a: aQuestion("a"), b: aQuestion("b") });
  const out = await h.listQuestions("admin");
  ok("opening the website with nothing counting asks nothing",
     Array.isArray(out) && out.length === 0, `${out.length} question(s)`);
  ok("and the questions are kept, not thrown away",
     Object.keys(h.store.get("questions")).length === 2);
}

// ── …and the same questions come back once counting starts ───────────────
{
  const h = hub(true);
  h.store.set("questions", { a: aQuestion("a"), b: aQuestion("b") });
  const out = await h.listQuestions("admin");
  ok("start a service and they are asked", out.length === 2, `${out.length}`);
}

// ── Nothing is ASKED outside a service either ─────────────────────────────
{
  const h = hub(false);
  const cams = { "box:a": { camera_id: "box:a", name: "Room", zone_name: "Room",
    location: "indoor", zone_capacity: 307, capacity_from: "found" } };
  const live = { "box:a": { updated_at: now, status: "online", peak: 20, people: 20 } };
  // askAboutSeatCount is reached only through report(); call it directly to
  // show the gate is the one in report and not an accident of this one.
  await h.askAboutSeatCount(cams, live, now);
  ok("(the asking itself still works when called)",
     Object.keys(h.store.get("questions") ?? {}).length === 1);

  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const at = worker.indexOf("const serviceOn = ");
  ok("report asks whether a service is running", at > 0);
  const block = worker.slice(at, worker.indexOf("// …and nothing is asked at all outside a service", at));
  ok("and every question it puts is inside that gate",
     /if \(serviceOn\) \{/.test(block)
     && /this\.addQuestions\(newQuestions\)/.test(block)
     && /this\.makeAsks\(cams, now\)/.test(block)
     && /this\.askAboutSeats\(/.test(block)
     && /this\.askAboutSeatCount\(/.test(block)
     && /this\.askAboutSameChair\(/.test(block));
  ok("the pictures those questions want are still collected either way",
     /const wantPictures = \[\];/.test(worker));
}

// ── The health card says the same thing as the panel ──────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const at = worker.indexOf("questions: await (async () => {");
  const block = worker.slice(at, at + 900);
  ok("the card does not count questions nobody will be shown",
     block.indexOf('if (!(await this.get("service_live", null)))')
     < block.indexOf("const waiting ="), "the waiting count is worked out first");
  ok("and says plainly why it is quiet",
     /Nothing is counting, so Kyro is not asking anything/.test(block));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Nothing counting, nothing asked.");
process.exit(fails ? 1 : 0);
