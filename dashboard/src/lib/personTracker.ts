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
/** How alike two face codes are, 0–1 (see faceEngine). */
function alike(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}
/** Two codes this alike are the same person — measured on 600 standard face pairs. */
const SAME_FACE = 0.4;

// A score that rises when the person is seen and falls when they are not, so a
// box that only flickers in and out never reaches it. Simply totalling sightings
// wasn't enough: a false box appearing every other count still added up.
const SCORE_TO_CONFIRM = 3;
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
  counted: boolean;            // already counted as someone who arrived
  face: Float32Array | null;   // their face code, when one could be read
  /** Where they were first seen, for a doorway camera to tell which way they went. */
  firstBox: [number, number, number, number];
  /** Already added to the arrivals or departures, so never added again. */
  tallied: boolean;
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

export class PersonTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  entries = 0;
  exits = 0;
  /**
   * Set for a camera watching a doorway. Everyone passing a door both appears
   * and disappears, so appearing cannot mean "arrived" — only the direction
   * they walked can. While this is set, nobody is counted until they have gone
   * from view and it is clear which way they went.
   */
  private inward: Inward | null = null;

  /** null for a camera watching a room; a direction for one watching a door. */
  watchesDoorway(inward: Inward | null): void {
    if (this.inward !== inward) { this.inward = inward; this.entries = 0; this.exits = 0; }
  }

  /** Give it this count's people; returns how many are here now (confirmed only). */
  /**
   * @param faces one face code per person, same order, null where no clear face.
   *              With them, someone who went out of sight and came back is
   *              recognised rather than counted as arriving again.
   */
  update(people: Box[], now: number = Date.now(), faces?: (Float32Array | null)[]): number {
    const boxes = people.map((p) => p.box);
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
      tr.box = boxes[b]; tr.missing = 0; tr.lastSeen = now;
      if (faces?.[b]) tr.face = faces[b];
      tr.score = Math.min(SCORE_TO_CONFIRM + 2, tr.score + 1);
      if (!tr.counted && tr.score >= SCORE_TO_CONFIRM) { tr.counted = true; if (!this.inward) this.entries++; }
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
      if (revive >= 0) {
        const t = this.tracks[revive];
        takenTrack.add(revive);
        t.box = b; t.missing = 0; t.lastSeen = now;
        if (mine) t.face = mine;
        t.score = Math.min(SCORE_TO_CONFIRM + 2, t.score + 1);
        if (!t.counted && t.score >= SCORE_TO_CONFIRM) { t.counted = true; if (!this.inward) this.entries++; }
        return;
      }
      this.tracks.push({ id: this.nextId++, box: b, firstBox: b, score: 1, missing: 0, lastSeen: now, counted: false, tallied: false, face: faces?.[bi] ?? null });
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
          const went = wentIn(t.firstBox, t.box, this.inward);
          if (went === true) this.entries++;
          else if (went === false) this.exits++;
          // null = they stood by the door and went back the way they came.
          t.tallied = true;
        }
        return gone < DOOR_GRACE_MS;
      }

      if (gone < GRACE_MS) return true;
      if (t.counted) this.exits++;   // a room: only people we'd counted as arriving can leave
      return false;
    });

    return this.tracks.filter((t) => t.counted && t.missing === 0).length;
  }

  /** New day, or counting restarted. */
  reset(): void {
    this.tracks = []; this.entries = 0; this.exits = 0;
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
    this.entries = 0; this.exits = 0;
  }
}
