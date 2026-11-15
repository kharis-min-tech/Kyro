/**
 * "why guess when you can just ask"
 *
 * Two rooms on the screen: "307 — guess" and "75 — guess". Neither had ever
 * been asked about, and there was no way to tell Kyro the real figure from
 * the question panel even if it had.
 *
 * Kyro only asked when a guess was WILD — at least thirty seats AND at
 * least twenty times the most people it had ever seen at once. 307 seats in
 * a room that has held 20 people is 15 times, so it was never asked. The
 * figure just sat there with the word "guess" under it, for ever.
 *
 * Counting seats from a picture is the one thing Kyro cannot check for
 * itself, and the person reading the screen can answer it in three seconds.
 * So every guess is now asked about — once per figure, so it is a question
 * and not a nag.
 *
 * And the question asks for the NUMBER, rather than yes or no. "No, nothing
 * like that" used to delete the guess and leave the room with no capacity
 * at all, which told Kyro nothing it could use.
 *
 *   node tests/test_a_guess_is_asked_about.mjs
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
const panel  = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ReviewPanel.tsx"), "utf8");
const types  = fs.readFileSync(path.join(root, "dashboard/src/types/index.ts"), "utf8");

// ── It asks about a guess at all ──────────────────────────────────────────
{
  const fn = worker.slice(worker.indexOf("async askAboutSeatCount"));
  const body = fn.slice(0, fn.indexOf("\n  async ", 10));
  ok("the wild-guess gate is gone — 307 in a room that holds 20 is asked about",
     !/zone_capacity < SEATS_WILD_AT \|\| .*SEATS_WILD_TIMES/.test(body),
     "askAboutSeatCount still waits for the guess to be wild");
  ok("a figure somebody entered is still never doubted",
     /c\.capacity_from !== "found"/.test(body));
  ok("and a doorway is not asked how many seats it has",
     /c\.location === "entrance" \|\| c\.location === "queue"/.test(body));
  // Once per CAMERA, not once per figure. Keying it on the figure meant a
  // guess that wobbled asked again every time it moved: "same questions are
  // being found". See tests/test_kyro_doubts_its_own_seat_count.mjs.
  ok("asked once a day per room, so it is one question and not a nag",
     /if \(now - lastAt < SEAT_ASK_AGAIN_MS\) continue;/.test(body)
     && /const SEAT_ASK_AGAIN_MS = 24 \* 3600_000;/.test(worker));
  ok("it asks for the number, not for yes or no",
     /question: `How many seats are there in \$\{where \|\| "this room"\}\?`/.test(body));
  ok("with the guess offered as one tap when it is good",
     /options: \[`\$\{c\.zone_capacity\} is about right`, "I don't know"\]/.test(body));
}

// ── The answer is used ────────────────────────────────────────────────────
{
  const at = worker.indexOf('if (q.review_type === "how_many_seats")');
  const body = worker.slice(at, at + 1600);
  ok("a typed number is read out of the answer",
     /const typed = Number\(String\(q\.answer\)\.replace\(\/\[\^0-9\]\/g, ""\)\);/.test(body));
  ok("a silly figure is refused", /typed <= MOST_SEATS_IN_A_ROOM/.test(body)
     && /const MOST_SEATS_IN_A_ROOM = \d+;/.test(worker));
  ok('"about right" means Kyro\'s own figure', /\/right\|\^yes\/i\.test\(q\.answer\)/.test(body));
  ok("the figure becomes one somebody entered, so the word guess goes",
     /syncCapacity\(q\.ask\.camera, seats, seats > 0 \? "admin" : "found"\)/.test(body));
  ok('"I don\'t know" leaves no capacity rather than a made-up one',
     /action: seats > 0 \? "set_seats" : "forgot_seats"/.test(body));
}

// ── And there is somewhere to type it ─────────────────────────────────────
{
  ok("the question can say its answer is a number", /answer_kind\?: "number";/.test(types));
  ok("the panel draws a box for it",
     /review\.answer_kind === "number" && \(/.test(panel) && /type="number" min=\{1\}/.test(panel));
  ok("the guess is filled in as the placeholder, so a good one is one tap",
     /placeholder=\{review\.answer_suggest \? String\(review\.answer_suggest\) : ""\}/.test(panel));
  ok("the backlog panel has one too, kept per question",
     /r\.answer_kind === "number" && \(/.test(panel)
     && /useState<Record<string, string>>\(\{\}\)/.test(panel));
  ok("the options are still sent, so an older tab can still answer",
     /options: \[`\$\{c\.zone_capacity\} is about right`/.test(worker));
}

// ── The answers the buttons send still parse ──────────────────────────────
{
  // The panel sends the first word of an option: "307 is about right" → "307".
  const firstWord = (opt) => opt.toLowerCase().split(" ")[0];
  const asWorkerReads = (answer, guess) => {
    const typed = Number(String(answer).replace(/[^0-9]/g, ""));
    return Number.isFinite(typed) && typed > 0 && typed <= 100000 ? typed
      : /right|^yes/i.test(answer) ? guess : 0;
  };
  ok('tapping "307 is about right" sets 307',
     asWorkerReads(firstWord("307 is about right"), 307) === 307);
  ok('typing 250 sets 250', asWorkerReads("250", 307) === 250);
  ok('"I don\'t know" clears the guess', asWorkerReads(firstWord("I don't know"), 307) === 0);
  ok("a typing slip of a million is refused", asWorkerReads("1000000", 307) === 0);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A guess gets asked about.");
process.exit(fails ? 1 : 0);
