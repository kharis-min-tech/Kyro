/**
 * The building: one authoritative record of the physical seating.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Until now every camera kept its own seats. That is right for a camera — it
 * can only report what it can see — and wrong for a building, because the same
 * physical chair seen by two cameras became two chairs, and a church with
 * three cameras on one hall would have reported three halls' worth of seats.
 *
 * So there is one master seat per physical chair. Each camera's own detection
 * becomes a VIEW of that seat, kept rather than replaced: which camera sees
 * it, where in that camera's picture, and how sure it is. The master seat is
 * what has a permanent id, a row, a number and a place in the building; the
 * views are how it is recognised.
 *
 * ── What a seat is ─────────────────────────────────────────────────────────
 *
 * Deliberately not "a chair". Kharis Church uses individual chairs today, but
 * this will be asked to handle pews that hold six, a tiered choir stand, and
 * halls rearranged between services. So a seat belongs to a SECTION which has
 * a kind, and a seat has a number of places on it: a chair has one, a pew has
 * as many as fit. Nothing here assumes one person per piece of furniture.
 *
 * ── Deciding two detections are one chair ──────────────────────────────────
 *
 * Not by how alike they look, how big they are, or how close their boxes
 * happen to fall — two neighbouring identical chairs would fail every one of
 * those. By WHO SITS IN THEM: when the person register has the same person in
 * seat K7 on one camera and seat K23 on another at the same moment, over and
 * over, those are the same chair. Nobody is in two places at once, so repeated
 * agreement is strong evidence, and two different chairs can never produce it.
 *
 * Kyro proposes; an administrator decides. Nothing is merged automatically.
 *
 * ── Integrity ──────────────────────────────────────────────────────────────
 *
 * This lives in a Durable Object: one owner, one thread, every change applied
 * in order. There is no race between two administrators — but there IS the
 * older problem of two people editing a stale page, so every change carries
 * the version it was made against and is refused if the building has moved on.
 * Nothing is ever deleted outright: removing a seat marks it removed, keeps
 * its id for ever so it can never be handed to a different chair, and can be
 * undone. Every change records who made it and when.
 */

/** Rows are named from the stage outwards. I and O are skipped: 1 and 0. */
const ROWS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
/** How many changes are kept in the history. */
const LOG_KEEP = 400;
/** Two cameras seeing one person this close together = the same moment. */
export const CO_SEEN_MS = 6_000;
/** Agreements before a duplicate is worth putting to an administrator. */
export const MERGE_EVIDENCE = 4;
/** …and this many disagreements kills it: they were seen as different people. */
export const MERGE_AGAINST = 2;

const nowISO = (t) => new Date(t).toISOString();

export class Building {
  constructor(state = {}) {
    this.version = state.version ?? 0;
    /** Where the stage is, per camera, so row A is the row nearest it. */
    this.stageOf = state.stageOf ?? {};
    /** The building's own plan, when an administrator has drawn one. */
    this.plan = state.plan ?? { stage: null, sections: [] };
    this.seats = new Map((state.seats ?? []).map((s) => [s.id, s]));
    this.nextId = state.nextId ?? 1;
    /** camera#seat → master seat id. How a detection finds its seat. */
    this.byView = new Map(state.byView ?? []);
    /** Evidence that two camera seats are one chair: key → { for, against }. */
    this.evidence = new Map(state.evidence ?? []);
    this.log = state.log ?? [];
  }

  // ── Detections ───────────────────────────────────────────────────────────

  /**
   * A camera has found a seat. Returns the master seat it belongs to.
   *
   * A detection NEVER merges itself into another camera's seat: at this point
   * Kyro has no evidence that two cameras are looking at the same chair, and
   * guessing is how two neighbouring chairs become one. It gets its own master
   * seat, and duplicates are settled later by who sits in them.
   */
  sawSeat(cameraId, camSeatId, bbox, at, extra = {}) {
    const view = `${cameraId}#${camSeatId}`;
    const known = this.byView.get(view);
    if (known && this.seats.has(known)) {
      const s = this.seats.get(known);
      s.views[cameraId] = { seat_id: camSeatId, bbox, at };
      return s;
    }
    const s = {
      id: `S${this.nextId++}`,
      section: extra.section ?? "Main",
      kind: extra.kind ?? "chair",
      places: extra.places ?? 1,
      row: "", number: 0,
      place: null,
      views: { [cameraId]: { seat_id: camSeatId, bbox, at } },
      status: "active",
      confirmed: false,
      at, by: "",
    };
    this.seats.set(s.id, s);
    this.byView.set(view, s.id);
    this.touch();
    return s;
  }

