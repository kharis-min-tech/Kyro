/**
 * One building, one master seat per physical chair.
 *
 * Three weaknesses this answers, named by the church:
 *   - the same chair seen by two cameras appeared twice;
 *   - there was no way for an administrator to correct anything;
 *   - Kyro did not know where the stage was, so row A might be the back row.
 *
 * The hard part is the first, and the trap in it is obvious once stated: two
 * neighbouring identical chairs look identical, are the same size, and have
 * boxes a few pixels apart. Anything that merges on appearance merges them.
 * So nothing here merges on appearance. It merges on WHO SITS THERE — the
 * same person, in both, at the same moment, repeatedly — because nobody is in
 * two places at once and two different chairs can never produce that.
 *
 *   node tests/test_building.mjs
 */
import { Building, MERGE_EVIDENCE } from "../worker/building.js";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

// ── A hall, and two cameras pointed at it ──────────────────────────────────
//
// Six rows of eight chairs. Camera "west" sees it square on; camera "east"
// sees the same chairs from the other side, so the same chair lands somewhere
// quite different in its picture and the rows run the other way. These are
// real coordinates, not labels: nothing in the test tells Kyro which chair is
// which.
const ROWS = 6, PER_ROW = 8;
const chairAt = (r, n) => ({ r, n });
const westBox = ({ r, n }) => [120 + n * 130, 150 + r * 95, 120 + n * 130 + 90, 150 + r * 95 + 70];
const eastBox = ({ r, n }) => [1160 - n * 130 - 90, 620 - r * 95 - 70, 1160 - n * 130, 620 - r * 95];
const all = [];
for (let r = 0; r < ROWS; r++) for (let n = 0; n < PER_ROW; n++) all.push(chairAt(r, n));

const seatList = (box) => all.map((c, i) => ({ seat_id: `K${i + 1}`, bbox: box(c), section: "Main" }));

// ── 1 & 2. Two cameras, one hall ───────────────────────────────────────────
{
  const b = new Building();
  let t = 1000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox, t);
  for (const s of seatList(eastBox)) b.sawSeat("east", s.seat_id, s.bbox, t);
  ok("1. two cameras on one hall start as two sets of seats",
     b.overview().total === ROWS * PER_ROW * 2, `${b.overview().total}`);
  ok("1. and nothing has been merged on a guess", b.proposals().length === 0);

  // Now people sit down. The person register sees the same person in a west
  // seat and an east seat at the same moment, over and over.
  const reg = new IdentityRegistry({
    zoneOf: () => "Main",
    onSameChair: (a, c) => b.sameChairEvidence(a, c, true),
  });
  const look = (n) => {
    const a = (n * 2.399) % (Math.PI * 2);
    return [0.333 + 0.1 * Math.cos(a), 0.333 + 0.1 * Math.sin(a), 0.35,
      0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45, 2.5, 0.5];
  };
  const face = (n) => {
    let seed = (n * 2654435761) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    const v = new Float32Array(128);
    for (let i = 0; i < 128; i++) v[i] = rand();
    let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
    for (let i = 0; i < 128; i++) v[i] /= m;
    return v;
  };
  // Three people, in chairs 1, 2 and 20, seen by both cameras.
  const sitting = [1, 2, 20];
  for (let pass = 0; pass < MERGE_EVIDENCE + 1; pass++) {
    t += 5000;
    reg.observe("west", sitting.map((k) => ({ track: k, look: look(k), face: face(k), seat: `K${k}` })), t);
    reg.observe("east", sitting.map((k) => ({ track: 100 + k, look: look(k), face: face(k), seat: `K${k}` })), t + 500);
  }
  const props = b.proposals();
  ok("1. Kyro proposes the chairs people actually sat in", props.length === 3, `${props.length} proposed`);
  ok("1. with evidence, not a guess", props.every((p) => p.agreements >= MERGE_EVIDENCE));
  ok("2. and proposes nothing about the chairs beside them",
     props.length === 3 && b.overview().total === ROWS * PER_ROW * 2, "neighbours untouched");
  ok("1. nothing is merged until somebody says so",
     b.overview().seen_by_more_than_one_camera === 0);

  // 5. An administrator merges one.
  const p0 = props[0];
  const before = b.overview().total;
  const res = b.merge(p0.keep, p0.drop, "Kharis Admin", b.version);
  ok("5. merging works", res.ok === true, JSON.stringify(res));
  ok("5. and leaves one seat where there were two", b.overview().total === before - 1);
  const kept = b.seats.get(p0.keep);
  ok("5. the kept seat is now seen by both cameras", Object.keys(kept.views).length === 2);
  ok("5. and the other id is never reused", b.seats.get(p0.drop).status === "merged");
  ok("5. who did it is recorded", b.overview().history[0].by === "Kharis Admin"
     && /Merged/.test(b.overview().history[0].what), JSON.stringify(b.overview().history[0]));

  // 6. And can split it again when it was wrong.
  const s = b.split(p0.keep, p0.drop, "Kharis Admin", b.version);
  ok("6. splitting works", s.ok === true, JSON.stringify(s));
  ok("6. and gives both seats back", b.overview().total === before);
  ok("6. with each camera's own detection back where it was",
     Object.keys(b.seats.get(p0.keep).views).length === 1 && Object.keys(b.seats.get(p0.drop).views).length === 1);
  ok("6. and Kyro does not immediately propose it again",
     !b.proposals().some((x) => (x.keep === p0.keep && x.drop === p0.drop) || (x.keep === p0.drop && x.drop === p0.keep)));
}

