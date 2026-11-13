/**
 * "Is this the same chair?" — asked where the pictures are.
 *
 * Two cameras pointed at one hall each find their own seats, so one chair
 * becomes two and one person sitting in it looks like two people. Kyro works
 * out which pairs are suspect on its own — not on appearance, because two
 * chairs side by side are identical from a camera, but on who sits in them —
 * and then it has to ask, because that pattern can also come from two real
 * chairs and one confused register.
 *
 * It used to ask on the seating page, as rows of seat ids and a tally:
 * "S37 and S24 — same person in both 81 times". That is not a question
 * anybody can answer. "its a bit weird and dont know which area you are
 * talking about, if ever the system does not know, thats when questions
 * would be able to come up."
 *
 * So what is checked here is the whole path: the pair becomes a question,
 * the question asks each camera for a picture of its own chair, it is not
 * shown until both pictures are in, and the answer changes the seating
 * straight away — yes joins the two, no settles the pair for good.
 *
 *   node tests/test_the_chair_question_is_asked.mjs
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

// The worker runs on Cloudflare and imports from "cloudflare:workers", which
// node cannot load. A copy with that one import stubbed is the real code.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-chairq-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));
const { Building, MERGE_EVIDENCE } = await import(path.join(tmp, "building.js"));

/** Enough of a Durable Object to run the two methods under test. */
function hub(building) {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
    },
  };
  h.building = building;
  h.buildingSavedAt = 0;
  h.store = store;
  h.wrong = async (...a) => { h.complained = a; };
  return h;
}

/** One hall, two cameras, two chairs each; one pair with evidence against it. */
function hall() {
  const b = new Building();
  const t = 1000;
  b.sawSeat("box:west", "K1", [100, 100, 190, 170], t);
  b.sawSeat("box:west", "K2", [230, 100, 320, 170], t);
  b.sawSeat("box:east", "K7", [700, 400, 790, 470], t);
  b.sawSeat("box:east", "K8", [830, 400, 920, 470], t);
  for (let i = 0; i < MERGE_EVIDENCE + 40; i++) b.sameChairEvidence("box:west#K1", "box:east#K7", true);
  return b;
}
const cams = {
  "box:west": { camera_id: "box:west", name: "Hall camera", zone_name: "Main hall" },
  "box:east": { camera_id: "box:east", name: "Door camera", zone_name: "Main hall" },
};
const theQuestion = (h) => Object.values(h.store.get("questions") ?? {})[0];

// ── 1. A suspect pair becomes a question, not a row on a list ─────────────
{
  const h = hub(hall());
  const want = await h.askAboutSameChair(cams, Date.now());
  const q = theQuestion(h);
  ok("1. a question is asked", !!q, JSON.stringify(h.store.get("questions")));
  /**
   * The question is about the PERSON, not the chair.
   *
   * "uno a chair is meant to look the same, its the person that you should
   * be focusing on, because chairs are usually identical." A church buys a
   * hundred of the same chair; two photographs of two of them settle
   * nothing. Two photographs of whoever is sitting in them settle it at a
   * glance.
   */
  ok("1. and it is the one a person can answer", q?.question === "Is this the same person?", q?.question);
  ok("1. with both answers offered",
     q?.options?.length === 2 && /yes/i.test(q.options[0]) && /no/i.test(q.options[1]),
     JSON.stringify(q?.options));
  ok("1. and the evidence in words, not seat ids",
     /same person was in both/.test(q?.why ?? "") && /\d+ times/.test(q?.why ?? ""), q?.why);
  ok("1. it names where each camera is looking",
     !!q?.where && !!q?.other_where, `${q?.where} / ${q?.other_where}`);

  // ── 2. …and asks each camera for a picture of ITS OWN chair ─────────────
  ok("2. two pictures are asked for", want.length === 2, `${want.length}`);
  ok("2. one from each camera",
     new Set(want.map((w) => w.camera_id)).size === 2,
     JSON.stringify(want.map((w) => w.camera_id)));
  // The seat asked of each camera must be that camera's own — asking the
  // hall camera for the door camera's seat number crops the wrong chair.
  const asked = Object.fromEntries(want.map((w) => [w.camera_id, w.seat]));
  ok("2. each naming that camera's own seat",
     asked["box:west"] === 1 && asked["box:east"] === 7, JSON.stringify(asked));
  ok("2. and asking for whoever is SITTING in it, not for the chair",
     want.every((w) => w.who === true), JSON.stringify(want));
  ok("2. as two sides of one question",
     want[0].id === want[1].id && want[0].side === "a" && want[1].side === "b");

  // ── 3. Not shown until both pictures are in ────────────────────────────
  ok("3. no pictures yet", (q?.pictures ?? 0) === 0);
  const shown = async () => (await VenueHub.prototype.listQuestions.call(h, "operator"))
    .filter((x) => x.review_type === "same_chair_question");
  ok("3. and so it is not put to anybody yet", (await shown()).length === 0);
  q.pictures = 1;
  ok("3. nor with only one of the two", (await shown()).length === 0);
  q.pictures = 2;
  ok("3. and is, once both are in", (await shown()).length === 1);
}

