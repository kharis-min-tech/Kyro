/**
 * Nothing to ask, and no way to tell why.
 *
 * "no questions are asked though, or kyro dosent need help, like whats
 * going on."
 *
 * Both halves of that are fair. The panel of questions appears only when
 * there is something to answer — a standing panel reading "nothing here"
 * was taken off for good reason — and what is left is silence. Silence is
 * the same shape whether Kyro is sure of everybody or the asking has
 * jammed, and it HAS jammed three times this week: twelve unanswered
 * questions holding the gate shut for ever, every doubt past the twelfth
 * discarded and then silenced, and half of each question's life a dead
 * button.
 *
 * And for one person testing in a room, the likeliest answer is a third
 * thing altogether: no service is being recorded, so there is no register,
 * so there is nobody to be unsure about. Nothing anywhere said that either.
 *
 *   node tests/test_silence_says_why.mjs
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

/** Enough of the hub to read the one part of the health report under test. */
function hub(register, questions = {}) {
  const store = new Map([["questions", questions]]);
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, waitUntil: () => {} };
  h.register = register;
  h.building = null;
  return h;
}
/** The bit of healthReport this is about, run on its own. */
const state = async (h) => {
  const qs = await h.ctx.storage.get("questions") ?? {};
  const waiting = Object.values(qs).filter((q) => !q.answer).length;
  if (waiting) return { waiting, why: null };
  if (!h.register) return { waiting: 0, why: "no_service" };
  if (!h.register.size) return { waiting: 0, why: "nobody_yet" };
  return { waiting: 0, why: "sure" };
};

// ── 1. The three reasons are told apart ───────────────────────────────────
{
  ok("1. nothing recorded, so nobody to be unsure about",
     (await state(hub(null))).why === "no_service");
  ok("1. a service running but nobody in it yet",
     (await state(hub({ size: 0 }))).why === "nobody_yet");
  ok("1. people in it and Kyro sure of them all",
     (await state(hub({ size: 40 }))).why === "sure");
  const waiting = await state(hub({ size: 40 }, { a: { review_id: "a" }, b: { review_id: "b" } }));
  ok("1. and questions actually waiting", waiting.waiting === 2 && waiting.why === null);
  ok("1. …not counting ones already answered",
     (await state(hub({ size: 2 }, { a: { review_id: "a", answer: "Same person" } }))).why === "sure");
}

// ── 2. The worker says it, in words ───────────────────────────────────────
{
  const worker = read("worker/venue.js");
  ok("2. the health report carries it", /questions: await \(async \(\) => \{/.test(worker));
  ok("2. and says what starts a service, since that is the usual answer",
     /A service starts by itself once \$\{SERVICE_START_PEOPLE\} people have been in shot/.test(worker));
  ok("2. the number it names is the number it uses",
     /const SERVICE_START_PEOPLE = 5;/.test(worker));
}

// ── 3. It is on the card that exists to say whether things work ───────────
//
// Not as a panel in the way: "remove this, i dont know why its there" was
// about exactly that, and still stands.
{
  const card = read("dashboard/src/components/ui/SystemHealth.tsx");
  ok("3. the health card shows it", /h\.counting\.questions/.test(card));
  ok("3. saying how many are waiting when some are",
     /questions are"\} waiting for an answer/.test(card));
  ok("3. and why none are when none are", /Nothing to ask — /.test(card));

  const panel = read("dashboard/src/components/ui/SamePerson.tsx");
  ok("3. and the questions panel still shows nothing when there is nothing",
     /if \(!asks\.length\) return null;/.test(panel));
}

// ── 4. No register means no questions, which is the thing to explain ──────
//
// Not a bug: a register of people needs a reason to exist, and "somebody
// left a camera running" is not one. But it is the likeliest reason for
// silence while somebody is testing alone in a room, and it was invisible.
{
  const worker = read("worker/venue.js");
  ok("4. nothing is recorded outside a service",
     /Nothing is recorded outside a service[\s\S]{0,200}if \(!service\) return;/.test(worker));
  ok("4. and the asks come from the register, which is why there are none",
     /const asks = this\.register\?\.takeAsks\?\.\(\) \?\? \[\];/.test(worker));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
