/**
 * Who is in the building: one identity per human being, for one service.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every figure Kyro produced before this was a count of EVENTS. A room
 * camera's "entries" counted each person it became sure of, so the same
 * congregation was counted again and again — 1,538 at a service of about 900,
 * and 171 people "arriving" at the moment the hall emptied. A doorway camera
 * counted crossings, and one person stepping out for a phone call crosses four
 * times. Each camera also kept its own register, so two cameras on one room
 * produced two sets of people; the only thing that ever took the duplicates
 * out was taking the LARGER of the two counts, which is not identity — it
 * silently discards everyone the smaller camera could see and the larger one
 * could not.
 *
 * This is the other thing: a register of people, shared by every camera, with
 * one entry per person. Attendance is the size of that register. There is no
 * separate counter that can drift away from it.
 *
 * ── What it is NOT ─────────────────────────────────────────────────────────
 *
 * It is not a record of who anyone is. An identity here is a number, a few
 * colours, a shape, and — only while face matching is switched on — a list of
 * numbers describing a face. No name, no photograph, nothing that says anyone
 * was at church. It lives for one service and is destroyed when the service
 * ends. Face data is held in memory only and is never written to storage, so
 * it cannot outlive the process that holds it.
 *
 * ── How a person is recognised ─────────────────────────────────────────────
 *
 * Three signals, in order of how much they can be trusted:
 *
 *   1. The camera is still following them. A camera's own track, while it
 *      lasts, is the strongest evidence there is: it is the same box moving.
 *      A track that is already attached to an identity stays attached, and
 *      costs nothing to check.
 *
 *   2. Their face, when face matching is on and a face was readable. Strong
 *      across cameras, across time, and when somebody has changed seats. Needs
 *      them to be facing a camera, which at a doorway seen from the side is
 *      most of the time not the case.
 *
 *   3. What they look like: the colour of what they are wearing above and
 *      below the waist, how tall and wide their shape is. Weak on its own —
 *      a hall of dark coats is a hall of near-identical signatures — so it is
 *      only believed when one candidate stands clearly apart from the rest.
 *
 * Any match must also be POSSIBLE: somebody seen on a camera at one end of the
 * building cannot be on another camera a second later unless those cameras
 * overlap.
 *
 * ── The two ways to be wrong ───────────────────────────────────────────────
 *
 *   A false SPLIT makes one person into two identities: attendance too high.
 *   A false MERGE makes two people into one: attendance too low.
 *
 * Both are counted and reported rather than hidden. Where the evidence is
 * genuinely ambiguous the match is made and FLAGGED, not quietly turned into a
 * new person — because an unflagged split is indistinguishable from a real
 * arrival, while a flagged merge can be looked at.
 */

/** Two face codes this alike are the same person (OpenCV SFace, 600 pairs). */
export const FACE_SAME = 0.4;
/** …and this much better than the next best, or it is not clear enough. */
export const FACE_MARGIN = 0.06;
/**
 * A face is also evidence AGAINST.
 *
 * Two readable faces this unalike are two different people, and no amount of
 * matching coats should be allowed to overrule that. Used as a veto rather
 * than a match: it needs both people to have a face on file, so it costs
 * nothing when faces aren't available and settles the dangerous case when they
 * are — two people in near-identical dark coats, which is most of a
 * congregation in November.
 *
 * Well below FACE_SAME: this only has to rule out people who are plainly not
 * each other, not decide who anybody is.
 */
export const FACE_DIFFERENT = 0.2;
/**
 * Two appearances this alike MIGHT be the same person.
 *
 * Measured, not chosen. On two hundred simulated people, two readings of the
 * same person scored 0.943 at worst and 0.96 typically, while two DIFFERENT
 * people scored 0.22 typically — but 7% of pairs came out above 0.78 and 1.7%
 * above 0.90. The old threshold of 0.78 therefore merged roughly one pair in
 * fourteen, which at a service of 120 is a dozen people quietly lost.
 *
 * These numbers come from simulated readings, whose spread is tighter than a
 * real camera's: real lighting, pose and half-hidden bodies will push
 * same-person scores lower. So this sits below the simulated same-person
 * floor, with room for reality to be messier, and should be re-measured
 * against a labelled recording of a real service before anyone calls it
 * final. The test that produced these figures is tests/test_identity_registry.mjs.
 */