// ── 4. The same pair is never asked twice ─────────────────────────────────
{
  const h = hub(hall());
  const now = Date.now();
  await h.askAboutSameChair(cams, now);
  const first = Object.keys(h.store.get("questions")).length;
  // Time passes, the pictures never come, the request lapses.
  h.chairWants = []; h.chairWantsAt = 0;
  await h.askAboutSameChair(cams, now + 60 * 60_000);
  ok("4. asked once, not every heartbeat",
     Object.keys(h.store.get("questions")).length === first, `${first} → ${Object.keys(h.store.get("questions")).length}`);
}

// ── 5. A camera that is switched off is never asked ───────────────────────
{
  const h = hub(hall());
  const off = { ...cams, "box:east": { ...cams["box:east"], hidden: true } };
  const want = await h.askAboutSameChair(off, Date.now());
  ok("5. nothing is asked that could never be answered", want.length === 0, `${want.length}`);
  ok("5. and no unanswerable question is left lying about",
     Object.keys(h.store.get("questions") ?? {}).length === 0);
}

// ── 6. "Yes, one chair" joins them, while she is looking at it ────────────
{
  const h = hub(hall());
  await h.askAboutSameChair(cams, Date.now());
  const q = theQuestion(h);
  const before = h.building.overview().total;
  const res = await h.answerQuestion(q.review_id, "operator", "ruth",
    { json: async () => ({ answer: "Yes, the same person" }) });
  const body = await res.json();
  ok("6. the answer is taken", body.ok && body.action === "one_chair", JSON.stringify(body));
  ok("6. and the hall has one chair fewer, not two counted as one later",
     h.building.overview().total === before - 1, `${before} → ${h.building.overview().total}`);
  ok("6. it is recorded against whoever said it",
     h.building.overview().history[0]?.by === "ruth", h.building.overview().history[0]?.by);
  ok("6. the seating is written, not left in memory to be lost",
     !!h.store.get("building"));
  ok("6. and both pictures are deleted the moment it is answered",
     !h.store.has(`qsnap:${q.review_id}:a`) && !h.store.has(`qsnap:${q.review_id}:b`));
}

// ── 7. "No, two chairs" settles it for good ───────────────────────────────
{
  const h = hub(hall());
  await h.askAboutSameChair(cams, Date.now());
  const q = theQuestion(h);
  const before = h.building.overview().total;
  const body = await (await h.answerQuestion(q.review_id, "operator", "ruth",
    { json: async () => ({ answer: "No, different people" }) })).json();
  ok("7. the answer is taken", body.ok && body.action === "two_chairs", JSON.stringify(body));
  ok("7. and both chairs are kept", h.building.overview().total === before, `${before} → ${h.building.overview().total}`);
  ok("7. she is not asked about that pair again", h.building.proposals().length === 0,
     `${h.building.proposals().length} still proposed`);
  // The cameras keep watching and keep agreeing. Her answer still stands.
  for (let i = 0; i < 100; i++) h.building.sameChairEvidence("box:west#K1", "box:east#K7", true);
  ok("7. however much the cameras go on agreeing", h.building.proposals().length === 0);
}

// ── 8. An answered question is answered once ──────────────────────────────
{
  const h = hub(hall());
  await h.askAboutSameChair(cams, Date.now());
  const q = theQuestion(h);
  await h.answerQuestion(q.review_id, "operator", "ruth", { json: async () => ({ answer: "Yes, the same person" }) });
  const after = h.building.overview().total;
  const again = await (await h.answerQuestion(q.review_id, "operator", "ruth",
    { json: async () => ({ answer: "Yes, the same person" }) })).json();
  ok("8. pressing it twice does nothing twice", again.already === true, JSON.stringify(again));
  ok("8. and the hall is unchanged", h.building.overview().total === after);
}

// ── 9. It waits for somebody to sit down in both ──────────────────────────
//
// The picture is of whoever is in the seat, so there is no picture until
// somebody is in it. Those two seats may be empty for most of a morning, and
// a minute's patience — which is right for a question about a person in shot
// now — would mean the duplicate was never put to anybody at all.
{
  const h = hub(hall());
  const t0 = Date.now();
  const first = await h.askAboutSameChair(cams, t0);
  ok("9. the request stands a minute later", (await h.askAboutSameChair(cams, t0 + 60_000)).length === 2);
  ok("9. and five minutes later", (await h.askAboutSameChair(cams, t0 + 5 * 60_000)).length === 2);
  ok("9. and the question is still there to be answered",
     Object.keys(h.store.get("questions")).length === 1);

  // One camera's picture arrives. The other is still waiting.
  const q = theQuestion(h);
  q.sides = { a: true };
  const still = await h.askAboutSameChair(cams, t0 + 6 * 60_000);
  ok("9. the half that is in is not asked for again", still.length === 1, `${still.length}`);
  ok("9. and it is the half that is missing", still[0].side === "b", still[0].side);
  ok("9. which is the same request, not a new question",
     still[0].id === first[0].id && Object.keys(h.store.get("questions")).length === 1);
}

