/**
 * "No — those are two different chairs."
 *
 * The duplicate-chair panel offered one button, "One chair". A pair you
 * disagreed with had no answer: it stayed on the list for ever, in front of
 * every other pair, and the only way to clear it was to accept a merge you
 * believed was wrong. Two chairs side by side look identical to a camera, so
 * disagreeing is the common case, not the rare one.
 *
 * What this checks is not that a button exists but that saying so STICKS:
 * off the list, still off it after a restart, attributed to whoever said it,
 * and undoable — because a person's answer that quietly does nothing is
 * worse than no button at all.
 *
 *   node tests/test_two_different_chairs.mjs
 */
import { Building, MERGE_EVIDENCE } from "../worker/building.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

/** Two cameras, each seeing two chairs; enough evidence to propose a merge. */
const hall = () => {
  const b = new Building();
  const t = 1000;
  b.sawSeat("west", "K1", [100, 100, 190, 170], t);
  b.sawSeat("west", "K2", [230, 100, 320, 170], t);
  b.sawSeat("east", "K1", [700, 400, 790, 470], t);
  b.sawSeat("east", "K2", [830, 400, 920, 470], t);
  for (let i = 0; i < MERGE_EVIDENCE + 2; i++) b.sameChairEvidence("west#K1", "east#K1", true);
  return b;
};

// ── 1. A pair is proposed, and knows which camera saw each half ────────────
{
  const b = hall();
  const [p] = b.proposals();
  ok("1. the pair is proposed", !!p, `${b.proposals().length} proposals`);
  ok("1. and names the camera each seat came from",
     p?.cameras?.length === 2 && p.cameras.includes("west") && p.cameras.includes("east"),
     JSON.stringify(p?.cameras));
  ok("1. and carries the two views, which is what the answer needs",
     p?.views?.length === 2, JSON.stringify(p?.views));
}

// ── 2. Saying "different chairs" takes it off the list ─────────────────────
{
  const b = hall();
  const p = b.proposals()[0];
  const r = b.notOneChair(p.views[0], p.views[1], "ruth", b.version);
  ok("2. the answer is accepted", r?.ok === true, JSON.stringify(r));
  ok("2. and the pair is off the list", b.proposals().length === 0,
     `${b.proposals().length} still proposed`);

  // The cameras keep watching. More agreement must not bring it back: the
  // evidence that produced it is exactly the evidence a person overruled.
  for (let i = 0; i < 50; i++) b.sameChairEvidence(p.views[0], p.views[1], true);
  ok("2. and stays off it however much the cameras keep agreeing",
     b.proposals().length === 0, `${b.proposals().length} came back`);
}

// ── 3. It is recorded against whoever said it ──────────────────────────────
{
  const b = hall();
  const p = b.proposals()[0];
  const before = b.version;
  b.notOneChair(p.views[0], p.views[1], "ruth", before);
  const top = b.overview().history[0];
  ok("3. the history records it", /different chairs/i.test(top?.what ?? ""), top?.what);
  ok("3. and names both seats", top?.what?.includes(p.keep) && top?.what?.includes(p.drop), top?.what);
  ok("3. and who said it", top?.by === "ruth", top?.by);
  ok("3. and the version moved, so another open page is told to reload",
     b.version > before, `${before} → ${b.version}`);
}

// ── 4. A page opened ten minutes ago cannot overrule a newer answer ────────
{
  const b = hall();
  const p = b.proposals()[0];
  const r = b.notOneChair(p.views[0], p.views[1], "ruth", b.version - 1);
  ok("4. a stale page is refused", !!r?.error, JSON.stringify(r));
  ok("4. and nothing changed", b.proposals().length === 1);
}

// ── 5. It survives a restart ───────────────────────────────────────────────
{
  const b = hall();
  const p = b.proposals()[0];
  b.notOneChair(p.views[0], p.views[1], "ruth", b.version);
  const again = new Building(JSON.parse(JSON.stringify(b.save())));
  ok("5. still off the list after a restart", again.proposals().length === 0,
     `${again.proposals().length} came back`);
}

// ── 6. Undo puts it back, because people press the wrong button ────────────
{
  const b = hall();
  const p = b.proposals()[0];
  b.notOneChair(p.views[0], p.views[1], "ruth", b.version);
  const r = b.undoLast("ruth");
  ok("6. undo is accepted", !r?.error, JSON.stringify(r));
  ok("6. and the pair is back to be decided again", b.proposals().length === 1,
     `${b.proposals().length} proposals`);
}

// ── 7. The other pairs are untouched ───────────────────────────────────────
{
  const b = hall();
  for (let i = 0; i < MERGE_EVIDENCE + 2; i++) b.sameChairEvidence("west#K2", "east#K2", true);
  ok("7. two pairs to start with", b.proposals().length === 2);
  const p = b.proposals().find((x) => x.views.includes("west#K1"));
  b.notOneChair(p.views[0], p.views[1], "ruth", b.version);
  const left = b.proposals();
  ok("7. answering one leaves the other", left.length === 1, `${left.length} left`);
  ok("7. and it is the other one", left[0].views.includes("west#K2"), JSON.stringify(left[0].views));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