  /**
   * The person register saw somebody in one camera's seat and then, moments
   * later, in another camera's seat. Nobody is in two places at once, so this
   * is evidence those two are the same chair — or, if they were two different
   * people, evidence that they are not.
   */
  sameChairEvidence(viewA, viewB, agree = true) {
    if (!viewA || !viewB || viewA === viewB) return;
    const key = [viewA, viewB].sort().join("|");
    const e = this.evidence.get(key) ?? { for: 0, against: 0 };
    if (agree) e.for++; else e.against++;
    this.evidence.set(key, e);
  }

  /**
   * "No — two different chairs."
   *
   * An administrator looking at a pair and saying they are NOT one chair is
   * the strongest evidence there is, and there was no way to say it. The
   * panel offered one button, "One chair", so a pair you disagreed with
   * simply stayed on the list for ever, in front of every other pair.
   *
   * Recorded as enough disagreement to settle it rather than as one more
   * vote, because it is a person's answer and not a camera's guess.
   */
  notOneChair(viewA, viewB, by, version) {
    const key = [viewA, viewB].sort().join("|");
    const seats = [this.byView.get(viewA), this.byView.get(viewB)].filter(Boolean);
    const what = seats.length === 2
      ? `Marked ${seats[0]} and ${seats[1]} as different chairs`
      : "Marked two seats as different chairs";
    return this.change(by, version, what, () => {
      if (!viewA || !viewB || viewA === viewB) return { error: "No such pair" };
      const e = this.evidence.get(key) ?? { for: 0, against: 0 };
      const was = { ...e };
      e.against = Math.max(e.against, MERGE_AGAINST) + 1;
      this.evidence.set(key, e);
      return { undo: { pair: key, was } };
    });
  }

  /** Duplicates worth putting to an administrator, strongest evidence first. */
  proposals() {
    const out = [];
    for (const [key, e] of this.evidence) {
      if (e.for < MERGE_EVIDENCE || e.against >= MERGE_AGAINST) continue;
      const [a, b] = key.split("|");
      const sa = this.seats.get(this.byView.get(a)), sb = this.seats.get(this.byView.get(b));
      if (!sa || !sb || sa.id === sb.id) continue;
      if (sa.status !== "active" || sb.status !== "active") continue;
      out.push({
        keep: sa.id, drop: sb.id, views: [a, b],
        /** Which camera saw each of them — the whole point of the pair, and
         *  the thing the panel never showed. A seat id on its own is two
         *  letters and a number. */
        cameras: [a.slice(0, a.lastIndexOf("#")), b.slice(0, b.lastIndexOf("#"))],
        agreements: e.for, disagreements: e.against,
        confidence: Math.min(0.99, e.for / (e.for + e.against + 4)),
      });
    }
    return out.sort((x, y) => y.agreements - x.agreements);
  }

  // ── What an administrator may do ─────────────────────────────────────────

  /**
   * Every change goes through here: it checks the page wasn't stale, records
   * who did it and when, and keeps enough to undo it.
   */
  change(by, version, what, apply) {
    if (version !== undefined && version !== null && version !== this.version) {
      return { error: "Somebody else changed the seating while this page was open. Reload and try again.", version: this.version };
    }
    const undo = apply();
    if (undo && undo.error) return undo;
    this.log.unshift({ at: nowISO(Date.now()), by: by || "", what, ...(undo?.note ? { note: undo.note } : {}), undo: undo?.undo ?? null });
    if (this.log.length > LOG_KEEP) this.log.length = LOG_KEEP;
    this.touch();
    return { ok: true, version: this.version, ...(undo?.result ?? {}) };
  }

