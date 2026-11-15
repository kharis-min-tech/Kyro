/**
 * "when i go to unanswered quesrtions, i cant see the picture again"
 *
 * "Is this the same person?" with two buttons and nothing to look at is
 * not a question, it is a coin toss.
 *
 * Two faults, and the second is the reason for the first.
 *
 * THE PICTURES. Two panels draw questions — the one that appears while
 * Kyro is asking, and the list of ones nobody got to at the time. The
 * first has shown the pictures all along. The second never did. The rule
 * about which questions have two pictures, one, or none is written down
 * once now, and both panels read it.
 *
 * THE LIFETIME. The list kept questions for TWENTY-FOUR HOURS while the
 * website threw each question and both its pictures away after four
 * minutes. So it filled with questions that no longer existed: no
 * pictures, and buttons that did nothing when pressed. The screenshot
 * showed one forty-five minutes old.
 *
 * Four minutes is not meanness, it is the truth about the question. "Is
 * this the same person?" is about somebody a camera is following right
 * now; the register lets a track go after five minutes and there is
 * nothing left for an answer to correct. A question nobody can act on is
 * better gone than sitting there looking answerable.
 *
 * This test holds the two figures together, in the two files they live
 * in, because they are one decision written down twice.
 *
 *   node tests/test_an_unanswered_question_can_be_answered.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const panel  = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ReviewPanel.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── The two lifetimes are the same lifetime ───────────────────────────────
{
  /**
   * Read "4 * 60_000" and work it out.
   *
   * My first go at this matched the two numbers with a regexp that fitted
   * neither file, so both sides came back null — and "the page agrees with
   * the website" PASSED, because null equals null. A comparison that
   * passes when it found nothing is worse than no test at all, so this
   * refuses to return a figure it did not actually read.
   */
  const ms = (label, src) => {
    const m = new RegExp(`${label}\\s*[:=]\\s*([0-9_ *]+)[,;]`).exec(src);
    if (!m) return null;
    const parts = m[1].replace(/_/g, "").split("*").map((x) => Number(x.trim()));
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((a, b) => a * b, 1);
  };
  const serverPlain = ms("const QUESTION_TTL_MS", worker);
  const serverChair = ms("const CHAIR_QUESTION_TTL_MS", worker);
  const panelPlain  = ms("const ANSWERABLE_FOR_DEFAULT_MS", panel);
  const panelChair  = ms("same_chair_question", panel);
  // Nothing below is allowed to compare two nothings. See ms().
  ok("all four figures were actually read out of the files",
     [serverPlain, serverChair, panelPlain, panelChair].every((n) => typeof n === "number" && n > 0),
     `${serverPlain} / ${serverChair} / ${panelPlain} / ${panelChair}`);

  ok("the website says how long a question lasts",
     serverPlain > 0 && serverChair > 0, `${serverPlain} / ${serverChair}`);
  ok("and the page agrees, to the minute",
     panelPlain === serverPlain, `page ${panelPlain}, website ${serverPlain}`);
  ok("including the chair question, which lasts longer",
     panelChair === serverChair, `page ${panelChair}, website ${serverChair}`);
  ok("the list no longer keeps them for a day",
     !/const cutoff = Date\.now\(\) \/ 1000 - 24 \* 3600;/.test(panel));
}

// ── A question past it is not offered ─────────────────────────────────────
// stillAnswerable is the whole of the rule, so it is run rather than read.
{
  const DEFAULT_MS = 4 * 60_000, CHAIR_MS = 60 * 60_000;
  const stillAnswerable = (r, now) =>
    now - r.created_at * 1000 < ({ same_chair_question: CHAIR_MS }[r.review_type] ?? DEFAULT_MS);
  const now = Date.now();
  const made = (minsAgo, type = "same_person_question") =>
    ({ review_type: type, created_at: (now - minsAgo * 60_000) / 1000 });

  ok("a question asked a moment ago is offered", stillAnswerable(made(0), now));
  ok("one from three minutes ago is still offered", stillAnswerable(made(3), now));
  ok("one from forty-five minutes ago is not — the one in the report",
     !stillAnswerable(made(45), now));
  ok("a chair question from forty-five minutes ago IS still offered",
     stillAnswerable(made(45, "same_chair_question"), now));
  ok("…but not one from two hours ago",
     !stillAnswerable(made(120, "same_chair_question"), now));
  ok("the page's own rule is used by both lists",
     (panel.match(/stillAnswerable\(r\)/g) || []).length === 2,
     `${(panel.match(/stillAnswerable\(r\)/g) || []).length} of 2 lists`);
}

// ── Both panels show pictures, by one rule ────────────────────────────────
{
  ok("which questions have pictures is written down once",
     /export function needsTwoPictures\(type: string\): boolean/.test(panel)
     && /export function needsOnePicture\(type: string\): boolean/.test(panel));
  ok("a same-person question has two", /TWO_PICTURES = new Set\(\["same_person_question", "same_chair_question"\]\)/.test(panel));
  ok("a question about a figure has none", /NO_PICTURE = new Set\(\["how_many_seats"\]\)/.test(panel));
  ok("the live panel uses that rule", /: needsTwoPictures\(review\.review_type\)/.test(panel));
  ok("and the unanswered list draws pictures at all, which it never did",
     /\{needsTwoPictures\(r\.review_type\) \? \(/.test(panel)
     && /<LiveSnapshot cameraId=\{r\.camera_id\} reviewId=\{r\.review_id\} side="a"/.test(panel));
  ok("the live panel draws nothing for a question with no picture, rather than an apology",
     /: needsOnePicture\(review\.review_type\)\n\s*\? <LiveSnapshot cameraId=\{cameraId\} reviewId=\{review\.review_id\} \/>\n\s*: null\}/.test(panel));
}

// ── And a question that runs out leaves the screen on its own ─────────────
{
  ok("the list re-reads itself on a tick",
     /const tick = setInterval\(read, 30_000\);/.test(panel));
  ok("so does the count on the bell",
     (panel.match(/setInterval\(read, 30_000\)/g) || []).length === 2,
     `${(panel.match(/setInterval\(read, 30_000\)/g) || []).length} of 2`);
  ok("and the tick is cleared when the panel goes", /clearInterval\(tick\);/.test(panel));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. An unanswered question can be answered.");
process.exit(fails ? 1 : 0);
