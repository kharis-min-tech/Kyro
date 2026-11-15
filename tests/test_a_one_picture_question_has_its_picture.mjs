/**
 * "Is this a seat?" — "No picture of this one — the camera had already lost
 * sight of them."
 *
 * Reported as "still not showing up", and it had never shown up: every
 * question with ONE picture has gone out without it since the day they
 * were written.
 *
 * A question comparing two people has two pictures, put away as side "a"
 * and side "b". A question with one — "Is this a seat?", "Is this a
 * person?" — has no sides, so the page asks for it without naming one, and
 * the website looked under `qsnap:<id>`.
 *
 * But the browser that took the picture was told to send it as side "a",
 * because that is what the website asked for when it wanted it. So it was
 * written to `qsnap:<id>:a` and read from `qsnap:<id>`, and the read came
 * back empty every time.
 *
 * The page is not wrong to ask without a side — a question with one
 * picture has no sides — so the fallback lives in the website, where it
 * also covers every picture already in store.
 *
 * And the words underneath were wrong too. "The camera had already lost
 * sight of them" was said whatever the question was, including one about a
 * chair, and chairs do not go anywhere. A reason that cannot be true is
 * worse than no reason: it sends somebody looking for the wrong fault.
 *
 *   node tests/test_a_one_picture_question_has_its_picture.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-snap-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: {
    get: async (k) => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  }, waitUntil: () => {} };
  h.store = store;
  return h;
}
const aSeatQuestion = { review_id: "seat-box-a-K3", review_type: "is_this_a_seat",
  target_role: "operator", question: "Is this a seat?", pictures: 1, created_at: Date.now() / 1000 };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// ── A one-picture question, stored the way the browser stores it ──────────
{
  const h = hub();
  h.store.set("questions", { "seat-box-a-K3": aSeatQuestion });
  // The browser was asked for side "a", so this is where the picture is.
  h.store.set("qsnap:seat-box-a-K3:a", jpeg);

  // …and the page asks for it without naming a side, because it has none.
  const res = await h.getQuestionSnapshot("seat-box-a-K3", "operator", null);
  ok("the picture comes back", res.status === 200, `status ${res.status}`);
  ok("and it is the picture that was stored",
     new Uint8Array(await res.arrayBuffer())[0] === 0xff);
}

// ── A two-picture question still works side by side ───────────────────────
{
  const h = hub();
  h.store.set("questions", { q1: { review_id: "q1", review_type: "same_person_question",
    target_role: "operator", pictures: 2, created_at: Date.now() / 1000 } });
  h.store.set("qsnap:q1:a", new Uint8Array([1]));
  h.store.set("qsnap:q1:b", new Uint8Array([2]));
  const a = await h.getQuestionSnapshot("q1", "operator", "a");
  const b = await h.getQuestionSnapshot("q1", "operator", "b");
  ok("side a is side a", new Uint8Array(await a.arrayBuffer())[0] === 1);
  ok("side b is side b", new Uint8Array(await b.arrayBuffer())[0] === 2);
  // A named side must NOT fall back to the other one: two pictures of the
  // same person is not a question, it is a trick.
  const h2 = hub();
  h2.store.set("questions", h.store.get("questions"));
  h2.store.set("qsnap:q1:a", new Uint8Array([1]));
  const missing = await h2.getQuestionSnapshot("q1", "operator", "b");
  ok("a missing side stays missing rather than borrowing the other",
     missing.status === 204, `status ${missing.status}`);
}

// ── Nothing stored is still nothing ───────────────────────────────────────
{
  const h = hub();
  h.store.set("questions", { "seat-box-a-K3": aSeatQuestion });
  const res = await h.getQuestionSnapshot("seat-box-a-K3", "operator", null);
  ok("a question with no picture anywhere says so honestly", res.status === 204);
}

// ── And the words under an absent picture are true ────────────────────────
{
  const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ReviewPanel.tsx"), "utf8");
  ok("what to say is decided from what is being asked about",
     /function noPictureBecause\(reviewType: string \| undefined, label\?: string\): string/.test(panel));
  ok("a seat is not described as having walked off",
     /No picture of this spot yet — the camera is still watching it/.test(panel));
  ok("and every picture on the page says what its question is",
     (panel.match(/reviewType=\{(review|r)\.review_type\}/g) || []).length === 6,
     `${(panel.match(/reviewType=\{(review|r)\.review_type\}/g) || []).length} of 6`);
  // Counting the whole file catches the note that explains the change as
  // well, which is not a use of it. Only the lines that actually say it.
  const saysIt = panel.split("\n").filter((l) =>
    !/^\s*(\*|\/\/)/.test(l) && /the camera had already lost sight of them/.test(l));
  ok("the old blanket reason is only used where it IS true",
     saysIt.length === 2 && saysIt.every((l) => /return|:/.test(l)),
     `${saysIt.length} places say it`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A question with one picture has one picture.");
process.exit(fails ? 1 : 0);