export const LOOK_SAME = 0.88;
/** …and this much clear of the runner-up, when there is more than one. */
export const LOOK_MARGIN = 0.05;
/** On their own, with nobody to be clearer than, a match must be this strong. */
export const LOOK_ALONE = 0.92;
/** An appearance match weaker than this is never used, however clear. */
export const LOOK_UNCERTAIN = 0.82;
/**
 * A uniform.
 *
 * The choir wear the same robes. The ushers wear the same jackets. When this
 * many people Kyro already knows look like the person in front of it, what
 * they are wearing has stopped being evidence about WHO they are — it is
 * evidence about which group they belong to, which is a different question and
 * not one attendance cares about.
 *
 * Appearance is then refused outright for that sighting: only a face, or the
 * camera still following them, may say who this is. The cost is that a choir
 * member who steps out and comes back without being recognised is counted
 * twice. The alternative is worse and silent: twenty robed singers quietly
 * merged into three or four people, and an attendance figure that is wrong
 * downwards with nothing to show for it.
 */
export const UNIFORM_CROWD = 3;
/**
 * …and all of them have to actually be AROUND.
 *
 * This was the hole, and it made the register run away with itself. The
 * uniform rule counted every identity on file that looked alike, whether or
 * not anybody had seen them for the last half-hour. So:
 *
 *   one person walks in and out of shot a few times;
 *   a couple of returns aren't recognised, and become new entries;
 *   now three entries on file look alike — because they are all her;
 *   the uniform rule fires, and appearance is refused from then on;
 *   so every single return afterwards is somebody new.
 *
 * One person in front of two cameras for an evening came out as 31 people,
 * and would have gone on climbing for as long as the camera was running. The
 * rule meant to stop a choir being merged was manufacturing a congregation.
 *
 * A uniform is a crowd — people dressed alike who are THERE, at the same
 * time, which is when telling them apart by their clothes really is
 * hopeless. Three entries that look alike and have not been seen for a minute
 * are not a crowd; they are a history, and much the likeliest explanation is
 * that they are one person who keeps being missed.
 */
export const UNIFORM_SEEN_MS = 60_000;
/**
 * Where somebody was sitting, as SUPPORTING evidence.
 *
 * The same seat, moments later, is usually the same person — but only usually,
 * and it must never be proof: people swap seats, and a choir stand is a row of
 * identical people in identical robes where "the seat they were in" is the
 * only thing telling them apart, which is exactly when it is least safe.
 *
 * So a seat can lift an appearance match that was nearly good enough over the
 * line, and can do nothing on its own. A face outranks it; a uniform cancels
 * it, because in a row of identical robes the seat is doing all the work.
 */
export const SEAT_HELPS = 0.04;
/** How long a seat stays believable as a hint about who somebody is. */
export const SEAT_FRESH_MS = 60_000;
/** Two cameras reporting one person this close together is the same moment. */
export const CO_SEEN_MS = 6_000;
/** A camera's own track stays attached to its identity for this long. */
export const TRACK_LINK_MS = 5 * 60_000;
/**
 * How many separate sightings a face Kyro cannot place has to make before it
 * is called a NEW person.
 *
 * A camera reports every five seconds; a face is read every four, for the
 * nearest three people, and only when a face is actually turned towards the
 * lens. So the first sighting of somebody walking back into shot routinely
 * arrives with no face at all — nothing to match on but the colour of their
 * coat, which on its own is not enough to be sure, and rightly so.
 *
 * Creating a person at that moment is the mistake. One person stepping out
 * of the room and back became four, then seven: each return was a sighting
 * with no face, no match, and a new entry in the register — and by the time
 * the face arrived a second later it matched the person just invented.
 *
 * So a sighting that matches nobody waits. It is a person in the room
 * immediately (see seenNow), and a different person in the register only
 * once it has been seen for this long and still cannot be accounted for —
 * by which time there has been a face to go on, if there was ever going to
 * be one.
 *
 * It also means a half-second of nonsense — a reflection, a coat over a
 * chair, a detection that flickers once — can no longer put somebody in a
 * church's attendance figures for good.
 */
export const NEW_PERSON_WITH_FACE = 2;
/**
 * And this many when there has never been a face to go on.
 *
 * Appearance is weak evidence in both directions. It is not enough to say
 * "this is the same person", which is why LOOK_ALONE is set as high as it
 * is — and it is not enough to say "this is a DIFFERENT person" either,
 * which is the half nobody had written down. One sighting of a coat that
 * didn't quite match anybody was turning into a new entry in a church's
 * attendance figures.
 *
 * Counted in sightings rather than seconds on purpose: a sighting is one
 * separate chance to recognise somebody, which is the thing being counted.
 * A camera reports every five seconds, so this is around twenty.
 */
