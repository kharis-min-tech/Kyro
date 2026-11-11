/**
 * A full hall does not grow all morning.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * "count is wrong, make sure this is more verified, i said max in the room is
 * 114, right now theres more than 4 seats available and we are at 110" …
 * "now theres 117, i said max is 114 so i dnt know how it got to 118."
 *
 * There were free chairs in the room and the attendance was above the number
 * of chairs. Every extra person was a real person written down twice.
 *
 * The cause is not in the register's judgement, which is why it survived every
 * measurement before this one. The detector loses seated people — somebody
 * leans forward, the person in front stands up — and the camera's own tracker
 * gives them a NEW number when they come back. To the register that is a
 * stranger with no face, wearing one of the hundred coats in the hall. It
 * cannot be told from anybody else on appearance, the margin rule refuses to
 * guess, and a new person is written down. Once each, in a hall of a hundred,
 * all service.
 *
 * What fixes it is the one piece of evidence that does not get weaker in a
 * crowd: WHERE THEY WERE SITTING. See SPOT_SAME in worker/identity.js.
 *
 * These are simulations, not video, and they prove the logic rather than the
 * eyesight: that given readings of a stated quality the register arrives at
 * the right number of people. The quality of the readings from a camera at the
 * back of a real hall is a separate question, and only a labelled recording of
 * a real service can answer it.
 *
 *   node tests/test_full_hall.mjs
 */
import fs from "node:fs";
import { IdentityRegistry, overlap, SPOT_FRESH_MS, SPOT_STILL } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

// ── Believable people, as test_identity_registry.mjs makes them ─────────────

const person = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [
    0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3),
  ];
};
const wobble = (look, k = 1) => look.map((v, i) => v + (i < 6 ? 0.004 : 0.02) * k * Math.sin(v * 97 + i * 13));
/** Where seat number s is in the picture, as fractions of the frame. */
const seatBox = (s) => {
  const col = s % 12, row = Math.floor(s / 12);
  const x = col * 0.08 + 0.01, y = row * 0.09 + 0.02;
  return [x, y, x + 0.06, y + 0.07];
};

// ── The hall ────────────────────────────────────────────────────────────────

/**
 * 110 people in 114 chairs for a quarter of an hour, one camera on the room,
 * no doorway. Nobody arrives and nobody leaves, so the right answer is 110
 * from the first minute to the last.
 *
 * @param missFor     how many reports in a row the detector loses somebody
 *                    for, before finding them again under a NEW track number
 * @param alike       everybody dressed the same — a choir, a congregation in
 *                    dark coats in November. Appearance then says nothing,
 *                    which is the case this is really about.
 * @param boxes       whether the camera reports where people are. Off = how
 *                    Kyro behaved before SPOT_SAME existed.
 */
function hall({ missFor = 1, alike = false, boxes = true, minutes = 15, n = 110 } = {}) {
  const r = new IdentityRegistry({ zoneOf: () => "Main", createsIdentities: () => true });
  const truth = new Map(), mine = new Map();
  const track = new Map();
  let nextTrack = 1, t = 0, frame = 0;
  for (let w = 1; w <= n; w++) track.set(w, nextTrack++);
  const reports = Math.round((minutes * 60) / 5);      // a report every five seconds
  for (let f = 0; f < reports; f++) {
    t += 5000; frame++;
    const here = [];
    for (let w = 1; w <= n; w++) {
      // Each person is lost for `missFor` reports every so often, spread out
      // so the whole hall never disappears at once.
      if (f > 0) {
        const phase = (w * 37 + f) % 97;
        if (phase < missFor) {
          // Found again on the last of them, under a number never used before.
          if (phase === missFor - 1) track.set(w, nextTrack++);
          continue;
        }
      }
      here.push({
        track: track.get(w),
        // Seated people barely move: the box shifts by a pixel or two.
        box: boxes
          ? seatBox(w).map((v, i) => v + 0.002 * Math.sin(w * 3.1 + frame * 0.7 + i))
          : null,
        look: wobble(person(alike ? 7 : w), 1 + (frame % 4)),
        face: null,                                    // too far away to read
        who: w,
      });
    }
    r.observe("room", here, t).forEach((id, i) => {
      if (id === null) return;
      const w = here[i].who;
      if (!truth.has(id)) truth.set(id, new Set());
      truth.get(id).add(w);
      if (!mine.has(w)) mine.set(w, new Set());
      mine.get(w).add(id);
    });
  }
  return {
    counted: r.size, real: n,
    splits: [...mine.values()].reduce((a, s) => a + (s.size - 1), 0),
    merges: [...truth.values()].reduce((a, s) => a + (s.size - 1), 0),
  };
}

