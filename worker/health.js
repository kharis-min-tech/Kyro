/**
 * What is wrong with Kyro, where, and since when.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Three failures in the path that produces the attendance figure were being
 * written to a console log:
 *
 *   - the register of people failing, after which attendance quietly falls
 *     back to each camera's own tally and MEANS SOMETHING DIFFERENT while
 *     looking exactly the same;
 *   - a camera's seat states being too big to store, after which the seat map
 *     silently stops updating;
 *   - service tracking failing, after which a service may never start or end.
 *
 * A console log in a Cloudflare Worker is not somewhere a church can look. So
 * every one of those now ends up here, and here is on the screen.
 *
 * ── The rules it keeps ─────────────────────────────────────────────────────
 *
 * A problem stays until the thing that failed reports that it is working
 * again. It cannot be cleared by time passing, or by a page being reloaded.
 *
 * An administrator can put one aside — but putting aside only marks it fixed:
 * the entry, its count and its times stay in the record, and the next time it
 * happens it goes straight back to live. So nothing that is still happening
 * can be hidden, while a camera that was unplugged after a bad few minutes
 * stops shouting about it for ever. That case has no other way out: the thing
 * that failed is in a drawer and will never report anything again.
 *
 * A problem that happens over and over is one entry with a count and a first
 * and last time, not ten thousand entries. The count is part of the evidence —
 * "failed 4,812 times since 10:02" is a different thing from "failed once".
 *
 * Nothing here ever changes a figure. It records that a figure could not be
 * produced, which is the opposite.
 */

/** How many distinct problems are kept. Beyond this the oldest resolved go. */
const KEEP = 60;

export class Trouble {
  constructor(saved) {
    this.items = new Map();
    for (const [k, v] of saved?.items ?? []) this.items.set(k, v);
  }

  /**
   * Something failed.
   *
   * @param where   which part of Kyro — "register", "seat states", a camera's name
   * @param what    what went wrong, in words somebody could act on
   * @param detail  anything that helps find it; never anything about a person
   */
  note(where, what, detail = "") {
    const key = `${where}|${what}`.slice(0, 200);
    const now = Date.now();
    const had = this.items.get(key);
    if (had) {
      had.count++; had.last = now; had.fixed = false;
      if (detail) had.detail = String(detail).slice(0, 300);
    } else {
      this.items.set(key, { where, what, detail: String(detail).slice(0, 300), first: now, last: now, count: 1, fixed: false });
      this.prune();
    }
    return key;
  }

  /**
   * That part is working again.
   *
   * The problem is not deleted: it is marked fixed, with the time it was last
   * failing still on it. "This happened for twenty minutes this morning" is
   * worth knowing afterwards, and a problem that quietly disappeared is how
   * nobody ever finds out why the figures looked odd.
   */
  ok(where) {
    const now = Date.now();
    let changed = false;
    for (const [, v] of this.items) {
      if (v.where === where && !v.fixed) { v.fixed = true; v.fixedAt = now; changed = true; }
    }
    return changed;
  }

  /**
   * Put a problem aside, because somebody has looked at it.
   *
   * The rule above — only the thing working again clears a problem — was
   * written for a problem about a part of Kyro that is still running. It is
   * wrong for the commonest case there is: a camera that was unplugged, or
   * switched off, after a bad few minutes. It cannot report that it is working
   * again, because it is not there. So four red lines about a camera that is
   * sitting in a drawer stayed on the page for ever, with nothing on the page
   * that could remove them, and the person reading it started clicking the red
   * icons hoping one of them was a button.
   *
   * Putting one aside is safe, which is what makes it allowable: it is marked
   * fixed, not deleted — the time it happened, the count and the detail are
   * all still here — and if it happens once more note() marks it live again.
   * Nothing can be hidden that is still going on.
   *
   * It used to be listed on the page afterwards, under "Fixed, but worth
   * knowing about". That list is no longer printed; the record is the same.
   */
  aside(where, what = null, who = "") {
    const now = Date.now();
    let put = 0;
    for (const [, v] of this.items) {
      if (v.fixed) continue;
      if (v.where !== where) continue;
      if (what && v.what !== what) continue;
      v.fixed = true; v.fixedAt = now; v.asideBy = String(who || "").slice(0, 60) || "an administrator";
      put++;
    }
    return put;
  }