export const NEW_PERSON_NO_FACE = 4;
/** A sighting that stopped coming before it earned a place in the register. */
export const WAITING_STALE_MS = 60_000;
/** Faces kept per identity, so one bad reading can't define anybody. */
export const SAMPLES = 5;
/**
 * And this many appearance readings each.
 *
 * Far more than the faces, because an appearance reading is far less
 * informative and changes with everything. The same person looks different
 * from six feet away and from across the hall — the box round them is half
 * the height, and the height of the box is part of the reading. Keeping the
 * five newest meant keeping five readings from wherever they happened to be
 * standing for the last half minute, and everything Kyro had learned about
 * how they look from further off was thrown away before they walked back into
 * shot. So they failed to match themselves and became somebody new, over and
 * over: one person in front of a camera all evening came out as 31 people.
 *
 * Twenty readings covers the distances, poses and patches of light a person
 * has actually been seen in. Measured rather than chosen: on a simulated
 * 120-person service with no face matching it changes nothing at all — the
 * same 112 counted, the same 8 merges, no new splits — while one person
 * walking in and out of shot thirty times goes from eleven people to one.
 * (Keeping the most DIFFERENT readings instead of the newest fixed her case
 * too, and cost four extra merges and four extra splits at the service: a
 * wrong reading, once absorbed, was then kept for ever and became a magnet.
 * Plain recency, more of it, is better.)
 *
 * They are only this many in memory. The copy written to storage — which
 * exists so that a restart mid-service doesn't lose everybody — is trimmed to
 * fit, oldest people losing theirs first. See snapshot().
 */
export const LOOK_SAMPLES = 20;
/** How many of them the stored copy starts with before trimming. */
export const LOOK_SAMPLES_SAVED = 8;
/** Nobody crosses a building in less than this, so two cameras that don't
 *  overlap cannot both see the same person inside it. */
export const TRAVEL_MS = 1_500;

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * How alike two appearances are, 0–1. Colour as a share of the light rather
 * than an amount of it, so the same coat reads the same in a sunlit doorway
 * and three steps inside; brightness counts mostly through the difference
 * between someone's top and bottom, which a change in the lighting moves
 * together and so leaves alone.
 *
 * look = [topR, topG, topBright, botR, botG, botBright, shape, height]
 */
export function alikeLook(a, b) {
  if (!a || !b || a.length < 8 || b.length < 8) return 0;
  const chroma = (i, j) => Math.hypot(a[i] - b[i], a[j] - b[j]);
  const contrast = Math.abs((a[2] - a[5]) - (b[2] - b[5]));
  const overall = Math.abs((a[2] + a[5]) / 2 - (b[2] + b[5]) / 2);
  const shape = Math.abs(a[6] - b[6]) / Math.max(a[6], b[6], 1);
  const size = Math.abs(a[7] - b[7]) / Math.max(a[7], b[7], 0.01);
  const d = 3.0 * chroma(0, 1) + 2.0 * chroma(3, 4)
          + 1.0 * contrast + 0.25 * overall + 0.4 * shape + 0.5 * size;
  return Math.max(0, 1 - d);
}

/** Best match between one reading and the samples kept for an identity. */
function bestAgainst(samples, value, compare) {
  let best = 0;
  for (const s of samples) {
    const v = compare(s, value);
    if (v > best) best = v;
  }
  return best;
}

/** Keep a few readings, dropping the oldest — one bad frame must not define anyone. */
function keep(list, value, max = SAMPLES) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

export class IdentityRegistry {
  /**
   * @param {object} opts
   *   zoneOf(cameraId)      – which room a camera watches, for plausibility.
   *   overlapping(a, b)     – whether two cameras can see the same spot at once.
   *   now()                 – the clock, for tests.
   */
  constructor(opts = {}) {
    this.zoneOf = opts.zoneOf ?? (() => "");
    /**
     * Whether a camera may add somebody new to the register.
     *
     * A camera on a doorway may not. Everyone who walks through a door walks
     * into a room, where a camera watches them for the length of a service and
     * can recognise them properly; a doorway sees them side-on for a second
     * and a half. Letting it create identities meant every person was created
     * TWICE at a service of 120 — once at the door and once in the hall —
     * because appearance alone could not link the two sightings in a crowd.
     *
     * So a doorway camera's job is arrivals and departures, which is what it
     * is good at, and attendance is the register the room cameras build.
     */
    this.createsIdentities = opts.createsIdentities ?? (() => true);
    /**
     * Called when one person is found in one camera's seat and then, moments
     * later, in another camera's seat. Nobody is in two places at once, so
     * those two seats are very likely the same chair — which is how the
     * building works out that two cameras are looking at one piece of
     * furniture, without anybody measuring anything. See worker/building.js.
     */
    this.onSameChair = opts.onSameChair ?? (() => {});
    this.overlapping = opts.overlapping ?? ((a, b) => this.zoneOf(a) === this.zoneOf(b));
    this.people = new Map();      // id → identity
    this.byTrack = new Map();     // "camera#track" → { id, at }
    /**
     * Which person is in which seat, across every camera.
     *
     * One person in one seat and one seat holding one person, which is the
     * whole reason this lives here rather than in either half: the seat finder
     * only knows the seats one camera can see, and a person can be seen by
     * more than one camera.
     *
     * A seat id is never a person id. Somebody who sits in five chairs during
     * a service is five seats and ONE person in the attendance figure, and
     * nothing about seats can add to it or take from it.
     */
    this.seats = new Map();       // "camera#seat" → person id
    /**
     * Sightings nobody can account for yet — not people, not nobody.
     *
     * "camera#track" → { first, seen }. See NEW_PERSON_MS. They count as
     * being in the room from the moment they are seen; they only enter the
     * register once Kyro has had time to find out who they are.
     */
    this.waiting = new Map();
    this.nextId = 1;
    this.stats = { created: 0, matchedByTrack: 0, matchedByFace: 0, matchedByLook: 0, uncertain: 0, rejectedImpossible: 0, vetoedByFace: 0, uniformed: 0, helpedBySeat: 0, movedSeat: 0, waiting: 0, mergedLookAlikes: 0 };
    this.service = null;
  }