{
  // The failure, reproduced. This is what she was looking at.
  const was = hall({ alike: true, boxes: false });
  console.log(`\n  Before, everybody dressed alike: counted ${was.counted} of ${was.real}`
    + ` · split ${was.splits} · merged ${was.merges}`);
  ok("the old behaviour really did run away with a full hall",
     was.counted > was.real * 2, `counted ${was.counted} of ${was.real}`);

  for (const missFor of [1, 2, 4, 8]) {
    const now = hall({ alike: true, missFor });
    console.log(`  Lost for ${String(missFor * 5).padStart(2)}s at a time:    counted ${now.counted} of ${now.real}`
      + ` · split ${now.splits} · merged ${now.merges}`);
    ok(`somebody lost for ${missFor * 5}s is the same person when they come back`,
       now.counted <= 114 && now.merges === 0, `counted ${now.counted}, merged ${now.merges}`);
  }

  // And it is not doing it by lumping people together: ordinary clothes, where
  // appearance works, must come out at least as well.
  const varied = hall({ missFor: 2 });
  console.log(`  Ordinary clothes:              counted ${varied.counted} of ${varied.real}`
    + ` · split ${varied.splits} · merged ${varied.merges}`);
  ok("a hall of people in their own clothes is counted right too",
     Math.abs(varied.counted - varied.real) <= 2, `counted ${varied.counted}`);
}

// ── The chair that changes hands ────────────────────────────────────────────

/**
 * The failure this rule could cause if it were careless, measured rather than
 * argued about: ten people get up and walk out, and ten strangers sit down in
 * their exact chairs. Every one of those strangers must be a new person.
 */
function chairsChangeHands({ freeForReports, alike }) {
  const r = new IdentityRegistry({ zoneOf: () => "Main", createsIdentities: () => true });
  const truth = new Map(), mine = new Map();
  const at = new Map();                                // person → { track, seat }
  let t = 0, frame = 0, nextTrack = 1;
  const report = (who) => {
    t += 5000; frame++;
    const here = who.map((w) => ({
      track: at.get(w).track, box: seatBox(at.get(w).seat),
      look: wobble(person(alike ? 7 : w), 1 + (frame % 4)), face: null, who: w,
    }));
    r.observe("room", here, t).forEach((id, i) => {
      if (id === null) return;
      const w = here[i].who;
      if (!truth.has(id)) truth.set(id, new Set());
      truth.get(id).add(w);
      if (!mine.has(w)) mine.set(w, new Set());
      mine.get(w).add(id);
    });
  };
  const all = Array.from({ length: 40 }, (_, i) => i + 1);
  all.forEach((w) => at.set(w, { track: nextTrack++, seat: w }));
  for (let f = 0; f < 60; f++) report(all);            // five minutes, settled

  const leaving = all.filter((w) => w % 4 === 0);
  const staying = all.filter((w) => w % 4 !== 0);
  // They stand up and walk out: three reports of their box moving away.
  for (let step = 1; step <= 3; step++) {
    leaving.forEach((w) => { at.get(w).seat += 3; });
    report(all);
  }
  leaving.forEach((w) => { at.get(w).seat -= 9; });    // back to their own chair
  for (let f = 0; f < freeForReports; f++) report(staying);

  const strangers = leaving.map((w, i) => {
    const fresh = 100 + i;
    at.set(fresh, { track: nextTrack++, seat: at.get(w).seat });
    return fresh;
  });
  for (let f = 0; f < 60; f++) report([...staying, ...strangers]);
  return {
    counted: r.size, real: 50,
    merges: [...truth.values()].reduce((a, s) => a + (s.size - 1), 0),
  };
}

{
  console.log("");
  for (const alike of [false, true]) {
    for (const freeForReports of [1, 3, 6]) {
      const x = chairsChangeHands({ freeForReports, alike });
      const how = alike ? "dressed alike" : "own clothes ";
      console.log(`  ${how}, chair free ${String(freeForReports * 5).padStart(2)}s: counted ${x.counted} of ${x.real}`
        + ` · merged ${x.merges}`);
      // Without the spot rule this scenario merges five of the people in
      // ordinary clothes, on appearance alone — it did so before this rule
      // existed and still does. What matters here is that the spot rule adds
      // nothing to that, and in particular costs nothing in the case it was
      // built for, where everybody is dressed the same.
      if (alike) {
        ok(`a stranger in a chair free for ${freeForReports * 5}s is a stranger`,
           x.merges === 0, `merged ${x.merges}`);
      } else {
        ok(`ordinary clothes, chair free ${freeForReports * 5}s: no worse than appearance alone`,
           x.merges <= 5, `merged ${x.merges}`);
      }
    }
  }
}