// ── 9b. An answered question stops asking for pictures ───────────────────
//
// Answering "yes" merges the two seats, which leaves no pair to put — and
// the loop used to take an early way out before checking which pictures
// were still wanted. Both cameras went on sending a crop of somebody every
// couple of seconds, for ten minutes, for a question already settled.
{
  const h = hub(hall());
  const t0 = Date.now();
  await h.askAboutSameChair(cams, t0);
  const q = theQuestion(h);
  await h.answerQuestion(q.review_id, "operator", "ruth",
    { json: async () => ({ answer: "Yes, the same person" }) });
  ok("9b. the pair is gone, because it is now one chair", h.building.proposals().length === 0);
  const after = await h.askAboutSameChair(cams, t0 + 2_000);
  ok("9b. and nothing is still being asked for", after.length === 0, JSON.stringify(after));
}

// ── 9c. …and so does one whose pictures are both in ──────────────────────
{
  const h = hub(hall());
  const t0 = Date.now();
  await h.askAboutSameChair(cams, t0);
  const q = theQuestion(h);
  q.sides = { a: true, b: true }; q.pictures = 2;
  ok("9c. a question with both pictures asks for no more",
     (await h.askAboutSameChair(cams, t0 + 2_000)).length === 0);
}

// ── 10. If nobody ever sits there, it is withdrawn and tried again ────────
//
// Leaving it would leave a question nobody can answer sitting on the page;
// leaving the pair marked as asked would mean the chair went on being
// counted twice in silence, which is the whole thing this is for.
{
  const h = hub(hall());
  const t0 = Date.now();
  await h.askAboutSameChair(cams, t0);
  const q = theQuestion(h);
  const after = await h.askAboutSameChair(cams, t0 + 11 * 60_000);
  ok("10. the unanswerable question is taken away",
     !h.store.get("questions")[q.review_id], JSON.stringify(Object.keys(h.store.get("questions"))));
  ok("10. and nothing is left being asked for under it", after.every((w) => w.id !== q.review_id));
  // The pair is still a pair. Being unable to photograph it this morning is
  // not evidence about the chairs, so it goes back into the queue and is put
  // again — which costs another ten minutes' patience, so it cannot spin.
  const fresh = Object.values(h.store.get("questions"));
  ok("10. the pair is put again rather than lost for ever",
     fresh.length === 1 && fresh[0].review_id !== q.review_id, JSON.stringify(fresh.map((x) => x.review_id)));
  ok("10. and the cameras are asked for it afresh",
     after.length === 2 && after.every((w) => w.id === fresh[0].review_id), JSON.stringify(after));
}

// ── 11. A question about a chair is not thrown away after ten minutes ─────
//
// A question about a person is about one morning. A chair is a chair every
// Sunday — and this one may have spent most of ten minutes waiting for
// somebody to sit down, leaving no time at all to answer it.
{
  const h = hub(hall());
  const t0 = Date.now();
  await h.askAboutSameChair(cams, t0);
  const q = theQuestion(h);
  q.pictures = 2;
  const shownAt = async (mins) => {
    q.created_at = Date.now() / 1000 - mins * 60;
    return (await VenueHub.prototype.listQuestions.call(h, "operator"))
      .filter((x) => x.review_type === "same_chair_question").length;
  };
  ok("11. still there after a quarter of an hour", (await shownAt(15)) === 1);
  ok("11. and after half an hour", (await shownAt(30)) === 1);
  ok("11. but not for ever", (await shownAt(70)) === 0);
}

// ── 12. The old panel is gone from the seating page ────────────────────────
{
  const page = read("dashboard/src/components/ui/SeatManager.tsx");
  ok("12. no list of seat-id pairs on the seating page",
     !/Possibly the same chair/.test(page) && !/d\.proposals/.test(page));
  const asks = read("dashboard/src/components/ui/SamePerson.tsx");
  ok("12. the question is on the page that shows pictures",
     /same_chair_question/.test(asks) && /Is this the same person\?/.test(asks));
  ok("12. and it shows one picture from each camera",
     /side="a"[\s\S]{0,400}side="b"/.test(asks.slice(asks.indexOf("same_chair_question"))));
}

// ── 13. A seat question asks about a seat ─────────────────────────────────
//
// "Is this a seat?" shared the "is this a person?" block, and so put the
// words "Is this a person?" over a photograph of a chair.
{
  // What is on the screen, not what is in the comments beside it.
  const asks = read("dashboard/src/components/ui/SamePerson.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*\*[\s\S]*?\*\/\}/g, "");
  const seatBlock = asks.slice(asks.indexOf('q.review_type === "is_this_a_seat" ? ('));
  const upToNext = seatBlock.slice(0, seatBlock.indexOf('q.review_type === "is_this_a_person"'));
  ok("13. the seat question asks whether it is a seat",
     /Is this a seat\?/.test(upToNext) && !/Is this a person\?/.test(upToNext));
  ok("13. and its answers are about seats",
     /Yes, a seat/.test(upToNext) && /No, not a seat/.test(upToNext));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