  /** How many different people have been seen. This IS the attendance figure. */
  get size() { return this.people.size; }

  /**
   * A new service: everybody is forgotten. Not a reset of a counter — the
   * register itself is destroyed, including every face code in it.
   */
  startService(id) {
    this.service = id ?? null;
    this.people.clear();
    this.byTrack.clear();
    this.seats.clear();
    this.waiting.clear();
    this.nextId = 1;
    this.stats = { created: 0, matchedByTrack: 0, matchedByFace: 0, matchedByLook: 0, uncertain: 0, rejectedImpossible: 0, vetoedByFace: 0, uniformed: 0, helpedBySeat: 0, movedSeat: 0, waiting: 0, mergedLookAlikes: 0 };
  }

  /**
   * What one camera can see at this moment.
   *
   * @param cameraId  which camera
   * @param obs       [{ track, look, face, }] — track is that camera's own id
   *                  for the person, look an appearance reading, face a
   *                  Float32Array face code or null.
   * @param now       epoch ms
   * @returns the identity id given to each observation, in the same order.
   */
  observe(cameraId, obs, now) {
    const out = [];
    // Two people standing side by side are two people: an identity may be
    // claimed by at most one observation from the same camera at the same
    // moment, however alike they look.
    const claimed = new Set();

    // Links from a camera's own track to an identity are only useful while
    // that track is alive. Left alone they grow for every track any camera
    // ever made — a doorway camera makes thousands in a morning — and a
    // service must not get heavier as it goes on.
    if (this.byTrack.size > 2000) {
      for (const [k, v] of this.byTrack) if (now - v.at > TRACK_LINK_MS) this.byTrack.delete(k);
    }

    // Pass one: anyone this camera is already following keeps their identity.
    // This is both the strongest evidence and the cheapest, and it is what
    // makes "one person seen five hundred times" cost nothing.
    const pending = [];
    for (const o of obs) {
      const link = this.byTrack.get(`${cameraId}#${o.track}`);
      if (link && now - link.at <= TRACK_LINK_MS && this.people.has(link.id) && !claimed.has(link.id)) {
        this.touch(link.id, cameraId, o, now);
        this.byTrack.set(`${cameraId}#${o.track}`, { id: link.id, at: now });
        claimed.add(link.id);
        this.stats.matchedByTrack++;
        out.push(link.id);
      } else {
        out.push(null);
        pending.push({ o, at: out.length - 1 });
      }
    }

    // Pass two: everyone else is either somebody Kyro knows, or new.
    for (const { o, at } of pending) {
      const id = this.identify(cameraId, o, now, claimed);
      out[at] = id;
      if (id === null) continue;         // a doorway camera, seeing a stranger
      claimed.add(id);
      this.byTrack.set(`${cameraId}#${o.track}`, { id, at: now });
    }
    return out;
  }

