/**
 * Are the questions Kyro chooses the ones worth asking?
 *
 * "questions are responded for the sake of responding, like there just
 * being asked for no reason, they need to be of value."
 *
 * Audited by simulation against ground truth: a congregation with known
 * identities, some of them dressed alike, arriving and going out of shot
 * and coming back. Every ask is checked against who the person really was.
 *
 * ── What the audit found ───────────────────────────────────────────────────
 *
 * The questions Kyro asked were good ones — a bit over half of them would
 * fix a real mistake, and the "close on appearance" path it asks about is
 * wrong 91% of the time, which is a question well worth putting.
 *
 * The fault was the opposite of the complaint: it asked about far too
 * LITTLE. Four mistakes in five went by without a word, and one line
 * produced nearly all of them.
 *
 *     matched on appearance, same seat .... 126 sightings,  0% wrong
 *     matched on appearance, moved seat ....  88 sightings, 55% wrong
 *
 * Forty-eight of the sixty-three identity mistakes in a full church came
 * through that second line, and not one was ever asked about. So somebody
 * answered a handful of questions, fixed a handful of mistakes, and the
 * figure stayed wrong — which is exactly what "it brings no value" feels
 * like from the outside.
 *
 *   node tests/test_the_questions_are_worth_asking.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-worth-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m, "class DurableObject {}"));
}
const { IdentityRegistry } = await import(path.join(tmp, "identity.js"));

/**
 * A service with ground truth.
 *
 * `alike` of them are dressed within a hair of somebody else — which is a
 * church, not a worst case: families match, choirs match, half the room is
 * in a dark coat.
 */
function service(people, alike, trips, seed) {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const looks = [];
  for (let i = 0; i < people; i++) {
    if (i >= people - alike) {
      const twin = looks[i - (people - alike)];
      looks.push(twin.map((v) => Math.max(0, Math.min(1, v + (rnd() - 0.5) * 0.04))));
    } else looks.push([rnd(), rnd(), 0.3 + rnd() * 0.3, rnd(), rnd(), 0.3 + rnd() * 0.3, 2 + rnd(), 0.3 + rnd() * 0.4]);
  }
  const noisy = (l) => l.map((v) => Math.max(0, Math.min(1, v + (rnd() - 0.5) * 0.03)));
  const reg = new IdentityRegistry({ zoneOf: () => "Hall" });
  reg.startService("audit");
  let t = 1000, track = 1;
  const sightings = [], asks = [];
  const appear = (person) => {
    const tr = track++;
    let said = null;
    for (let f = 0; f < 4; f++) {
      t += 1000;
      const out = reg.observe("box:a", [{ track: tr, look: noisy(looks[person]), face: null, seat: `K${person}` }], t);
      if (out[0] != null) said = out[0];
    }
    if (said != null) sightings.push({ real: person, said });
    for (const a of reg.takeAsks()) asks.push({ ...a, at: sightings.length - 1 });
    t += 30_000;                       // out of shot, then back
  };
  for (let i = 0; i < people; i++) appear(i);
  for (let r = 0; r < trips; r++) for (let i = 0; i < people; i++) appear(i);

  // Who each register entry really is: whoever it was attached to most.
  const inEntry = new Map();
  for (const x of sightings) {
    if (!inEntry.has(x.said)) inEntry.set(x.said, new Map());
    const m = inEntry.get(x.said); m.set(x.real, (m.get(x.real) ?? 0) + 1);
  }
  const owner = new Map();
  for (const [id, m] of inEntry) owner.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  const wrong = sightings.map((x, i) => [x, i]).filter(([x]) => owner.get(x.said) !== x.real);
  const askedAt = new Set(asks.map((a) => a.at));
  const useful = (a) => {
    const x = sightings[a.at];
    return !!x && (a.guess === "same") !== (owner.get(a.person) === x.real);
  };
  return {
    people, counted: reg.size, sightings: sightings.length, asks,
    mistakes: wrong.length,
    mistakesAsked: wrong.filter(([, i]) => askedAt.has(i)).length,
    useful: asks.filter(useful).length,
    usefulOf: (list) => list.filter(useful).length,
  };
}

const scenes = [
  ["a fifth dressed alike", service(40, 8, 2, 11)],
  ["a full church, a fifth alike", service(114, 22, 2, 23)],
  ["a choir in the same robes", service(60, 40, 3, 31)],
];

// ── 1. A mistake Kyro makes is a mistake Kyro asks about ──────────────────
//
// This is the one that was broken. 17–28% before.
for (const [name, r] of scenes) {
  const recall = r.mistakes ? r.mistakesAsked / r.mistakes : 1;
  ok(`1. ${name}: the mistakes are asked about (${r.mistakesAsked}/${r.mistakes})`,
     recall >= 0.9, `${Math.round(recall * 100)}%`);
}

// ── 2. …without the questions becoming noise ──────────────────────────────
//
// Asking about everything would be easy and useless. Over half of these
// would change the count if answered.
for (const [name, r] of scenes) {
  const precision = r.asks.length ? r.useful / r.asks.length : 0;
  ok(`2. ${name}: over half of them fix something real (${r.useful}/${r.asks.length})`,
     precision >= 0.5, `${Math.round(precision * 100)}%`);
}

// ── 3. The seat is what makes an appearance match doubtful ────────────────
{
  const identity = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  ok("3. a coat match in a different chair is put to somebody",
     /this is a different seat from the one they were in/.test(identity));
  ok("3. and only when they really have moved",
     /best\.p\.seatKey && best\.p\.seatKey !== `\$\{cameraId\}#\$\{o\.seat\}`/.test(identity));
  // A face settles it; there is nothing to ask.
  ok("3. and not when a face was read", /movingSeat && !faceReads\.length/.test(identity));
}