  touch() { this.version++; }

  confirm(id, by, version) {
    return this.change(by, version, `Confirmed seat ${id}`, () => {
      const s = this.seats.get(id);
      if (!s) return { error: "No such seat" };
      const was = { status: s.status, confirmed: s.confirmed };
      s.status = "active"; s.confirmed = true; s.by = by; s.at = Date.now();
      return { undo: { id, ...was } };
    });
  }

  /** A false detection. Kept, not destroyed, and its id is never reused. */
  reject(id, by, version) {
    return this.change(by, version, `Rejected seat ${id}`, () => {
      const s = this.seats.get(id);
      if (!s) return { error: "No such seat" };
      const was = { status: s.status, confirmed: s.confirmed };
      s.status = "rejected"; s.confirmed = true; s.by = by; s.at = Date.now();
      return { undo: { id, ...was } };
    });
  }

  /** A seat that is no longer in the building. */
  remove(id, by, version) {
    return this.change(by, version, `Removed seat ${id}`, () => {
      const s = this.seats.get(id);
      if (!s) return { error: "No such seat" };
      const was = { status: s.status, confirmed: s.confirmed };
      s.status = "removed"; s.by = by; s.at = Date.now();
      return { undo: { id, ...was } };
    });
  }

  restore(id, by, version) {
    return this.change(by, version, `Restored seat ${id}`, () => {
      const s = this.seats.get(id);
      if (!s) return { error: "No such seat" };
      const was = { status: s.status };
      s.status = "active"; s.by = by; s.at = Date.now();
      return { undo: { id, ...was } };
    });
  }

  /** Add one Kyro missed. It gets a master id like any other. */
  add(by, version, { section = "Main", kind = "chair", places = 1, place = null, view = null } = {}) {
    return this.change(by, version, "Added a seat by hand", () => {
      const s = {
        id: `S${this.nextId++}`, section, kind, places, row: "", number: 0, place,
        views: {}, status: "active", confirmed: true, at: Date.now(), by,
      };
      if (view && view.camera && view.seat_id) {
        s.views[view.camera] = { seat_id: view.seat_id, bbox: view.bbox ?? null, at: Date.now() };
        this.byView.set(`${view.camera}#${view.seat_id}`, s.id);
      }
      this.seats.set(s.id, s);
      return { undo: { id: s.id, status: "removed" }, result: { id: s.id } };
    });
  }

  /** Correct where a seat is, on the building plan or in a camera's picture. */
  move(id, by, version, { place = undefined, camera = undefined, bbox = undefined } = {}) {
    return this.change(by, version, `Moved seat ${id}`, () => {
      const s = this.seats.get(id);
      if (!s) return { error: "No such seat" };
      const was = { id, place: s.place, views: JSON.parse(JSON.stringify(s.views)) };
      if (place !== undefined) s.place = place;
      if (camera && bbox && s.views[camera]) s.views[camera] = { ...s.views[camera], bbox };
      s.by = by; s.at = Date.now();
      return { undo: was };
    });
  }

  /**
   * Two records of one chair become one.
   *
   * The kept seat gains the other's camera views, so it is still recognised
   * from both cameras. The dropped one keeps its id for ever — marked merged
   * and pointing at where it went — so nothing can hand that id to a different
   * chair, and the merge can be undone exactly.
   */
  merge(keepId, dropId, by, version) {
    return this.change(by, version, `Merged seat ${dropId} into ${keepId}`, () => {
      const keep = this.seats.get(keepId), drop = this.seats.get(dropId);
      if (!keep || !drop) return { error: "No such seat" };
      if (keep === drop) return { error: "That is the same seat" };
      const moved = [];
      for (const [cam, v] of Object.entries(drop.views)) {
        if (keep.views[cam]) continue;                 // one view per camera
        keep.views[cam] = v;
        this.byView.set(`${cam}#${v.seat_id}`, keepId);
        moved.push(cam);
      }
      const was = { keepId, dropId, moved, status: drop.status };
      drop.status = "merged"; drop.mergedInto = keepId; drop.by = by; drop.at = Date.now();
      // The evidence has done its job; keeping it would re-propose the merge.
      for (const key of [...this.evidence.keys()]) {
        const [a, b] = key.split("|");
        if (this.byView.get(a) === keepId && this.byView.get(b) === keepId) this.evidence.delete(key);
      }
      return { undo: was };
    });
  }