  /** Which identity this observation belongs to, making a new one if nobody fits. */
  identify(cameraId, o, now, claimed) {
    const wkey = `${cameraId}#${o.track}`;

    // What Kyro knows about this sighting — not just what arrived a moment
    // ago. A sighting that matched nobody last time is still being followed,
    // and everything seen of it since is evidence about who it is.
    //
    // This is what was being thrown away. A person walking back in was seen
    // once with a face and once without; the second sighting was matched on
    // the coat alone, because the face from five seconds earlier was sitting
    // in the waiting list unread.
    let w = this.waiting.get(wkey);
    if (w) {
      w.last = now;
      w.seen++;
      if (o.look) keep(w.looks, o.look);
      if (o.face) { w.faces++; keep(w.faceCodes, o.face); }
      if (o.seat) w.seat = o.seat;
    }
    /** Every face read of this sighting, newest last. */
    const faceReads = w && w.faceCodes.length ? w.faceCodes : o.face ? [o.face] : [];
    /** Every appearance reading of it. */
    const lookReads = w && w.looks.length ? w.looks : o.look ? [o.look] : [];
    const seat = o.seat ?? w?.seat ?? null;
    /**
     * The best this sighting's faces score against one person's.
     *
     * Best-of is right for faces and wrong for clothes, which is why they are
     * treated differently below. A face code is a measurement of a face, and
     * any one read of it can be spoiled by the angle — so the best read is
     * the most informative one. An appearance reading is mostly the colour of
     * a coat; taking the best of several only finds the luckiest coincidence,
     * and measurably so. Across a simulated 120-person service with no faces:
     * best-of-looks merged 11 different people into one another, the latest
     * look alone merged 8. (Before any of this: 12 splits and 14 merges.)
     */
    const faceScore = (p) => {
      if (!faceReads.length || !p.faces.length) return 0;
      let best = 0;
      for (const f of faceReads) best = Math.max(best, bestAgainst(p.faces, f, dot));
      return best;
    };
    /** The newest appearance reading only — see the note above. */
    const lookScore = (p) => {
      if (!lookReads.length || !p.looks.length) return 0;
      return bestAgainst(p.looks, lookReads[lookReads.length - 1], alikeLook);
    };

    /** Matched after all: it was never a new person, so it stops waiting. */
    const matched = (id) => { this.waiting.delete(wkey); return id; };

    const scored = [];
    for (const p of this.people.values()) {
      if (claimed.has(p.id)) continue;
      // Could this person physically be here? Somebody seen a moment ago on a
      // camera that cannot see this spot is not the person in front of it.
      if (p.lastCamera && p.lastCamera !== cameraId
          && now - p.lastAt < TRAVEL_MS
          && !this.overlapping(p.lastCamera, cameraId)) {
        this.stats.rejectedImpossible++;
        continue;
      }
      const face = faceScore(p);
      // Both faces readable and plainly not each other: this is somebody else,
      // whatever they are wearing. See FACE_DIFFERENT.
      if (faceReads.length && p.faces.length && face < FACE_DIFFERENT) { this.stats.vetoedByFace++; continue; }
      const look = lookScore(p);
      // Were they in this seat a moment ago? Supporting evidence only.
      const sameSeat = !!(seat && p.seat === seat && now - (p.seatAt || 0) < SEAT_FRESH_MS);
      scored.push({ p, face, look, sameSeat });
    }

    // A uniform: too many people who are HERE look like this one, so what
    // they are wearing says nothing about which of them this is. Only people
    // seen in the last minute count towards it — see UNIFORM_SEEN_MS.
    const alike = scored.filter((x) => x.look >= LOOK_SAME && now - x.p.lastAt <= UNIFORM_SEEN_MS).length;
    const uniform = alike >= UNIFORM_CROWD;
    if (uniform) this.stats.uniformed++;

    // A face settles it, when there is one and it is clearly one person's.
    const faces = scored.filter((s) => s.face > 0).sort((a, b) => b.face - a.face);
    if (faces.length && faces[0].face >= FACE_SAME
        && (faces.length < 2 || faces[0].face - faces[1].face >= FACE_MARGIN)) {
      this.stats.matchedByFace++;
      return matched(this.touch(faces[0].p.id, cameraId, o, now, w).id);
    }

    // Otherwise what they look like — but only when one candidate stands
    // clearly apart, and never at all when the room is full of people dressed
    // the same. In a hall of dark coats, or a choir stand, nobody stands
    // apart, and the honest answer is that Kyro does not know.
    const looks = uniform ? [] : scored.filter((s) => s.look > 0).sort((a, b) => b.look - a.look);
    if (looks.length) {
      const best = looks[0], second = looks[1]?.look ?? 0;
      // Being in the seat they were just in lifts a nearly-good-enough match
      // over the line. It can never make a match on its own — see SEAT_HELPS.
      const help = best.sameSeat ? SEAT_HELPS : 0;
      const clear = looks.length < 2
        ? best.look + help >= LOOK_ALONE
        : best.look - second + help >= LOOK_MARGIN;
      if (best.look + help >= LOOK_SAME && clear) {
        this.stats.matchedByLook++;
        if (best.sameSeat) this.stats.helpedBySeat++;
        return matched(this.touch(best.p.id, cameraId, o, now, w).id);
      }
      // Good, but not good enough to be sure. Attached and flagged rather
      // than quietly turned into a new person: an unflagged split looks
      // exactly like somebody arriving, while a flagged merge can be checked.
      if (best.look >= LOOK_UNCERTAIN && clear) {
        this.stats.uncertain++;
        const p = this.touch(best.p.id, cameraId, o, now, w);
        p.uncertain++;
        return matched(p.id);
      }

      // Several people on file look like this one, none of them is here, and
      // none stands apart from the others.
      //
      // This is the loop that ran away with the register, and it feeds
      // itself. The margin test asks a candidate to stand clear of the
      // runner-up — and when the runner-up is the SAME PERSON, filed twice,
      // standing clear is impossible. So no match is made, somebody new is
      // created, and now there are three copies on file and the next return
      // is harder still. One person in front of two cameras for an evening
      // came out as 31 people, climbing by two a trip and showing no sign of
      // stopping.
      //
      // The way out is the principle this file already states: appearance is
      // weak evidence in BOTH directions. If it cannot tell two filed people
      // apart, it cannot tell you that this is a third one either. When every
      // look-alike disappeared some time ago — nobody present to confuse this
      // with — much the likeliest reading is that they are one person who
      // keeps being missed, and attaching to the best of them is right
      // however the duplicates are eventually sorted out. In a choir stand
      // the look-alikes ARE present, so this does not apply and the uniform
      // rule above has already taken over.
      const rivals = looks.filter((x) => x.look >= LOOK_SAME);
      const anyHere = rivals.some((x) => now - x.p.lastAt <= UNIFORM_SEEN_MS);
      if (rivals.length > 1 && !anyHere && best.look >= LOOK_SAME) {
        this.stats.mergedLookAlikes++;
        const p = this.touch(best.p.id, cameraId, o, now, w);
        p.uncertain++;
        return matched(p.id);
      }
    }

    // Nobody fits. Either this is somebody new, or this camera is not allowed
    // to decide that — see createsIdentities.
    if (!this.createsIdentities(cameraId)) return null;

    // Nobody fits YET.
    //
    // A sighting that matches nobody is not a new person until it has given
    // Kyro a fair number of separate chances to recognise them. One glance at
    // a coat that didn't quite match anybody was enough to put a new name in
    // a church's attendance figures: one person stepping out of a room and
    // back became four, then seven.
    //
    // A face that matched nobody is strong evidence of somebody new — it has
    // just been compared against every person Kyro knows. A coat that matched
    // nobody is not, so it has to go on not matching for longer.
    if (!w) {
      w = { first: now, last: now, seen: 1, faces: o.face ? 1 : 0, looks: [], faceCodes: [], seat: o.seat ?? null };
      if (o.look) keep(w.looks, o.look);
      if (o.face) keep(w.faceCodes, o.face);
      this.waiting.set(wkey, w);
      this.stats.waiting++;
      // Sightings that stopped coming before they earned a place. Tidied
      // here rather than on a timer: this is the only thing that adds to it.
      if (this.waiting.size > 500) {
        for (const [k, v] of this.waiting) if (now - v.last > WAITING_STALE_MS) this.waiting.delete(k);
      }
    }
    if (w.seen < (w.faces ? NEW_PERSON_WITH_FACE : NEW_PERSON_NO_FACE)) return null;
    this.waiting.delete(wkey);
    return this.create(cameraId, o, now, w).id;
  }