// ── 3 & 10. A camera reconnecting, and restarts ────────────────────────────
{
  const b = new Building();
  let t = 1000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox, t);
  const total = b.overview().total;
  // The camera drops and comes back, reporting the same seat ids.
  t += 120_000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox, t);
  ok("3. a camera reconnecting adds no seats", b.overview().total === total, `${b.overview().total}`);

  // 10. Server restart: saved and loaded.
  const again = new Building(JSON.parse(JSON.stringify(b.save())));
  ok("10. a restart keeps every seat", again.overview().total === total);
  for (const s of seatList(westBox)) again.sawSeat("west", s.seat_id, s.bbox, t + 1000);
  ok("10. and seeing them again after it adds none", again.overview().total === total);
}

// ── 4. A camera being repositioned ─────────────────────────────────────────
{
  // The camera is moved, so every chair lands somewhere new in its picture
  // while keeping the camera's own seat ids. The master seats must follow,
  // not double.
  const b = new Building();
  let t = 1000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox, t);
  const total = b.overview().total;
  t += 60_000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox.map((v) => v + 60), t);
  ok("4. repositioning a camera does not double its seats", b.overview().total === total, `${b.overview().total}`);
  const any = [...b.seats.values()][0];
  ok("4. and the seats follow the new picture", any.views.west.bbox[0] >= 180);
}

// ── 7. Moving a seat, and undo ─────────────────────────────────────────────
{
  const b = new Building();
  b.sawSeat("west", "K1", [100, 100, 180, 170], 1000);
  const id = [...b.seats.keys()][0];
  b.move(id, "Kharis Admin", b.version, { place: { x: 0.4, y: 0.7 } });
  ok("7. a seat can be moved on the plan", b.seats.get(id).place.x === 0.4);
  b.undoLast("Kharis Admin");
  ok("7. and the move undone", b.seats.get(id).place === null);
  ok("7. with the undo itself recorded", /Undid/.test(b.overview().history[0].what));
}

// ── 8. Stage orientation ───────────────────────────────────────────────────
{
  const b = new Building();
  let t = 1000;
  for (const s of seatList(westBox)) b.sawSeat("west", s.seat_id, s.bbox, t);
  // Default: the stage is at the top, so row A is the top row of the picture.
  const top = b.seatsFor("west");
  const topA = top.filter((s) => s.row === "A");
  ok("8. row A is a full row", topA.length === PER_ROW, `${topA.length}`);
  ok("8. and nearest the top when the stage is at the top",
     topA.every((s) => s.bbox[1] < 300), JSON.stringify(topA[0]));

  // The stage is actually at the BOTTOM of this camera's picture.
  b.setStage("west", "bottom", "Kharis Admin", b.version);
  const flipped = b.seatsFor("west");
  const newA = flipped.filter((s) => s.row === "A");
  ok("8. telling Kyro the stage is at the bottom turns the rows round",
     newA.every((s) => s.bbox[1] > 500), JSON.stringify(newA[0]));
  ok("8. and the same chairs are still the same seats",
     flipped.length === top.length
     && new Set(flipped.map((s) => s.seat_id)).size === new Set(top.map((s) => s.seat_id)).size);
  // A chair that was A1 is now in the last row — the SEAT ID is unchanged.
  const wasA1 = top.find((s) => s.row === "A" && s.number === 1);
  const sameSeat = flipped.find((s) => s.seat_id === wasA1.seat_id);
  ok("8. a seat keeps its permanent id when the rows are renamed",
     !!sameSeat && sameSeat.row !== "A", `${wasA1.row}${wasA1.number} → ${sameSeat?.row}${sameSeat?.number}`);

  // Sideways: a camera looking along the rows from the side.
  b.setStage("west", "left", "Kharis Admin", b.version);
  const side = b.seatsFor("west");
  ok("8. a stage to the left makes the rows run across the picture",
     side.filter((s) => s.row === "A").every((s) => s.bbox[0] < 400));
}

// ── 9. Two administrators at once ──────────────────────────────────────────
{
  const b = new Building();
  b.sawSeat("west", "K1", [100, 100, 180, 170], 1000);
  b.sawSeat("west", "K2", [300, 100, 380, 170], 1000);
  const [a, c] = [...b.seats.keys()];
  const stale = b.version;              // what both administrators' pages show
  const first = b.reject(a, "Admin One", stale);
  ok("9. the first administrator's change goes through", first.ok === true);
  const second = b.remove(c, "Admin Two", stale);
  ok("9. the second, working from a stale page, is refused", !!second.error, JSON.stringify(second));
  ok("9. and told to reload rather than silently overruling", /Reload/.test(second.error));
  ok("9. nothing of theirs was applied", b.seats.get(c).status === "active");
  const retry = b.remove(c, "Admin Two", b.version);
  ok("9. and it works once they reload", retry.ok === true);
}

