/**
 * "why is there two different numbers […] need to know which one is right"
 *
 * One screen: "Entries, since 9:53 AM — 353 — Different people, counted
 * once each". Another: "Arrived — 185".
 *
 * Both right. They are not two versions of one figure:
 *
 *   353  how many DIFFERENT PEOPLE have been seen since this morning's
 *        session began. Counted once each, however often they move.
 *   185  how many arrivals a TYPICAL DAY has — the hourly chart above it is
 *        averaged over the days Kyro could follow people, so adding its
 *        hours up gives an average day. Not today, and not a running total.
 *
 * Nothing on the second one said that. It read "Arrived" in bold beside a
 * live-looking chart. The card explained itself once, in a sentence under
 * the chart — but a figure is read where the figure is, not in a caption
 * two inches below it.
 *
 * This is the same shape as the card that once read "Entries 7,393" over
 * the words "Nobody counted yet": a figure and the words that qualify it
 * decided in two different places.
 *
 *   node tests/test_a_figure_says_what_it_covers.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const analytics = fs.readFileSync(path.join(root, "dashboard/src/app/analytics/page.tsx"), "utf8");
const arrivals  = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");

// ── The average-day figures say they are averages ─────────────────────────
{
  const at = analytics.indexOf("const totalIn = data.reduce");
  const card = analytics.slice(at, analytics.indexOf("{!anyMovement ?", at));
  ok("it is still an average, not a running total",
     /The chart is an average per hour, so adding the hours up gives an average/.test(analytics));
  for (const which of ["Arrived", "Left", "Busiest"]) {
    ok(`"${which}" says what stretch of time it covers`,
       new RegExp(`>${which}<br />\\s*\\n\\s*<span style=\\{\\{ color: "#4b5563" \\}\\}>average day</span>`).test(card),
       `"${which}" still stands on its own`);
  }
  ok("and the sentence under the chart still agrees with them",
     /On an average day: \{totalIn\.toLocaleString\(\)\} arrived/.test(analytics));
}

// ── The session figure says what IT covers ────────────────────────────────
// This one was already right and must stay right: it names the time the
// session began, because "this session" alone is a figure nobody can check.
{
  ok("the session figure names the moment it counts from",
     /Entries, since \$\{fmtTime\(sessionFrom\)\}/.test(arrivals));
  ok("…or says plainly that it is the whole day",
     /"Entries, all day"/.test(arrivals));
  ok("and says underneath that people are counted once each",
     /sub: "Different people, counted once each"/.test(arrivals));
  // The word itself was settled: the service card said "Came in" and the
  // sessions card said "Entries" for the same idea — "this is meant to be
  // the session structure [...] so i dont know why its like this".
  // The old wording still appears in the notes that explain why it changed,
  // which is where it belongs. What matters is that no LABEL says it — my
  // first version of this check read the whole file and failed on a comment.
  const labels = arrivals.match(/<StatTile label=\{[^}]*\}/g) ?? [];
  ok("one word for one figure, as agreed",
     labels.length > 0 && !labels.some((l) => /Came in/.test(l)),
     `${labels.length} tiles read`);
}

// ── Neither figure is a tally of crossings ────────────────────────────────
// A room camera's tally counts every time it became sure of somebody, which
// for one person at a desk is over and over. That must never reach the tile.
{
  ok("the session tile shows attendance, never crossings",
     /never the cameras['’]\s*\n?\s*\*?\s*tally of crossings/.test(arrivals));
  ok("and falls back to the most seen at once, which is an honest floor",
     /: seenAtOnce != null && seenAtOnce > 0 \? seenAtOnce/.test(arrivals));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Each figure says what it covers.");
process.exit(fails ? 1 : 0);