  /** A merge that was wrong: the two go back to being two. */
  split(keepId, dropId, by, version) {
    return this.change(by, version, `Split seat ${dropId} back out of ${keepId}`, () => {
      const keep = this.seats.get(keepId), drop = this.seats.get(dropId);
      if (!keep || !drop || drop.mergedInto !== keepId) return { error: "Those seats were not merged" };
      for (const [cam, v] of Object.entries(drop.views)) {
        if (keep.views[cam]?.seat_id === v.seat_id) delete keep.views[cam];
        this.byView.set(`${cam}#${v.seat_id}`, dropId);
      }
      drop.status = "active"; drop.mergedInto = null; drop.by = by; drop.at = Date.now();
      // They were just told these are NOT one chair; don't propose it again.
      for (const [cam, v] of Object.entries(drop.views)) {
        for (const [cam2, v2] of Object.entries(keep.views)) {
          this.sameChairEvidence(`${cam}#${v.seat_id}`, `${cam2}#${v2.seat_id}`, false);
          this.sameChairEvidence(`${cam}#${v.seat_id}`, `${cam2}#${v2.seat_id}`, false);
        }
      }
      return { undo: { keepId, dropId } };
    });
  }

  /** Where the stage is for one camera, so its rows run the right way. */
  setStage(cameraId, where, by, version) {
    return this.change(by, version, `Stage set for ${cameraId}`, () => {
      const was = this.stageOf[cameraId] ?? null;
      this.stageOf[cameraId] = ["top", "bottom", "left", "right"].includes(where) ? where : "top";
      return { undo: { cameraId, where: was } };
    });
  }

  /** The building's own plan: where the stage is, and the sections. */
  setPlan(plan, by, version) {
    return this.change(by, version, "Building plan changed", () => {
      const was = this.plan;
      this.plan = {
        stage: plan?.stage ?? null,
        sections: Array.isArray(plan?.sections) ? plan.sections.slice(0, 40).map((s) => ({
          id: String(s.id ?? "").slice(0, 24) || `sec-${Math.random().toString(36).slice(2, 8)}`,
          name: String(s.name ?? "Main").slice(0, 40),
          kind: ["chairs", "bench", "tiered"].includes(s.kind) ? s.kind : "chairs",
          shape: Array.isArray(s.shape) ? s.shape.slice(0, 4).map(Number) : null,
        })) : [],
      };
      return { undo: { plan: was } };
    });
  }

  /** Put back whatever the last change did. */
  undoLast(by) {
    const entry = this.log[0];
    if (!entry || !entry.undo) return { error: "Nothing to undo" };
    const u = entry.undo;
    if (u.plan !== undefined) this.plan = u.plan;
    else if (u.pair) this.evidence.set(u.pair, { ...u.was });
    else if (u.cameraId) { if (u.where) this.stageOf[u.cameraId] = u.where; else delete this.stageOf[u.cameraId]; }
    else if (u.keepId && u.dropId) {
      const keep = this.seats.get(u.keepId), drop = this.seats.get(u.dropId);
      if (keep && drop) {
        if (u.moved) {                                  // undo a merge
          for (const cam of u.moved) {
            const v = drop.views[cam];
            if (v) { delete keep.views[cam]; this.byView.set(`${cam}#${v.seat_id}`, u.dropId); }
          }
          drop.status = u.status ?? "active"; drop.mergedInto = null;
        } else {                                        // undo a split
          for (const [cam, v] of Object.entries(drop.views)) {
            keep.views[cam] = v;
            this.byView.set(`${cam}#${v.seat_id}`, u.keepId);
          }
          drop.status = "merged"; drop.mergedInto = u.keepId;
        }
      }
    } else if (u.id) {
      const s = this.seats.get(u.id);
      if (s) {
        if (u.place !== undefined) { s.place = u.place; if (u.views) s.views = u.views; }
        else { s.status = u.status; if (u.confirmed !== undefined) s.confirmed = u.confirmed; }
      }
    }
    this.log.unshift({ at: nowISO(Date.now()), by: by || "", what: `Undid: ${entry.what}`, undo: null });
    this.touch();
    return { ok: true, version: this.version, undid: entry.what };
  }