  /**
   * Sightings waiting to be accounted for, on these cameras, right now.
   *
   * They are in the room — somebody is plainly in shot — they are simply not
   * in the register yet. Counted here so that waiting never makes the live
   * figure too low.
   */
  waitingNow(cameraIds, now = Date.now(), within = CO_SEEN_MS) {
    let n = 0;
    for (const [k, v] of this.waiting) {
      if (now - v.last > within) continue;
      if (cameraIds.has(k.slice(0, k.lastIndexOf("#")))) n++;
    }
    return n;
  }

  create(cameraId, o, now, waited = null) {
    const p = {
      id: this.nextId++,
      firstAt: now, lastAt: now,
      cameras: new Set([cameraId]),
      lastCamera: cameraId,
      /**
       * When each camera last saw this person.
       *
       * Not history — the last few seconds. It answers one question nothing
       * else here can: at this moment, how many of these sightings are the
       * SAME person? Two cameras pointed at one face reported "2 people now",
       * because the only thing adding them up was addition.
       *
       * Transient on purpose: it is rebuilt by the next report and never
       * written down.
       */
      seenAt: new Map([[cameraId, now]]),
      looks: [], faces: [],
      seen: 1,
      uncertain: 0,
      /** Where they are sitting, if anywhere. Never part of who they are. */
      seat: null, seatKey: null, seatAt: 0, seatCamera: "",
    };
    // Everything seen while they were waiting to be accounted for, oldest
    // first, so the newest reading is the one kept if there are too many.
    if (waited) {
      for (const l of waited.looks) keep(p.looks, l, LOOK_SAMPLES);
      for (const f of waited.faceCodes) keep(p.faces, f);
      if (waited.first) p.firstAt = waited.first;
    }
    if (o.look) keep(p.looks, o.look, LOOK_SAMPLES);
    if (o.face) keep(p.faces, o.face);
    this.people.set(p.id, p);
    this.stats.created++;
    if (o.seat) this.setSeat(p, cameraId, o.seat, now);
    return p;
  }

