/**
 * "questions not working."
 *
 * Not a hard thing to find once looked for, and worth writing down because
 * it had been true for days and looked like nothing at all.
 *
 * Kyro asks at most twelve "is this the same person?" questions at a time.
 * That cap is right — five questions should not become fifty. The count was
 * of every unanswered question in STORAGE, and nothing ever took one out of
 * storage. A question stops being shown after ten minutes; it was never
 * removed.
 *
 * So twelve questions nobody happened to answer within their ten minutes
 * sat there for the rest of the day, invisible, holding the gate shut. The
 * thirteenth was never asked, nor any after it. The panel was empty for the
 * plainest reason there is: there was nothing in it and there never would
 * be again.
 *
 *   node tests/test_questions_keep_being_asked.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-qs-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const cams = { "box:a": { camera_id: "box:a", name: "Hall", zone_name: "Hall" } };

function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } },
    waitUntil: () => {},
  };
  h.env = {};
  h.store = store;
  let n = 0;
  /** A register that keeps finding pairs it is unsure about. */
  h.register = { takeAsks: () => [{
    kind: "same", pair: `p${++n}`, guess: "same", score: 0.6, reason: "they look alike",
    camera: "box:a", track: n, person: n, other_camera: "box:a", other_track: n + 100,
  }] };
  return h;
}
const questions = (h) => Object.values(h.store.get("questions") ?? {});
const snaps = (h) => [...h.store.keys()].filter((k) => k.startsWith("qsnap"));

// ── 1. A morning of nobody answering ──────────────────────────────────────
{
  const h = hub();
  let t = Date.now(), made = 0;
  for (let i = 0; i < 40; i++) { t += 10 * 60_000; if ((await h.makeAsks(cams, t)).length) made++; }
  ok("1. Kyro goes on asking all morning", made === 40, `${made} of 40 chances taken`);
  ok("1. without the store growing without end", questions(h).length <= 3, `${questions(h).length} kept`);
  ok("1. and without leaving pictures of people behind", snaps(h).length === 0, `${snaps(h).length} left`);
}

// ── 2. The cap still caps ─────────────────────────────────────────────────
//
// It is there so that five things Kyro is unsure about do not become fifty
// questions in front of somebody. Twelve waiting at once is twelve.
{
  const h = hub();
  const now = Date.now();
  for (let i = 0; i < 30; i++) await h.makeAsks(cams, now);     // all in the same moment
  const waiting = questions(h).filter((q) => !q.answer);
  ok("2. no more than twelve are put at once", waiting.length === 12, `${waiting.length}`);
  // …and a minute later, still twelve: none of them have had their time yet.
  await h.makeAsks(cams, now + 60_000);
  ok("2. and a minute later it is still twelve",
     questions(h).filter((q) => !q.answer).length === 12);
}

// ── 3. One that is answered goes, and takes its pictures ──────────────────
{
  const h = hub();
  const now = Date.now();
  await h.makeAsks(cams, now);
  const q = questions(h)[0];
  h.store.set(`qsnap:${q.review_id}:a`, new Uint8Array([1]));
  h.store.set(`qsnap:${q.review_id}:b`, new Uint8Array([2]));
  q.answer = "Same person"; q.answered_at = now;
  // Kept while the page that answered it is still showing it…
  await h.tidyQuestions(h.store.get("questions"), now + 10_000);
  ok("3. an answer is not whipped off the screen", questions(h).length === 1);
  // …and gone a minute later.
  await h.tidyQuestions(h.store.get("questions"), now + 120_000);
  ok("3. then it goes", questions(h).length === 0);
  ok("3. with both its pictures", snaps(h).length === 0, snaps(h).join(" "));
}

// ── 4. A question is shown once it has its pictures, and not before ───────
{
  const h = hub();
  const now = Date.now();
  await h.makeAsks(cams, now);
  const q = questions(h)[0];
  const shown = async () => (await VenueHub.prototype.listQuestions.call(h, "operator")).length;
  ok("4. two names and a number is not a question", (await shown()) === 0);
  q.pictures = 1;
  ok("4. nor is one picture of two people", (await shown()) === 0);
  q.pictures = 2;
  ok("4. with both, it is put to somebody", (await shown()) === 1);
}

// ── 5. Reading the list is itself a tidy-up ───────────────────────────────
//
// It is the commonest thing that happens to the questions, so it is the
// surest moment to take out what is over — and it has to be written down,
// or the next read starts from the same jam.
{
  const h = hub();
  const now = Date.now() - 60 * 60_000;      // an hour ago
  await h.makeAsks(cams, now);
  ok("5. an hour-old question is in storage to begin with", questions(h).length === 1);
  await VenueHub.prototype.listQuestions.call(h, "operator");
  ok("5. reading the list takes it out", questions(h).length === 0);
  ok("5. and writes that down", Object.keys(h.store.get("questions")).length === 0);
}

// ── 6. The gate counts what is waiting, not what was ever asked ───────────
{
  const h = hub();
  const now = Date.now();
  const qs = {};
  for (let i = 0; i < 20; i++) {
    qs[`old-${i}`] = { review_id: `old-${i}`, review_type: "same_person_question", created_at: (now - 60 * 60_000) / 1000 };
  }
  ok("6. twenty long-dead questions count for nothing",
     h.waitingQuestions(qs, "same_person_question", now) === 0);
  qs["new-1"] = { review_id: "new-1", review_type: "same_person_question", created_at: now / 1000 };
  ok("6. and one from this minute counts for one",
     h.waitingQuestions(qs, "same_person_question", now) === 1);
  qs["new-2"] = { review_id: "new-2", review_type: "same_person_question", created_at: now / 1000, answer: "Same person" };
  ok("6. an answered one is not waiting for anybody",
     h.waitingQuestions(qs, "same_person_question", now) === 1);
}

// ── 7. A failure report that cannot be awaited is handed to waitUntil ────
//
// Three of them were left running loose in functions that cannot await. A
// promise still running when the reply has gone may simply be cancelled —
// so the one line that says "attendance will fall back to the cameras' own
// tallies" could be written nowhere at all, and the dashboard would go on
// looking fine while the figure quietly changed meaning.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const lines = worker.split("\n");
  const asyncs = [...worker.matchAll(/^  async ([a-zA-Z_$][\w$]*)\(/gm)].map((m) => m[1]);
  const loose = [];
  lines.forEach((line, i) => {
    for (const m of asyncs) {
      const re = new RegExp(`(^|[^.\\w])this\\.${m}\\(`, "g");
      const hit = re.exec(line);
      if (!hit) continue;
      // Everything before the call on the line — waitUntil(this.x( puts
      // "waitUntil(this." immediately in front of it.
      const before = line.slice(0, hit.index + hit[1].length);
      if (/(await|return|waitUntil\(|Promise\.all\(|=>|\.then|\.catch|=\s*$)/.test(before.trim().slice(-40))) continue;
      loose.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  ok("7. nothing in the worker starts work and walks away from it",
     loose.length === 0, loose.join("\n   "));
  ok("7. the three that cannot await hand their work to waitUntil",
     (worker.match(/this\.ctx\.waitUntil\(this\.wrong\(/g) ?? []).length === 3,
     `${(worker.match(/this\.ctx\.waitUntil\(this\.wrong\(/g) ?? []).length}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