// ── 11. Existing seats survive ─────────────────────────────────────────────
{
  // A camera that has been running for weeks already has K1…K48 with
  // reservations against them. Bringing the building in must keep every one of
  // those ids: a seat somebody reserved must not become a different seat.
  const b = new Building();
  let t = 1000;
  const old = seatList(westBox);
  for (const s of old) b.sawSeat("west", s.seat_id, s.bbox, t);
  const mapped = b.seatsFor("west");
  ok("11. every existing camera seat has a master seat", mapped.length === old.length, `${mapped.length}`);
  ok("11. and each camera seat points at exactly one of them",
     new Set(old.map((s) => b.byView.get(`west#${s.seat_id}`))).size === old.length);
  // Seen again later: the same master seats, not new ones.
  t += 600_000;
  for (const s of old) b.sawSeat("west", s.seat_id, s.bbox, t);
  ok("11. and they are not recreated afterwards", b.overview().total === old.length);
}

// ── 12. None of it ever touches attendance ─────────────────────────────────
{
  const reg = new IdentityRegistry({ zoneOf: () => "Main" });
  const look = (n) => [0.333 + 0.1 * Math.cos(n), 0.333 + 0.1 * Math.sin(n), 0.35,
    0.333 + 0.09 * Math.cos(n + 1), 0.333 + 0.09 * Math.sin(n + 1), 0.45, 2.5, 0.5];
  let t = 1000;
  for (let f = 0; f < 4; f++) {
    t += 1000;
    reg.observe("west", [1, 2, 3].map((n) => ({ track: n, look: look(n), face: null, seat: `K${n}` })), t);
  }
  const before = reg.size;
  const b = new Building();
  b.sawSeat("west", "K1", [100, 100, 180, 170], t);
  const id = [...b.seats.keys()][0];
  b.confirm(id, "Kharis Admin", b.version);
  b.remove(id, "Kharis Admin", b.version);
  b.restore(id, "Kharis Admin", b.version);
  ok("12. three people", before === 3, `${before}`);
  ok("12. and confirming, removing and restoring seats changes nobody", reg.size === before, `${reg.size}`);
}

// ── Cost ───────────────────────────────────────────────────────────────────
{
  const b = new Building();
  let t = 1000;
  // Two thousand seats across four cameras — a cathedral, not Kharis.
  for (const cam of ["n", "s", "e", "w"]) {
    for (let i = 1; i <= 500; i++) b.sawSeat(cam, `K${i}`, [i % 1200, (i * 7) % 700, (i % 1200) + 70, ((i * 7) % 700) + 60], t);
  }
  const start = performance.now();
  for (const cam of ["n", "s", "e", "w"]) {
    for (let i = 1; i <= 500; i++) b.sawSeat(cam, `K${i}`, [i % 1200, (i * 7) % 700, (i % 1200) + 70, ((i * 7) % 700) + 60], t += 1);
  }
  const ms = performance.now() - start;
  console.log(`\n  ${b.overview().total} seats across four cameras: a full re-report takes ${ms.toFixed(1)} ms`);
  ok("it stays quick with thousands of seats", ms < 500, `${ms.toFixed(0)} ms`);
  const rows = performance.now();
  b.seatsFor("n");
  console.log(`  naming the rows for one camera: ${(performance.now() - rows).toFixed(1)} ms`);
}

// ── The admin interface exists, and only administrators may use it ─────────
{
  const fs2 = await import("node:fs");
  const page = fs2.readFileSync(new URL("../dashboard/src/components/ui/SeatManager.tsx", import.meta.url), "utf8");
  for (const [what, re] of [
    ["confirm a seat", /do: "confirm"/],
    ["reject a false detection", /do: "reject"/],
    ["add one Kyro missed", /do: "add"/],
    ["move a seat", /do: "move"|place:/],
    ["merge duplicates", /do: "merge"/],
    ["remove a seat that has gone", /do: "remove"/],
    ["undo the last change", /do: "undo"/],
    ["set where the stage is", /do: "stage"/],
  ]) ok(`an administrator can ${what}`, re.test(page));
  ok("destructive changes ask first", /setConfirming\(\{ what/.test(page) && /Yes, do it/.test(page));
  ok("the history is on the page, with who and when", /showHistory/.test(page) && /\{h\.by \|\| "—"\}/.test(page));
  ok("confidence is shown rather than implied", /same person in both \{p\.agreements\} times/.test(page));
  ok("operators can look but not change", /Changing it is for administrators/.test(page));

  const worker = fs2.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  ok("and the website enforces that, not just the page",
     /if \(role !== "admin"\) return json\(\{ error: "Only administrators can change the seating" \}, 403\);/.test(worker));
  ok("reading it is open to operators too",
     /Only administrators and operators can see this[\s\S]{0,120}theBuilding\(\)\)\.overview\(\)/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One chair, one seat, whoever is looking at it.");
process.exit(fails ? 1 : 0);