// ── The guards, stated rather than implied ──────────────────────────────────

{
  const src = fs.readFileSync(new URL("../worker/identity.js", import.meta.url), "utf8");
  ok("a doorway never matches people by where they are standing",
     src.indexOf("if (!this.createsIdentities(cameraId)) return null;") < src.indexOf("const spots = [];"),
     "the spot rule must sit below the line a doorway camera returns at");
  ok("a spot goes stale", SPOT_FRESH_MS > 0 && SPOT_FRESH_MS <= 60_000, `${SPOT_FRESH_MS}ms`);
  ok("and only counts for somebody who was sitting still", SPOT_STILL >= 0.5, `${SPOT_STILL}`);
  ok("a face that says otherwise still settles it",
     /faceScore\(best\.p\) < FACE_DIFFERENT/.test(src.slice(src.indexOf("const spots = ["))));
  ok("two boxes that share nothing overlap by nothing", overlap([0, 0, 0.1, 0.1], [0.5, 0.5, 0.6, 0.6]) === 0);
  ok("and a box with itself is the same place", overlap([0.2, 0.2, 0.4, 0.5], [0.2, 0.2, 0.4, 0.5]) === 1);
  ok("the camera sends where people are, as fractions of the frame",
     /b: \[x\.box\[0\] \/ frameW/.test(fs.readFileSync(new URL("../dashboard/src/lib/CountingContext.tsx", import.meta.url), "utf8")));
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  ok("and the website reads it back", /box: Array\.isArray\(x\.b\) && x\.b\.length === 4/.test(worker));
}

// ── The count has to answer to the room ─────────────────────────────────────

{
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  ok("attendance above the seat count is reported",
     /attendance_over_seats: seatsHere > 0 && \(this\.register\?\.size \|\| 0\) > seatsHere/.test(worker));
  ok("with how many have left, so the sum can be checked",
     /left: Math\.max\(0, this\.register\.size - \(this\.register\.inBuilding\?\.\(\) \?\? 0\)\)/.test(worker));
  ok("built from capacities somebody entered, never ones Kyro guessed",
     /const cap = rooms\.reduce\(\(n, r\) => n \+ \(r\.capacity_from === "admin" \? r\.capacity \|\| 0 : 0\), 0\);/.test(worker));
  ok("the figure is never quietly capped at the seat count",
     !/people_seen: Math\.min/.test(worker));
  /**
   * And the figure on the screen is held at the seats.
   *
   * "change this to 114, because i dont know how you got this number, i dont
   * think you listen, i said the max is 114 in this room, so it must be
   * inaccurate for you to put this number."
   *
   * Her call, and the right one: a seat count entered by the person who
   * knows the building beats a measurement by something that has just been
   * shown to double-count. What is held is the display. The measurement, the
   * register, the people table and the downloads are untouched, and the card
   * prints what was measured beside what it is showing — so this can never
   * become a number nobody can check.
   */
  ok("the figure on the screen is held at the seat count",
     /people_seen_shown: seatsHere > 0 && \(this\.register\?\.size \|\| 0\) > seatsHere\s*\n\s*\? seatsHere/.test(worker));
  /**
   * And the seats are a fact about the HALL, not about a camera.
   *
   * "both cameras are set as entrance and exit."
   *
   * Seats were stored against a room camera. A building whose cameras are
   * all on doorways has no room — so there was nowhere to put a seat count,
   * the field never appeared, the number entered on her behalf had nothing
   * to attach to, and every version of the hold checked an attendance of 280
   * against a capacity of zero and let it through. Six rounds of "114 is
   * still not there", and the number had nowhere to live.
   */
  ok("the seats fall back to what the church has stated about the building",
     /const seatsHere = cap > 0 \? cap : SEATS_IN_THE_HALL;/.test(worker));
  ok("and the hold is checked against that, not against a camera's capacity",
     /attendance_over_seats: seatsHere > 0 && \(this\.register\?\.size \|\| 0\) > seatsHere/.test(worker));
  // But NOT "spaces left" or "how full": a building with no camera on a room
  // genuinely cannot say how full it is, and must not pretend to.
  ok("while how-full still needs a camera actually watching a room",
     /over_capacity: cap > 0 && hereNow > cap/.test(worker)
     && /total_capacity: cap,/.test(worker));
  ok("and having no camera on a room is said out loud, not left to be noticed",
     /Every camera is set as a doorway, so nothing is watching the room itself\./.test(worker));
  ok("with the two clicks that fix it",
     /set its location to the indoor /.test(worker));
  ok("cleared the moment one is", /\} else if \(anyRoom\) \{\s*\n\s*await this\.working\("Cameras"\);/.test(worker));
  ok("but the measurement itself is not touched",
     /people_seen: this\.register\?\.size \?\? sum\("people"\),/.test(worker));
  const card = fs.readFileSync(new URL("../dashboard/src/components/ui/ArrivalTimes.tsx", import.meta.url), "utf8");
  ok("and the card says so where the number is", /Held at \{overSeats\.seats\.toLocaleString\(\)\}, the number of seats in this room/.test(card));
  ok("printing what was measured beside what it shows",
     /Kyro counted \$\{summary\.totalArrived\.toLocaleString\(\)\}/.test(card));
  ok("only ever against the register, never a tally of crossings",
     /const held = overSeats && usingRegister && summary\.totalArrived > overSeats\.seats \? overSeats\.seats : null;/.test(card));
  const svc = fs.readFileSync(new URL("../dashboard/src/components/ui/AutoServices.tsx", import.meta.url), "utf8");
  ok("the service card is held to the same figure", /people_seen_shown/.test(svc));

  /**
   * Both figures, or neither.
   *
   * "how is there 114 in when 274 is out, dosent make sense."
   *
   * The arrivals were held at the seat count and the departures left as
   * measured, so the card read 114 in and 273 out. Two figures contradicting
   * each other are worse than one figure that is wrong: the reader now has
   * to work out which of them to disbelieve.
   *
   * What is kept true is the quantity a church actually uses — how many are
   * still in the building — because being seen in the last five minutes is a
   * direct observation rather than a tally of everyone ever.
   */
  ok("the departures are held with the arrivals",
     /const heldLeft = held != null/.test(card));
  ok("by whatever keeps 'still here' true",
     /Math\.max\(0, held - Math\.max\(0, summary\.totalArrived - summary\.totalLeft\)\)/.test(card));
  ok("and the tile says it is held, and what it still means",
     /Held with the figure beside it/.test(card) && /still here`/.test(card));
  // The arithmetic itself, on the numbers she was looking at and the edges
  // around them.
  const pair = (arrived, left, seats) => {
    const h = arrived > seats ? seats : null;
    const hl = h != null ? Math.max(0, h - Math.max(0, arrived - left)) : null;
    return [h ?? arrived, hl ?? left];
  };
  ok("114 in and 93 out, not 114 in and 273 out",
     JSON.stringify(pair(294, 273, 114)) === JSON.stringify([114, 93]), JSON.stringify(pair(294, 273, 114)));
  ok("under the seat count nothing is held at all",
     JSON.stringify(pair(90, 60, 114)) === JSON.stringify([90, 60]));
  ok("and it never goes below nobody",
     pair(294, 0, 114)[1] === 0, JSON.stringify(pair(294, 0, 114)));
  ok("with the people still in the building kept exactly right",
     pair(300, 299, 114)[0] - pair(300, 299, 114)[1] === 1);
  const page = fs.readFileSync(new URL("../dashboard/src/app/attendance/page.tsx", import.meta.url), "utf8");
  ok("fed from the live figures, today only", /overSeats=\{edge && isToday/.test(page));

  /**
   * And the seat count can be given FROM HERE.
   *
   * "change to 114, switch it, its innacuratre" — the third time, about a
   * figure that had reached 208. The hold at the seat count was written,
   * deployed and doing nothing, because it only ever fires against a seat
   * count somebody entered and nobody had. She had been told to go to
   * Cameras, press the pencil and find Seat capacity: three screens from the
   * number that is wrong, which is three chances to give up.
   *
   * A setting that the thing it fixes cannot ask for is a setting nobody
   * will find.
   */
  ok("the card asks for the seat count where the figure is",
     /How many seats are in this room\?/.test(card));
  ok("only when Kyro has not been told", /\{usingRegister && onSetSeats && \(!seats \|\| seatDraft !== ""\) && \(/.test(card));
  ok("and the figure it is held at can be corrected from there too",
     /change it<\/button>/.test(card));
  ok("the page works out the seats a room at a time, never adding two cameras on one room",
     /byRoom\.set\(room, Math\.max\(byRoom\.get\(room\) \?\? 0, c\.zone_capacity \?\? 0\)\);/.test(page));
  ok("and writes the number to every room camera", /for \(const c of rooms\) await updateCamera\(c\.camera_id, \{ zone_capacity: n \}\);/.test(page));
  ok("never to a doorway or a queue, which have no seats",
     /cameras\.filter\(\(c\) => c\.location !== "entrance" && c\.location !== "queue"\)/.test(page));
  ok("an operator may set it as well as an administrator",
     /\(role === "admin" \|\| role === "operator"\) \? setRoomSeats : undefined\}/.test(page));
  ok("and the way to fix the figure sits under the figure",
     /Kyro doesn't know how many seats this room has\. Set it/.test(card));
  ok("with the field scrolled to rather than hunted for", /seatBox\.current\?\.scrollIntoView/.test(card));
}

// ── Two boxes, one person ───────────────────────────────────────────────────

/**
 * "[the man with two boxes round him] who are you counting, make this right."
 *
 * One camera drew two boxes on one man — one round his left side and the
 * television behind him, one round his head and shoulders. They barely
 * overlapped, so nothing that compares boxes caught it.
 *
 * The register cannot simply join them: an identity may be claimed by at most
 * one sighting from one camera at one moment, and that rule is what keeps two
 * people standing side by side from collapsing into one. What it CAN do is
 * notice, and say so, which is a question two pictures settle in a second.
 */
{
  const r = new IdentityRegistry({ zoneOf: () => "Main", createsIdentities: () => true });
  let t = 0;
  const him = wobble(person(4), 2);
  // Settled, one box, one person.
  for (let f = 0; f < 10; f++) {
    t += 5000;
    r.observe("room", [{ track: 1, look: wobble(person(4), 1 + (f % 4)), box: [0.3, 0.2, 0.45, 0.8] }], t);
  }
  const before = r.size;
  // Now the detector cuts him in half: a second box, same clothes, same moment.
  for (let f = 0; f < 6; f++) {
    t += 5000;
    r.observe("room", [
      { track: 1, look: wobble(person(4), 1 + (f % 4)), box: [0.3, 0.2, 0.45, 0.8] },
      { track: 500, look: him, box: [0.44, 0.25, 0.56, 0.8] },
    ], t);
  }
  ok("one person is still one person until it is told otherwise", before === 1, `${before}`);
  const asks = r.takeAsks();
  const raised = asks.find((a) => /two boxes/.test(a.reason ?? ""));
  ok("and Kyro says out loud that it has drawn two boxes on one person", !!raised,
     `asks: ${asks.map((a) => a.reason).join(" | ") || "none"}`);
  ok("naming the person it thinks the second box already is", raised?.person === 1, `${raised?.person}`);
  ok("and the entry it made, so answering \"same\" can undo it", !!raised?.made, `${raised?.made}`);
  ok("it is counted, so how often it happens can be seen",
     r.diagnostics().two_boxes_one_person >= 1, `${r.diagnostics().two_boxes_one_person}`);
}

// ── The number is in, without a form ────────────────────────────────────────

/**
 * "just cHANGE IT To 114."
 *
 * She told Kyro how many seats this room has six separate times, in the only
 * channel she had, while the figure on her screen climbed from 110 to 270.
 * Every version of the hold needs that one number and none of them ever got
 * it — the field was on a settings page she could not find, then on a card
 * her browser was too old to show, then behind a permission her login may not
 * have had. The number was never in doubt. The form was.
 */
{
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  ok("the seats in the hall are written down where nothing can lose them",
     /const SEATS_IN_THE_HALL = 114;/.test(worker));
  ok("and put in on the church's behalf when nothing else has answered",
     /for \(const c of rooms\) \{ c\.zone_capacity = SEATS_IN_THE_HALL; c\.capacity_from = "admin"; \}/.test(worker));
  ok("only when no room camera has a capacity at all",
     /const told = rooms\.some\(\(c\) => c\.capacity_from === "admin" && c\.zone_capacity > 0\);/.test(worker)
     && /if \(rooms\.length && !told\) \{/.test(worker));
  ok("never on a doorway or a queue, and never on a hidden camera",
     /c && !c\.hidden && c\.location !== "entrance" && c\.location !== "queue"\);/.test(worker));
  ok("it never invents a room to seat", /if \(rooms\.length && !told\)/.test(worker));
  ok("and it is hers to change, for good, the moment she sets one",
     /overridden by\s*\n \* anybody who sets a seat count on the Cameras page, for good\./.test(worker));
  // The whole point: once it is in, the hold has something to hold against.
  ok("so the hold finally has a number to answer to",
     /attendance_over_seats: seatsHere > 0 && \(this\.register\?\.size \|\| 0\) > seatsHere/.test(worker));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A hall of 114 chairs does not hold 300 people.");
process.exit(fails ? 1 : 0);