  /**
   * Somebody sat down, stood up or moved.
   *
   * Sitting down, standing up and changing seats are all the same person. The
   * seat changes; the person does not, and attendance never moves.
   */
  setSeat(p, cameraId, seat, now) {
    const key = seat ? `${cameraId}#${seat}` : null;
    if (p.seatKey === key) { if (key) p.seatAt = now; return; }
    // They have left wherever they were, so it is free for somebody else.
    if (p.seatKey && this.seats.get(p.seatKey) === p.id) this.seats.delete(p.seatKey);
    if (!key) { p.seatKey = null; p.seat = null; return; }
    // Nobody may sit in a seat somebody else is already in. The seat finder
    // allows only one person per seat on one camera; this is the same rule
    // across all of them.
    const already = this.seats.get(key);
    if (already && already !== p.id && this.people.has(already)) {
      const other = this.people.get(already);
      if (now - (other.seatAt || 0) < SEAT_FRESH_MS) return;   // still theirs
      other.seatKey = null; other.seat = null;
    }
    // A different camera, moments later, is not somebody changing seats: it is
    // two cameras seeing one chair. Evidence for the building, not a move.
    if (p.seatKey && p.seatCamera && p.seatCamera !== cameraId && now - (p.seatAt || 0) < CO_SEEN_MS) {
      this.onSameChair(p.seatKey, key);
    } else if (p.seatKey) {
      this.stats.movedSeat++;
    }
    this.seats.set(key, p.id);
    p.seatKey = key; p.seat = seat; p.seatAt = now; p.seatCamera = cameraId;
  }

  touch(id, cameraId, o, now, waited = null) {
    const p = this.people.get(id);
    if (!p) return this.create(cameraId, o, now, waited);
    this.setSeat(p, cameraId, o.seat ?? null, now);
    p.lastAt = now;
    p.lastCamera = cameraId;
    p.cameras.add(cameraId);
    if (!p.seenAt) p.seenAt = new Map();
    p.seenAt.set(cameraId, now);
    p.seen++;
    // Keep a few readings each, so somebody is recognised in the light they
    // are standing in rather than the light they first appeared in.
    //
    // Including anything seen while this sighting was waiting to be placed:
    // it turned out to be this person, so it is readings of this person.
    if (waited) {
      for (const l of waited.looks) keep(p.looks, l, LOOK_SAMPLES);
      for (const f of waited.faceCodes) keep(p.faces, f);
    }
    if (o.look) keep(p.looks, o.look, LOOK_SAMPLES);
    if (o.face) keep(p.faces, o.face);
    return p;
  }

  /**
   * At this moment, across these cameras: how many sightings there are, and
   * how many DIFFERENT people they are.
   *
   * Two cameras on one face is two sightings and one person. Every figure
   * that adds cameras together needs this, and nothing else in Kyro can
   * answer it — a camera only knows what it can see, and the one thing it
   * cannot know is whether the camera next to it is looking at the same
   * person.
   *
   * It works whether or not face matching is switched on: the register uses
   * whatever evidence it has, and a face is the strongest of several.
   *
   * `duplicates` is deliberately never more than it can prove. A camera
   * sends at most the nearest forty people, so in a full hall the register
   * sees fewer sightings than the cameras counted — subtracting duplicates
   * it HAS found from the cameras' own total is then still right, where
   * trusting its people count as the answer would lose everybody it never
   * heard about.
   */
  seenNow(cameraIds, now = Date.now(), within = CO_SEEN_MS) {
    let sightings = 0, people = 0;
    for (const p of this.people.values()) {
      if (!p.seenAt) continue;
      let n = 0;
      for (const [cam, at] of p.seenAt) if (cameraIds.has(cam) && now - at <= within) n++;
      if (n) { sightings += n; people++; }
    }
    // Somebody Kyro hasn't placed yet is still somebody standing there. They
    // are one sighting and one person, so they add nothing to the duplicates
    // — which is the honest answer: Kyro does not yet know who they are, so
    // it cannot claim they are somebody it has already counted.
    const unplaced = this.waitingNow(cameraIds, now, within);
    return { sightings: sightings + unplaced, people: people + unplaced, duplicates: Math.max(0, sightings - people) };
  }

