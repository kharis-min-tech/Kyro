/**
 * Follows each person from one count to the next, so Kyro can say how many
 * people arrived and how many left.
 *
 * Counting in a browser used to send zero for both, because it only ever looked
 * at one picture at a time. That became possible once a count took about a third
 * of a second instead of one and a half.
 *
 * Deliberately slow to believe anything. The earlier attempt on the camera
 * computer reported ten arrivals for someone who never moved, because every
 * flicker in the AI's detection looked like a person appearing. So:
 *
 *   - a new box must be seen SEEN_TO_CONFIRM counts in a row before it counts
 *     as someone arriving;
 *   - a person must be missing MISSING_TO_LEAVE counts in a row before they
 *     count as having left.
 *
 * Someone blinking in and out of the AI's view therefore changes nothing.
 */

export interface Box { box: [number, number, number, number] }

export interface Look {
  /** Upper body: share of red, share of green, brightness. All 0–1. */
  top: [number, number, number];
  /** Lower body, the same way. */
  bottom: [number, number, number];
  /** Taller than wide, as a ratio: a standing adult is about 2.5. */
  shape: number;
  /** How tall they are in the picture, 0–1. Stands in for how far away. */
  height: number;
}

/** How alike two looks are, 0–1. Same clothes, same build, same distance → near 1. */
export function alikeLook(a: Look, b: Look): number {
  // Colour does most of the work, because the share of the light a coat sends
  // back barely changes with how much light there is.
  const chroma = (p: [number, number, number], q: [number, number, number]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  // Brightness is the only thing that tells a black shirt from a white one,
  // and it is also the thing that changes most between a sunlit doorway and
  // three steps inside it. So the weight is on the difference BETWEEN someone's
  // top and bottom — light shirt over dark trousers, or the other way about —
  // which a change in the lighting moves both of together and so leaves alone.
  // How bright they are overall still counts, gently.
  const contrast = Math.abs((a.top[2] - a.bottom[2]) - (b.top[2] - b.bottom[2]));
  const overall = Math.abs((a.top[2] + a.bottom[2]) / 2 - (b.top[2] + b.bottom[2]) / 2);
  // Build: someone doesn't change shape between two counts, but a box drawn
  // around them does wobble, so this is deliberately forgiving.
  const shape = Math.abs(a.shape - b.shape) / Math.max(a.shape, b.shape, 1);
  const size = Math.abs(a.height - b.height) / Math.max(a.height, b.height, 0.01);
  const d = 3.0 * chroma(a.top, b.top)
          + 2.0 * chroma(a.bottom, b.bottom)
          + 1.0 * contrast
          + 0.25 * overall
          + 0.4 * shape
          + 0.5 * size;
  return Math.max(0, 1 - d);
}

/** How alike two face codes are, 0–1 (see faceEngine). */
function alike(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}
/** Two codes this alike are the same person — measured on 600 standard face pairs. */
const SAME_FACE = 0.4;
/**
 * How alike two people must LOOK — clothes, build, how tall they are in the
 * picture — before Kyro will say they are the same person who was standing
 * here a moment ago. See lib/appearance.ts.
 *
 * Set high on purpose. The cost of being wrong is not symmetrical: merging two
 * people loses a departure that really happened and quietly undercounts the
 * room, which is worse than counting one person twice.
 */
const SAME_LOOK = 0.78;
/**
 * And it must be a clear winner.
 *
 * A church doorway in November is a row of dark coats. If four people in the
 * last few minutes look about equally like the person who just appeared, then
 * "looks the same" is worth nothing, and the honest answer is that Kyro does
 * not know. So the best match must beat the next best by this much, or no
 * match is made at all.
 *
 * Twice what it was. Three people in near-identical coats walking out one
 * after another were close enough that the third was claimed by the second,
 * and a margin that small is not evidence of anything. A coat identifies
 * somebody in a crowd only when it genuinely stands out; a face does the rest.
 */
const LOOK_MARGIN = 0.12;
/**
 * How long a look is believable as identity.
 *
 * Longer than a position, which goes stale in seconds because everyone walks
 * through the same patch of doorway. Not indefinite: people take coats off,
 * turn round, and stand in different light.
 */
const RETURN_BY_LOOK_MS = 90_000;
/**
 * How many people are remembered after they have walked out of view.
 *
 * An usher stands at the door all morning: holding it open, walking a visitor
 * to a seat, stepping back out. Every one of those trips looked like a person
 * arriving, and the morning's figure climbed all day on one person doing their
 * job. So somebody Kyro has counted in stays counted in — not for a few
 * minutes, but until the service ends and everybody is forgotten at once.
 *
 * Remembered means their coat and build, and their face when face matching is
 * on. It is held in the browser doing the counting, never written down, never
 * sent anywhere, and dropped the moment the service is over — the same life as
 * the face data it sits beside.
 *
 * The cap is what a very large service might put through one door. Past it the
 * oldest are forgotten first, which is the right order: the person who walked
 * in two hours ago and hasn't been seen since is the one least likely to be
 * about to walk through again.
 */
const MOST_REMEMBERED = 800;

// A score that rises when the person is seen and falls when they are not, so a
// box that only flickers in and out never reaches it. Simply totalling sightings
// wasn't enough: a false box appearing every other count still added up.
const SCORE_TO_CONFIRM = 3;
/**
 * The same, at a doorway.
 *
 * Three sightings is right for a room, where a person stays in view for
 * minutes and the only thing three protects against is a flickering false box.
 * At a door it is a different bargain: someone crosses in a second or two, so
 * at two or three counts a second they are seen two or three times in total.
 * Asking for three meant the quick ones were never confirmed, and a camera
 * watching a busy entrance reported "0 in, 1 out" while people streamed
 * through it.
 *
 * Two is safe here in a way it would not be on a room, because a doorway count
 * has a second test a room has none of: the person must also have travelled a
 * clear distance in one direction before they are counted at all (see
 * wentIn). A box that flickers in and out doesn't travel anywhere, so it
 * still counts for nothing.
 */
const DOOR_SCORE_TO_CONFIRM = 2;
/**
 * How long someone must be out of sight before they count as having left.
 *
 * This was 8 counts (~2.5 s), which counted the same people in and out over and
 * over: turn away from the camera, or stand behind someone, and you had "left"
 * and then "arrived" again. In seconds rather than counts, so it doesn't change
 * with how fast the computer is.
 */
const GRACE_MS = 45_000;
/**
 * The same wait, at a doorway.
 *
 * Forty-five seconds is right for a room, where someone turning away or
 * standing behind a pillar must not be counted out and back in. At a door
 * people pass through in a couple of seconds, so that long a wait means the
 * morning's arrivals only appear three quarters of a minute after they
 * happened — and during a rush, barely at all.
 *
 * But it cannot be too short either, and this is the whole of the protection
 * against counting one person twice. While someone's track is still alive they
 * can be recognised on their way back into view — by face if faces are being
 * read, otherwise by reappearing near where they were, at the same size — and
 * they carry on as the same person. Once the track is let go, the same person
 * stepping back into view is a stranger, and leaving again is a second
 * departure that never happened.
 *
 * Twelve seconds covers someone pausing in the doorway, being hidden behind
 * whoever is next through it, or turning back to say goodbye, while still
 * reporting a departure quickly enough to watch a room empty.
 */
const DOOR_GRACE_MS = 5 * 60_000;
/**
 * How long "they came back near where they were" is still believable.
 *
 * Position is weak evidence of identity at a doorway, because everybody walks
 * through the same patch of picture. Over a few seconds it is sound: that
 * really is the person who was just there. Over minutes it is not — the next
 * person through the same door looks exactly as convincing, and merging them
 * loses a departure that did happen.
 *
 * So a track can wait out the whole grace, but only a face may claim it back
 * after this. A face is evidence about the person; a position is evidence
 * about the door.
 */
const RETURN_BY_PLACE_MS = 15_000;
/**
 * How long someone must be out of a doorway camera's view before their
 * departure is counted.
 *
 * Separate from how long their track is kept. Waiting the whole grace before
 * counting meant watching a room empty with the figure five minutes behind —
 * no use to anyone standing there. Fifteen seconds is long enough that a pause
 * in the doorway, or being hidden behind the two people coming through next,
 * doesn't count as leaving, and short enough to watch the room empty as it
 * happens.
 *
 * The track lives on afterwards, marked as already counted, so the same person
 * coming back is still recognised and never counted twice. Prompt and careful
 * are not in conflict here — they were only tied together by one number doing
 * both jobs.
 */
const DOOR_DECIDE_MS = 15_000;
const SAME_PERSON_IOU = 0.3;   // overlap between counts that means "same person"
/** Someone who went out of sight and came back nearby is the same person, not a new arrival. */
const RETURN_WITHIN_WIDTHS = 3;

interface Track {
  id: number;
  box: [number, number, number, number];
  score: number;               // rises when seen, falls when missed
  missing: number;
  lastSeen: number;            // when they were last actually seen
  counted: boolean;            // confirmed to be a person, so part of "in the room now"
  /**
   * Counted as having ARRIVED in this session's tally.
   *
   * Separate from `counted`, which it used to share. `counted` means "Kyro is
   * sure this is a person", and it is what the live figure is made of — so it
   * cannot be cleared when a session's tallies start again without the count
   * of people in the room blinking to nothing. But it was also the flag that
   * let a departure be tallied, so after a reset the people still in shot
   * could only ever subtract: a tile read 4 out against 2 in, which is more
   * people leaving than ever arrived, and is not possible anywhere.
   *
   * Somebody already being watched when a session starts is in neither
   * figure. They did not arrive during it, so they cannot leave during it.
   */
  arrived: boolean;
  /**
   * How long this box has barely moved, in milliseconds, and where it was
   * when it last did.
   *
   * ── Why ────────────────────────────────────────────────────────────────
   *
   * "it counted my pillow as another person now my count data went up and
   * its now false information".
   *
   * The AI is asked where the people are and it answers honestly: that
   * cushion is person-shaped. Nothing in a single picture can settle it —
   * and nothing needs to, because the difference shows up over time. A
   * seated human being is never still. They breathe, shift, turn their
   * head, cross their legs; the box round them moves by a few pixels every
   * second for as long as they are there. A pillow, a coat over a chair, a
   * statue, a mannequin, a poster does not move at all, ever.
   *
   * So this is measured rather than guessed at, and it is only ever used to
   * ASK — see STILL_ENOUGH_MS. Somebody genuinely asleep in a back pew must
   * not be quietly deleted from a church's attendance because they kept
   * still, so nothing is removed without a person saying so.
   */
  stillSince: number;
  stillBox: [number, number, number, number];
  face: Float32Array | null;   // their face code, when one could be read
  /** What they looked like: clothing colours, build, height. Never stored. */
  look: Look | null;
  /** Where they were first seen, for a doorway camera to tell which way they went. */
  firstBox: [number, number, number, number];
  /** Already added to the arrivals or departures, so never added again. */
  tallied: boolean;
  /** Already counted walking in, and already counted walking out. */
  countedIn: boolean;
  countedOut: boolean;
  /** Somebody Kyro had seen before — not a new person for the unique count. */
  returning: boolean;
  /** Already added to the count of different people seen. */
  uniqued: boolean;
}

/**
 * Which way is "in", as seen by a camera watching a doorway.
 *
 * "closer" means people coming in walk towards the camera, so their box grows.
 * "away" is the reverse. "left" and "right" are for a camera looking across a
 * doorway rather than along it.
 */
export type Inward = "closer" | "away" | "left" | "right";

/** Sideways movement smaller than this is shifting weight, not walking. */
const MOVED_ENOUGH = 0.25;        // of their own width
/** A change in height smaller than this doesn't say which way someone walked. */
const SIZE_ENOUGH = 0.12;
/**
 * How far someone's feet must travel up or down the picture, as a share of
 * their own height, before that says which way they went.
 *
 * Height alone is not enough through a doorway. Seen through a door the walk
 * in view can be short, and someone already out in the lobby when Kyro first
 * spots them barely changes size at all — so every direction came back "can't
 * tell" and the camera reported nobody in and nobody out while a room emptied.
 *
 * Where someone's feet are is the stronger signal in a view like that: walk
 * away from a camera and your feet rise up the picture, walk towards it and
 * they come down. Measured against their own height so it holds whether they
 * are near or far.
 */
const FEET_ENOUGH = 0.35;

/**
 * Which way one person went, or null if they didn't really go anywhere.
 *
 * A camera on a door cannot tell arrivals from departures by watching people
 * appear and disappear: everybody does both, whichever way they are walking.
 * That is why a door camera reported "12 in, 0 out" with people streaming
 * past in both directions. The direction of travel is the whole of the
 * information, so it is what gets counted.
 */
export function wentIn(
  first: [number, number, number, number],
  last: [number, number, number, number],
  inward: Inward,
): boolean | null {
  const cx = (b: [number, number, number, number]) => (b[0] + b[2]) / 2;
  const w = (b: [number, number, number, number]) => Math.max(1, b[2] - b[0]);
  const h = (b: [number, number, number, number]) => Math.max(1, b[3] - b[1]);

  if (inward === "left" || inward === "right") {
    const moved = cx(last) - cx(first);
    const enough = Math.max(w(first), w(last)) * MOVED_ENOUGH;
    if (Math.abs(moved) < enough) return null;
    const wentLeft = moved < 0;
    return inward === "left" ? wentLeft : !wentLeft;
  }

  // Walking towards the camera makes a person taller in the picture. Height is
  // steadier than width, which changes with how someone is standing.
  const grew = h(last) / h(first);
  if (Math.abs(grew - 1) >= SIZE_ENOUGH) {
    return inward === "closer" ? grew > 1 : grew < 1;
  }

  // Too small a change in height to call. Where their feet went still says it:
  // walking away lifts them up the picture, walking towards it brings them
  // down. Positive here means the feet rose, so they walked away.
  const rose = (first[3] - last[3]) / Math.max(1, (h(first) + h(last)) / 2);
  if (Math.abs(rose) >= FEET_ENOUGH) {
    const cameCloser = rose < 0;
    return inward === "closer" ? cameCloser : !cameCloser;
  }

  return null;
}

/** Centre-to-centre distance, in multiples of the wider box's width. */
function apart(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ax = (a[0] + a[2]) / 2, ay = (a[1] + a[3]) / 2;
  const bx = (b[0] + b[2]) / 2, by = (b[1] + b[3]) / 2;
  const w = Math.max(a[2] - a[0], b[2] - b[0]) || 1;
  return Math.hypot(ax - bx, ay - by) / w;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * How far a box may move and still count as not having moved.
 *
 * As a fraction of its own height, so it means the same for somebody at the
 * front and somebody across the hall. A person's box twitches by well over
 * this every few seconds; the detector's own jitter on a motionless object is
 * well under it.
 */
const STILL_WITHIN = 0.02;
/**
 * How long something has to not move at all before Kyro asks about it.
 *
 * Four minutes. Long enough that nobody sitting attentively through a reading
 * is asked about, short enough that a cushion is spotted within a hymn.
 */
export const STILL_ENOUGH_MS = 4 * 60_000;

/** Somebody who has walked out of view, and what they were counted as. */
interface Known {
  look: Look | null;
  face: Float32Array | null;
  countedIn: boolean;
  countedOut: boolean;
  /** Already one of the different people seen, so coming back adds nobody. */
  uniqued: boolean;
  at: number;
}

/**
 * One decision, in plain terms, so somebody standing at the door can check
 * Kyro against what they can see with their own eyes.
 *
 *   in        — counted as somebody coming in
 *   out       — counted as somebody going out
 *   again-in  — recognised: already counted in during this service, so not
 *               counted again (the usher holding the door)
 *   again-out — the same, going out
 *   unclear   — they were at the door and went back the way they came, or
 *               moved too little to say which way; counted as neither
 */
export interface DoorEvent { at: number; kind: "in" | "out" | "again-in" | "again-out" | "unclear" }
const MOST_EVENTS = 60;

export class PersonTracker {
  private tracks: Track[] = [];
  /** The last few decisions, for showing on the website. Never kept long. */
  private events: DoorEvent[] = [];
  /** People seen earlier in this service. Emptied when it ends. */
  private known: Known[] = [];
  /**
   * This camera's own id for each person it is following.
   *
   * ── Why it does not start at 1 ─────────────────────────────────────────
   *
   * The website keys who-is-who on "camera#track" and keeps that link for
   * five minutes. A fresh tracker — a reload, a camera reconnect, a tab
   * reopened — used to start numbering at 1 again, so the first person it
   * saw became "cam#1" and inherited whoever "cam#1" had been before the
   * reload. A number that is reused inside the window it is remembered in is
   * not an identity, it is a collision waiting to happen.
   *
   * So each tracker starts where the last one left off, carried in this
   * device's own storage. Nothing depends on the numbers being small.
   */
  private nextId: number;

  constructor(startId = 1) {
    this.nextId = Math.max(1, Math.floor(startId) || 1);
  }

  /** The next id this tracker will hand out, for remembering where it got to. */
  get nextTrackId(): number { return this.nextId; }
  entries = 0;
  exits = 0;
  /**
   * How many DIFFERENT people this camera has seen since the service began.
   *
   * The number a church actually wants, and the one nothing was answering.
   * "Entries" on a room camera counts every person it becomes sure of — the
   * same congregation, over and over, all service. "Entries" on a doorway
   * camera counts crossings, and one person who steps out for a phone call
   * crosses four times.
   *
   * This counts people. Somebody is added once, the first time Kyro is sure of
   * them, and never again — not when they move seats, not when they stand up,
   * not when they come back from the car park — for as long as it can
   * recognise them: by face while face matching is on, otherwise by where they
   * were a moment ago and what they are wearing.
   *
   * It is a floor, not a certainty. Every person Kyro fails to recognise is
   * one person counted twice, and a hall of similar dark coats with nobody
   * facing the camera is hard. It cannot be too LOW for the same reason, which
   * makes it the safer kind of wrong: it will not report 1,538 people at a
   * service of 900.
   *
   * Forgotten with everybody else when the service ends.
   */
  people = 0;
  /**
   * Set for a camera watching a doorway. Everyone passing a door both appears
   * and disappears, so appearing cannot mean "arrived" — only the direction
   * they walked can. While this is set, nobody is counted until they have gone
   * from view and it is clear which way they went.
   */
  private inward: Inward | null = null;

  /**
   * Told, rather than worked out: everybody crossing this doorway now is
   * leaving (or arriving).
   *
   * Kyro normally decides which way somebody went by watching them move — see
   * wentIn. That needs them in view twice, clearly enough to say which
   * direction they travelled, and at a crowded door at the end of a service it
   * is the hardest moment to get right: people are shoulder to shoulder, half
   * of them hidden behind the rest.
   *
   * At that moment the church already knows the answer. Everybody is leaving.
   * So an operator can say so, and every person the camera is sure of is
   * counted that way — no direction needed. It is the difference between a
   * guess and a fact, and the fact comes from the person standing there.
   *
   * Somebody already counted out stays counted out, so holding the door still
   * doesn't count anyone twice.
   */
  private assume: "in" | "out" | null = null;

  /**
   * Somebody this camera has just become sure of.
   *
   * ── Why this is now almost nothing ─────────────────────────────────────
   *
   * This used to count an arrival, for a camera watching a ROOM. It is the
   * single thing that produced "1 person on the camera and 6 came in".
   *
   * A room camera has no line for anybody to cross. What it can honestly
   * say is "I have become sure there is a person here" — and it says that
   * again every time it loses somebody and finds them again: a detector that
   * drops out for a minute, somebody hidden behind the person in front,
   * anybody who turns their back, a browser reloaded. Each one looked
   * exactly like somebody walking in.
   *
   * Every figure that used to be built from it now comes from the register
   * of people instead, which counts PEOPLE rather than moments of certainty
   * — so there is nothing left for this to feed, and a number nobody shows
   * is still a number somebody will eventually read. It is not produced.
   *
   * A camera on a doorway is a different thing entirely and is untouched:
   * it counts people crossing, by the direction they walked, through
   * wentIn() below.
   */
  private cameInRoom(_t: Track): void {
    // Deliberately nothing. See the note above.
  }

  /** null for a camera watching a room; a direction for one watching a door. */
  watchesDoorway(inward: Inward | null, assume: "in" | "out" | null = null): void {
    if (this.inward !== inward) { this.inward = inward; this.entries = 0; this.exits = 0; this.people = 0; this.known = []; }
    // Changing what is assumed must not reset anything: it is a change of
    // what Kyro is being told, not a new camera.
    this.assume = assume;
  }

  /** Give it this count's people; returns how many are here now (confirmed only). */
  /**
   * @param faces one face code per person, same order, null where no clear face.
   *              With them, someone who went out of sight and came back is
   *              recognised rather than counted as arriving again.
   */
  update(people: Box[], now: number = Date.now(), faces?: (Float32Array | null)[], looks?: (Look | null)[]): number {
    const boxes = people.map((p) => p.box);
    // How many sightings before this is a person: fewer at a doorway, where
    // they are only in view for a moment (see DOOR_SCORE_TO_CONFIRM).
    const confirmAt = this.inward ? DOOR_SCORE_TO_CONFIRM : SCORE_TO_CONFIRM;
    const takenTrack = new Set<number>();
    const takenBox = new Set<number>();

    // Best overlaps first, so two people close together don't swap identities.
    const pairs: { t: number; b: number; score: number }[] = [];
    this.tracks.forEach((t, ti) => boxes.forEach((b, bi) => {
      // Overlapping where someone used to be only means "the same person" for
      // as long as that is believable — see RETURN_BY_PLACE_MS. A track that
      // has been missing for a minute would otherwise swallow the next person
      // to walk through the same doorway, and their departure with them.
      if (now - t.lastSeen > RETURN_BY_PLACE_MS) return;
      const score = iou(t.box, b);
      if (score >= SAME_PERSON_IOU) pairs.push({ t: ti, b: bi, score });
    }));
    pairs.sort((x, y) => y.score - x.score);
    for (const { t, b } of pairs) {
      if (takenTrack.has(t) || takenBox.has(b)) continue;
      takenTrack.add(t); takenBox.add(b);
      const tr = this.tracks[t];
      this.noteMovement(tr, boxes[b], now);
      tr.box = boxes[b]; tr.missing = 0; tr.lastSeen = now;
      if (faces?.[b]) tr.face = faces[b];
      if (looks?.[b]) tr.look = looks[b];
      tr.score = Math.min(confirmAt + 2, tr.score + 1);
      if (!tr.counted && tr.score >= confirmAt) { tr.counted = true; this.cameInRoom(tr); }
      this.countPerson(tr);
    }

    // Mark the misses BEFORE adding new tracks, or a brand-new one is counted
    // as missed in the very update that created it and thrown away at once.
    const existing = this.tracks.length;
    this.tracks.forEach((t, ti) => {
      if (ti >= existing || takenTrack.has(ti)) return;
      t.missing++;
      if (!t.counted) t.score--;     // a flickering box loses ground as fast as it gains it
    });

    boxes.forEach((b, bi) => {
      if (takenBox.has(bi)) return;
      // Before calling this a new arrival, see whether someone we lost recently
      // has simply come back — turned round, or stepped out and returned.
      let revive = -1;
      // A face is far better evidence than a position: someone can walk right
      // across the room and still be the same person.
      const mine = faces?.[bi] ?? null;
      if (mine) {
        let bestFace = SAME_FACE;
        this.tracks.forEach((t, ti) => {
          if (takenTrack.has(ti) || t.missing === 0 || !t.face) return;
          const s = alike(t.face, mine);
          if (s >= bestFace) { bestFace = s; revive = ti; }
        });
      }
      if (revive < 0) {
        let best = RETURN_WITHIN_WIDTHS;
        this.tracks.forEach((t, ti) => {
          if (takenTrack.has(ti) || t.missing === 0) return;
          // Only recently. See RETURN_BY_PLACE_MS.
          if (now - t.lastSeen > RETURN_BY_PLACE_MS) return;
          const d = apart(t.box, b);
          const sizes = (t.box[3] - t.box[1]) / Math.max(1, b[3] - b[1]);
          if (d < best && sizes > 0.5 && sizes < 2) { best = d; revive = ti; }
        });
      }
      // Still nobody. Where they stood has stopped meaning anything, but what
      // they look like hasn't — the navy coat that stepped out of view ten
      // seconds ago. Only when one person fits clearly better than everyone
      // else: in a hall full of dark coats, "looks the same" means nothing and
      // Kyro would rather count a stranger than merge two people and lose a
      // departure. See SAME_LOOK and LOOK_MARGIN.
      const myLook = looks?.[bi] ?? null;
      if (revive < 0 && myLook) {
        let best = 0, second = 0, bestAt = -1, candidates = 0;
        this.tracks.forEach((t, ti) => {
          if (takenTrack.has(ti) || t.missing === 0 || !t.look) return;
          if (now - t.lastSeen > RETURN_BY_LOOK_MS) return;
          candidates++;
          const s = alikeLook(t.look, myLook);
          if (s > best) { second = best; best = s; bestAt = ti; }
          else if (s > second) { second = s; }
        });
        // Only in a crowd. "Clearly better than everyone else" is worth
        // nothing when there is one person to be better than — the first
        // person through a door would claim the second one on the strength of
        // a similar coat, and six people leaving a crowded hall were counted
        // as one. Somebody on their own stepping out and back is recognised by
        // where they are instead, which is the path above and far safer.
        if (candidates >= 2 && bestAt >= 0 && best >= SAME_LOOK && best - second >= LOOK_MARGIN) revive = bestAt;
      }
      if (revive >= 0) {
        const t = this.tracks[revive];
        takenTrack.add(revive);
        t.box = b; t.missing = 0; t.lastSeen = now;
        if (mine) t.face = mine;
        if (myLook) t.look = myLook;
        // Recognised, and their last crossing has already been counted — so
        // this is a new journey, not the old one carrying on. Their direction
        // is judged from here.
        //
        // Without this, someone counted in at the door could never be counted
        // out again for the rest of the five minutes they are remembered: they
        // would walk to their car and Kyro would still have them inside. And
        // with it, a person who steps out, hovers, and comes back counts out
        // then in — which nets to the truth, rather than to a departure that
        // never ended.
        if (t.tallied) { t.tallied = false; t.firstBox = b; }
        t.returning = true;   // recognised, so never a new person
        t.score = Math.min(confirmAt + 2, t.score + 1);
        if (!t.counted && t.score >= confirmAt) { t.counted = true; this.cameInRoom(t); }
        this.countPerson(t);
        return;
      }
      this.tracks.push({ id: this.nextId++, box: b, firstBox: b, score: 1, missing: 0, lastSeen: now, counted: false, arrived: false, tallied: false, stillSince: now, stillBox: b,
        uniqued: false, ...this.recall(faces?.[bi] ?? null, myLook, now), face: faces?.[bi] ?? null, look: looks?.[bi] ?? null });
    });
    this.tracks = this.tracks.filter((t) => {
      if (!t.counted && t.score <= 0) return false;      // never convinced it was a person
      const gone = now - t.lastSeen;

      if (this.inward) {
        // A doorway. Count them as soon as they have clearly gone — eight
        // seconds — rather than at the end of the grace, so a room emptying
        // can be watched as it happens. The track is kept afterwards, marked
        // as counted, so the same person coming back is recognised and never
        // counted a second time.
        if (t.counted && !t.tallied && gone >= DOOR_DECIDE_MS) {
          // Told, or worked out. See watchesDoorway.
          const went = this.assume ? this.assume === "in" : wentIn(t.firstBox, t.box, this.inward);
          // Counted, unless this is somebody Kyro already counted this way —
          // the usher holding the door. See MOST_REMEMBERED.
          if (went === true) {
            if (!t.countedIn) { this.entries++; t.countedIn = true; this.note(now, "in"); }
            else this.note(now, "again-in");
          } else if (went === false) {
            if (!t.countedOut) { this.exits++; t.countedOut = true; this.note(now, "out"); }
            else this.note(now, "again-out");
          } else {
            // They stood by the door and went back the way they came.
            this.note(now, "unclear");
          }
          t.tallied = true;
        }
        if (gone < DOOR_GRACE_MS) return true;
        this.remember(t);            // let the track go, keep the person
        return false;
      }

      if (gone < GRACE_MS) return true;
      if (t.arrived) this.exits++;   // only people this camera watched arrive can leave
      this.remember(t);
      return false;
    });

    return this.tracks.filter((t) => t.counted && t.missing === 0).length;
  }

  /**
   * One more different person — once, and only for somebody Kyro has not seen
   * before. See `people`.
   */
  private countPerson(t: Track): void {
    if (t.uniqued || !t.counted) return;
    t.uniqued = true;
    if (!t.returning) this.people++;
  }

  private note(at: number, kind: DoorEvent["kind"]): void {
    this.events.push({ at, kind });
    if (this.events.length > MOST_EVENTS) this.events.splice(0, this.events.length - MOST_EVENTS);
  }

  /**
   * Everyone this camera is following right now, for the register of people
   * that the website keeps across every camera.
   *
   * A camera's own track id means nothing anywhere else — camera 1's "person
   * 3" and camera 2's "person 3" are different people — so it is sent as what
   * it is: this camera's name for them, which the website uses to recognise a
   * track it has already identified, and nothing more.
   *
   * Only people Kyro is actually sure of. A box it was never convinced by
   * never becomes somebody in the register.
   */
  seenNow(now: number = Date.now()): { track: number; look: Look | null; face: Float32Array | null; box: [number, number, number, number]; stillFor: number }[] {
    return this.tracks
      .filter((t) => t.counted && t.missing === 0)
      .map((t) => ({ track: t.id, look: t.look, face: t.face, box: t.box, stillFor: Math.max(0, now - t.stillSince) }));
  }

  /**
   * Has this box moved since last time?
   *
   * The clock only restarts when it moves by more than the detector's own
   * jitter — see STILL_WITHIN. Measured against where it was when it last
   * really moved, not against the previous frame, so a slow drift of one
   * pixel a second still counts as moving.
   */
  private noteMovement(t: Track, box: [number, number, number, number], now: number): void {
    const h = Math.max(t.stillBox[3] - t.stillBox[1], 1);
    const moved = Math.max(
      Math.abs(box[0] - t.stillBox[0]), Math.abs(box[1] - t.stillBox[1]),
      Math.abs(box[2] - t.stillBox[2]), Math.abs(box[3] - t.stillBox[3]),
    ) / h;
    if (moved > STILL_WITHIN) { t.stillSince = now; t.stillBox = box; }
  }

  /** The decisions since this was last asked. Taking them clears them. */
  drainEvents(): DoorEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Keep what this person looked like, and what they have been counted as,
   * after their track is let go. See MOST_REMEMBERED.
   */
  private remember(t: Track): void {
    if (!t.look && !t.face) return;                    // nothing to recognise them by
    // Worth remembering if they were counted at a door, or counted as one of
    // the different people seen — otherwise there is nothing to protect.
    if (!t.countedIn && !t.countedOut && !t.uniqued) return;
    this.known.push({ look: t.look, face: t.face, countedIn: t.countedIn, countedOut: t.countedOut,
      uniqued: t.uniqued, at: t.lastSeen });
    if (this.known.length > MOST_REMEMBERED) this.known.splice(0, this.known.length - MOST_REMEMBERED);
  }

  /**
   * Have we seen this person before, and what were they counted as?
   *
   * A face settles it when there is one. Otherwise their coat and build, and
   * only when one person fits clearly better than everyone else — in a hall of
   * dark coats the honest answer is no, and a stranger is counted.
   */
  private recall(face: Float32Array | null, look: Look | null, now: number): { countedIn: boolean; countedOut: boolean; returning: boolean } {
    const no = { countedIn: false, countedOut: false, returning: false };
    // Everybody who might be this person: those whose track has been let go,
    // and those whose track is still here but too old to carry on — a track
    // isn't tidied away until the end of this count, and the usher coming back
    // half an hour later would otherwise find an empty memory and be counted
    // again.
    const stale = this.tracks.filter((t) => now - t.lastSeen > RETURN_BY_LOOK_MS && (t.countedIn || t.countedOut || t.uniqued));
    const pool: Known[] = [...this.known,
      ...stale.map((t) => ({ look: t.look, face: t.face, countedIn: t.countedIn, countedOut: t.countedOut, uniqued: t.uniqued, at: t.lastSeen }))];
    let at = -1;
    if (face) {
      let best = SAME_FACE;
      pool.forEach((k, i) => {
        if (!k.face) return;
        const s = alike(k.face, face);
        if (s >= best) { best = s; at = i; }
      });
    }
    if (at < 0 && look) {
      let best = 0, second = 0, candidates = 0;
      pool.forEach((k, i) => {
        if (!k.look) return;
        candidates++;
        const s = alikeLook(k.look, look);
        if (s > best) { second = best; best = s; at = i; }
        else if (s > second) second = s;
      });
      // "Clearly better than everyone else" means nothing when there is only
      // one person to be better than: the first person through the door would
      // make the second one "the same person" on the strength of a similar
      // coat, and six people leaving a crowded hall were counted as one.
      //
      // So a coat can only identify somebody among a crowd of remembered
      // people, where being a clear winner means something. One on its own has
      // to be claimed by a face.
      if (candidates < 2 || !(best >= SAME_LOOK && best - second >= LOOK_MARGIN)) at = -1;
    }
    if (at < 0) return no;
    // They are a live person again; they go back into the remembered list when
    // their track is next let go.
    if (at < this.known.length) this.known.splice(at, 1);
    return { countedIn: pool[at].countedIn, countedOut: pool[at].countedOut, returning: pool[at].uniqued };
  }

  /**
   * The service is over: forget everybody.
   *
   * The whole point of remembering was to stop one person being counted again
   * and again within a service. Between services it would do the opposite —
   * the evening congregation would be measured against the morning's — and
   * keeping it would make this a record of people rather than a count of them.
   */
  forgetPeople(): void {
    this.known = [];
    this.people = 0;
    // Including the people still standing in the doorway: in the next service
    // they are new again, and their first crossing counts.
    for (const t of this.tracks) { t.countedIn = false; t.countedOut = false; }
  }

  /** New day, or counting restarted. */
  reset(): void {
    this.tracks = []; this.entries = 0; this.exits = 0; this.people = 0; this.known = [];
  }

  /**
   * A new session: the tallies start again from zero, but the people being
   * followed are kept.
   *
   * Not the same as reset(). Forgetting the tracks as well would blank "how
   * many are in the room now" and then count everyone sitting there as having
   * just arrived — a new session starting with a hundred arrivals that never
   * happened. The people in view carry on being the same people; only the
   * running totals begin again.
   */
  resetCounts(): void {
    this.entries = 0; this.exits = 0; this.people = 0;
    // A new session counts everybody again, including the people already here.
    this.known = [];
    // Somebody already being followed did not arrive during this session, so
    // they must not count as leaving it either — see `arrived`. `counted` is
    // left alone: it is what "in the room now" is made of, and clearing it
    // would blink the live figure to nothing.
    for (const t of this.tracks) { t.countedIn = false; t.countedOut = false; t.arrived = false; }
  }
}