// ── 4. The twelve that get asked are the first twelve ─────────────────────
//
// Only twelve are ever put at once, so WHICH twelve matters. Sorting them
// by how unsure Kyro was looks obviously right and measures worse: the
// earliest mistakes are the ones that poison everything after them, so
// first-come is the better policy. Checked rather than assumed, and left
// alone because the measurement said to.
{
  const r = scenes[1][1];
  const line = 0.86;
  const first = r.usefulOf(r.asks.slice(0, 12));
  const byDoubt = r.usefulOf([...r.asks].sort((a, b) =>
    Math.abs((a.score ?? line) - line) - Math.abs((b.score ?? line) - line)).slice(0, 12));
  ok("4. the first twelve are at least as useful as the twelve nearest the line",
     first >= byDoubt, `first ${first}/12, by doubt ${byDoubt}/12`);
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("4. so nothing sorts them before they are put",
     /for \(const a of asks\) \{\s*\n\s*if \(live >= MOST_ASKS\) \{ waitTheirTurn\.push\(a\); continue; \}/.test(worker)
     && !/asks\.sort\(/.test(worker));
}

// ── 5. A quiet room is not interrogated ───────────────────────────────────
//
// Nobody dressed like anybody else, no mistakes to make: Kyro should have
// almost nothing to say.
{
  const r = service(40, 0, 2, 7);
  ok("5. with nobody dressed alike there are no mistakes", r.mistakes === 0, `${r.mistakes}`);
  ok("5. and barely any questions", r.asks.length <= 3, `${r.asks.length} asks for ${r.people} people`);
}

// ── 6. What happens after the twelfth ─────────────────────────────────────
//
// "what about after the 12 questions, what happens after that?"
//
// Until now: nothing, and worse than nothing. Twelve questions wait for an
// answer at a time, which is right — nobody can be handed fifty. But the
// register's ask list was emptied whether or not the worker could use what
// it took, so every doubt past the twelfth was dropped on the floor. And
// raising it had already written the pair down as "put to somebody", so it
// was never raised again either. On a full church that is most of the
// morning's doubts: discarded, then permanently silenced.
{
  const { VenueHub } = await import(path.join(tmp, "venue.js"));
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, waitUntil: () => {} };
  h.env = {};
  const reg = new IdentityRegistry({ zoneOf: () => "Hall" });
  reg.startService("m");
  h.register = reg;
  const cams = { "box:a": { camera_id: "box:a", name: "Hall", zone_name: "Hall" } };
  let n = 0;
  for (let i = 0; i < 100; i++) {
    reg.asks.push({ pair: `p${++n}`, at: Date.now(), guess: "same", score: 0.86, reason: "x",
      camera: "box:a", track: n, person: n, other_camera: "box:a", other_track: n + 500 });
  }
  let t = Date.now();
  const first = await h.makeAsks(cams, t);
  ok("6. twelve are put at once, not a hundred", first.length / 2 === 12, `${first.length / 2}`);
  ok("6. and the other doubts are kept, not thrown away",
     reg.asks.length > 0, `${reg.asks.length} waiting`);
  ok("6. oldest first, because the early mistakes poison the rest",
     reg.asks[0].pair === "p13", reg.asks[0]?.pair);

  // A morning: a report every couple of minutes, somebody answering now and
  // then, questions timing out and freeing their place.
  let put = 12;
  for (let step = 0; step < 60; step++) {
    t += 2 * 60_000;
    put += (await h.makeAsks(cams, t)).length / 2;
    const waiting = Object.values(store.get("questions") ?? {}).filter((q) => !q.answer);
    if (waiting.length && step % 3 === 0) { waiting[0].answer = "Same person"; waiting[0].answered_at = t; }
  }
  ok("6. over a service the queue is worked through, not stuck at twelve",
     put >= 40, `${Math.round(put)} questions put over two hours`);
  ok("6. and nothing is left stranded", reg.asks.length === 0, `${reg.asks.length} left`);
}

// ── 7. A question is never shown after it has stopped mattering ──────────
//
// "when i answer the questions, it brings no value to the system."
//
// The flattest version of that was true by arithmetic. A question was shown
// for ten minutes; the link it corrects — a camera's track, back to the
// person it was filed under — is forgotten after five. So for the whole
// second half of every question's life, answering it did nothing, and the
// page said "Noted." exactly as it does when something happens.
{
  const identity = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const trackLink = /export const TRACK_LINK_MS = (\d+) \* 60_000;/.exec(identity);
  const shown = /const QUESTION_TTL_MS = (\d+) \* 60_000;/.exec(worker);
  ok("7. both times are written down", !!trackLink && !!shown,
     `${trackLink?.[1]} / ${shown?.[1]}`);
  const canAct = Number(trackLink[1]), onScreen = Number(shown[1]);
  ok("7. a question is not shown longer than it can be acted on",
     onScreen < canAct, `shown ${onScreen} min, can be acted on for ${canAct} min`);
  ok("7. with a minute in hand for the answer to make the trip",
     canAct - onScreen >= 1, `${canAct - onScreen} min of margin`);
  // …and when one does arrive too late, it is told so.
  ok("7. an answer that changed nothing says so",
     /stale: true/.test(worker));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SamePerson.tsx"), "utf8");
  ok("7. and the page passes that on rather than thanking her",
     /r\.stale \? "That one had already moved on/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