  // ── Reading it ───────────────────────────────────────────────────────────

  /**
   * The seats one camera can see, named by row and number.
   *
   * Row A is the row nearest the stage. Which way that is comes from the
   * administrator — see setStage — and never from an assumption that the
   * stage is at the top of the picture, which was wrong half the time.
   */
  seatsFor(cameraId) {
    const mine = [...this.seats.values()].filter((s) => s.status === "active" && s.views[cameraId]);
    if (!mine.length) return [];
    const box = (s) => s.views[cameraId].bbox ?? [0, 0, 0, 0];
    const mid = (s) => (box(s)[1] + box(s)[3]) / 2;
    const across = (s) => (box(s)[0] + box(s)[2]) / 2;
    const stage = this.stageOf[cameraId] ?? "top";
    const sideways = stage === "left" || stage === "right";
    const depth = (s) => (sideways ? across(s) : mid(s));
    const along = (s) => (sideways ? mid(s) : across(s));
    const heights = mine.map((s) => box(s)[3] - box(s)[1]).sort((a, b) => a - b);
    const h = heights[Math.floor(heights.length / 2)] || 1;
    const away = stage === "bottom" || stage === "right";
    const order = [...mine].sort((a, b) => (away ? depth(b) - depth(a) : depth(a) - depth(b)));
    const rows = [];
    let row = [order[0]];
    for (const s of order.slice(1)) {
      if (Math.abs(depth(s) - depth(row[row.length - 1])) > 0.45 * h) { rows.push(row); row = []; }
      row.push(s);
    }
    rows.push(row);
    const out = [];
    rows.forEach((members, r) => {
      const label = r < ROWS.length ? ROWS[r] : `R${r + 1}`;
      [...members].sort((a, b) => along(a) - along(b)).forEach((s, i) => {
        s.row = label; s.number = i + 1;
        out.push({
          seat_id: s.id, row: label, number: i + 1, section: s.section,
          bbox: box(s), kind: s.kind, places: s.places, confirmed: s.confirmed,
        });
      });
    });
    return out;
  }

  /** Everything the Seat Management page shows. */
  overview() {
    const all = [...this.seats.values()];
    const active = all.filter((s) => s.status === "active");
    return {
      version: this.version,
      stage_of: this.stageOf,
      plan: this.plan,
      total: active.length,
      places: active.reduce((n, s) => n + (s.places || 1), 0),
      seen_by_more_than_one_camera: active.filter((s) => Object.keys(s.views).length > 1).length,
      unconfirmed: active.filter((s) => !s.confirmed).length,
      rejected: all.filter((s) => s.status === "rejected").length,
      removed: all.filter((s) => s.status === "removed").length,
      merged: all.filter((s) => s.status === "merged").length,
      /**
       * Not sent any more: nothing reads it.
       *
       * The seating page used to list these pairs for somebody to settle.
       * They are now put as questions, with a picture of the person at each
       * seat — see askAboutSameChair in worker/venue.js — and proposals()
       * is called there directly. Leaving fifty pairs of seat ids in every
       * reply is fifty pairs nobody will ever look at.
       */
      seats: active.map((s) => ({
        id: s.id, section: s.section, kind: s.kind, places: s.places, row: s.row, number: s.number,
        confirmed: s.confirmed, cameras: Object.keys(s.views), place: s.place, by: s.by,
      })),
      history: this.log.slice(0, 60).map(({ undo, ...rest }) => rest),
    };
  }

  save() {
    return {
      version: this.version, stageOf: this.stageOf, plan: this.plan, nextId: this.nextId,
      seats: [...this.seats.values()], byView: [...this.byView], evidence: [...this.evidence],
      log: this.log.slice(0, LOG_KEEP),
    };
  }
}