  /** Everything the dashboard may show. No faces, no pictures, no names. */
  diagnostics(now = Date.now()) {
    const people = [...this.people.values()];
    const seenOnMoreThanOne = people.filter((p) => p.cameras.size > 1).length;
    return {
      unique_people: people.length,
      active_tracks: [...this.byTrack.values()].filter((l) => now - l.at < 30_000).length,
      seen_on_more_than_one_camera: seenOnMoreThanOne,
      uncertain_matches: people.reduce((n, p) => n + (p.uncertain > 0 ? 1 : 0), 0),
      with_a_face: people.filter((p) => p.faces.length > 0).length,
      matched_by_track: this.stats.matchedByTrack,
      matched_by_face: this.stats.matchedByFace,
      matched_by_look: this.stats.matchedByLook,
      flagged_matches: this.stats.uncertain,
      rejected_as_impossible: this.stats.rejectedImpossible,
      ruled_out_by_face: this.stats.vetoedByFace,
      /** Sightings where everyone looked alike, so appearance was refused. */
      in_a_uniform: this.stats.uniformed,
      /** Matches where the seat they were in tipped the balance. */
      helped_by_their_seat: this.stats.helpedBySeat,
      /** Times somebody changed seats. Never a new person. */
      changed_seats: this.stats.movedSeat,
      seated_now: [...this.seats.keys()].length,
      created: this.stats.created,
      service: this.service,
    };
  }

  /**
   * What can be written down between restarts: identities and appearances,
   * never faces. A face code is biometric data; it stays in memory for the
   * service and dies with the process. The cost is that a restart loses the
   * strongest signal for people already seen, which is the right way round.
   */
  snapshot(maxBytes = 0) {
    // Written small on purpose. Nine hundred people is a lot of repeated field
    // names, and the whole thing has to fit in one stored value — the first
    // version spent 140 KB on names like "seatCamera" and didn't fit at all,
    // with nothing to show for the space. One letter each, and anything that
    // is empty is left out rather than written as null.
    const base = (looksEach) => ({
      v: 2,
      service: this.service,
      nextId: this.nextId,
      stats: this.stats,
      people: [...this.people.values()]
        .sort((a, b) => a.lastAt - b.lastAt)           // oldest first, so they lose theirs first
        .map((p) => {
          const o = { i: p.id, f: p.firstAt, l: p.lastAt, n: p.seen };
          if (p.uncertain) o.u = p.uncertain;
          if (p.cameras.size) o.c = [...p.cameras];
          if (p.lastCamera) o.k = p.lastCamera;
          if (p.seatKey) { o.s = p.seat; o.sk = p.seatKey; o.sa = p.seatAt; if (p.seatCamera) o.sc = p.seatCamera; }
          const looks = looksEach > 0 ? p.looks.slice(-looksEach) : [];
          if (looks.length) o.b = looks;
          return o;
        }),
    });
    if (!maxBytes) return base(LOOK_SAMPLES_SAVED);
    // Trim until it fits where it has to be kept. Fewer readings each first;
    // then the people seen longest ago lose their readings altogether. Nobody
    // is ever dropped from the register — losing a person loses attendance,
    // losing their coat only costs the chance of recognising it later.
    for (const each of [LOOK_SAMPLES_SAVED, 5, 3, 2, 1]) {
      const snap = base(each);
      if (JSON.stringify(snap).length <= maxBytes) return snap;
    }
    const snap = base(1);
    while (JSON.stringify(snap).length > maxBytes) {
      const next = snap.people.find((p) => p.b && p.b.length);
      if (!next) break;                                 // nothing left to give
      delete next.b;
    }
    return snap;
  }

  restore(snap) {
    if (!snap || !Array.isArray(snap.people)) return;
    this.service = snap.service ?? null;
    this.nextId = snap.nextId ?? 1;
    this.stats = { created: 0, matchedByTrack: 0, matchedByFace: 0, matchedByLook: 0, uncertain: 0, rejectedImpossible: 0, ...(snap.stats ?? {}) };
    this.people.clear();
    this.seats.clear();
    for (const p of snap.people) {
      // Both spellings: the short one written now, and the long one written
      // before it, so a register saved by the previous version still loads
      // rather than a congregation starting again from nobody.
      const id = p.i ?? p.id;
      if (!id) continue;
      const seatKey = p.sk ?? p.seatKey ?? null;
      this.people.set(id, {
        // Who was seen a moment ago is a question about now, not about the
        // service so far, so it starts empty and the next report fills it.
        seenAt: new Map(),
        id, firstAt: p.f ?? p.firstAt ?? 0, lastAt: p.l ?? p.lastAt ?? 0,
        seen: p.n ?? p.seen ?? 1, uncertain: p.u ?? p.uncertain ?? 0,
        cameras: new Set(p.c ?? p.cameras ?? []), lastCamera: p.k ?? p.lastCamera ?? "",
        seat: p.s ?? p.seat ?? null, seatKey, seatAt: p.sa ?? p.seatAt ?? 0,
        seatCamera: p.sc ?? p.seatCamera ?? "",
        looks: p.b ?? p.looks ?? [],
        // Faces are not in the snapshot: they are kept in their own table, so
        // they can be deleted on their own the moment the service ends. The
        // worker puts them back here after restoring — see loadFaces.
        faces: [],
      });
      // Who is in which seat is rebuilt from the people, so the two can never
      // disagree after a restart.
      if (seatKey) this.seats.set(seatKey, id);
    }
  }
}