  /** Everything about a part of Kyro that no longer exists. */
  forget(where) {
    let gone = 0;
    for (const [k, v] of [...this.items]) if (v.where === where) { this.items.delete(k); gone++; }
    return gone;
  }

  /** Is anything actually broken right now? */
  get broken() {
    for (const [, v] of this.items) if (!v.fixed) return true;
    return false;
  }

  prune() {
    if (this.items.size <= KEEP) return;
    // Only resolved problems may be forgotten, oldest first. A live problem is
    // never dropped to make room — that is how a failure disappears from a
    // dashboard without anybody fixing it.
    const resolved = [...this.items.entries()].filter(([, v]) => v.fixed).sort((a, b) => a[1].last - b[1].last);
    while (this.items.size > KEEP && resolved.length) this.items.delete(resolved.shift()[0]);
  }

  /** Newest trouble first, with the live ones above the resolved ones. */
  list(now = Date.now()) {
    return [...this.items.values()]
      .sort((a, b) => (a.fixed === b.fixed ? b.last - a.last : a.fixed ? 1 : -1))
      .map((v) => ({
        where: v.where, what: v.what, detail: v.detail,
        happened: v.count,
        since: new Date(v.first).toISOString(),
        last: new Date(v.last).toISOString(),
        ago_s: Math.round((now - v.last) / 1000),
        fixed: !!v.fixed,
        fixed_at: v.fixedAt ? new Date(v.fixedAt).toISOString() : null,
        /** Set when somebody put it aside rather than it fixing itself. */
        aside_by: v.asideBy || null,
      }));
  }

  save() { return { items: [...this.items.entries()] }; }
}

/**
 * Is a camera actually working?
 *
 * Connected is not working. A camera with a network connection and a black
 * picture is not a working camera, and a camera that froze twenty minutes ago
 * is still sending Kyro the same frame it sent then. Each of these is checked
 * separately and reported separately, because "camera is fine" covering four
 * different questions is how a broken camera stays green.
 *
 * @param c       what the camera last reported
 * @param now     the clock
 * @param needFps how many counts a second this camera needs for its job
 */
/**
 * A length of time somebody can read.
 *
 * "791909s ago" is a true statement and a useless one: nobody converts two
 * hundred and twenty hours in their head, and the number is so long it reads
 * as noise. Hours and minutes, or days once it is past a couple of them.
 */
export function howLong(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs}s` : `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 48) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} days ${rh} h` : `${d} days`;
}

export function cameraHealth(c, now, needFps = 0) {
  const checks = [];
  const add = (name, ok, says) => checks.push({ name, ok, says });
  const since = c.updated_at ? now - c.updated_at : Infinity;

  add("Reporting", since < 30_000,
    since === Infinity ? "has never reported" : `last heard from ${howLong(since)} ago`);
  // Everything below is only meaningful if it is reporting at all.
  if (since < 30_000) {
    add("Sending a picture", !c.no_picture, c.no_picture ? "open, but sending no picture" : "sending pictures");
    add("Picture is not black", !c.black,
      c.black ? "the picture is black — check the lens cap, the lighting, and whether this camera manages 1920x1080" : "the picture has something in it");
    add("Picture is not frozen", !c.frozen,
      c.frozen ? "the same picture over and over — the camera has stopped, even though it is still connected" : "the picture is changing");
    add("Counting", !!c.counted_at && now - c.counted_at < 60_000,
      c.counted_at ? `last counted ${howLong(now - c.counted_at)} ago` : "has not counted anything");
    if (needFps > 0) {
      add("Fast enough for its job", (c.fps || 0) >= needFps,
        `${c.fps || 0} counts a second, needs ${needFps}`);
    }
    if (c.error) add("No errors", false, c.error);
  }
  const failed = checks.filter((x) => !x.ok);
  return {
    ok: failed.length === 0,
    state: failed.length === 0 ? "working" : since >= 30_000 ? "not reporting" : "problem",
    checks,
    /** The thing to deal with first. */
    worst: failed[0]?.says ?? null,
  };
}
