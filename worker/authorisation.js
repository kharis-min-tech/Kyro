/**
 * Permission to read faces: who gave it, on what basis, and until when.
 *
 * ── What this is for ───────────────────────────────────────────────────────
 *
 * Reading faces — even as numbers that are deleted when a service ends — is
 * processing biometric data for the purpose of uniquely identifying someone.
 * Under UK GDPR that is special category data: it needs a lawful basis under
 * Article 6 AND a separate condition under Article 9, and in a church it also
 * touches people who did not choose to be measured and may not have been asked.
 *
 * Until now the whole of that lived in two tick boxes on a card, ticked by
 * whoever happened to be switching the feature on. Two tick boxes are not a
 * lawful basis. They are a record that somebody said yes.
 *
 * ── What this deliberately does NOT do ─────────────────────────────────────
 *
 * It does not decide whether a church is compliant, and it never says so. It
 * cannot: that is a judgement about a real organisation's circumstances, made
 * by people who are accountable for it. A filled-in form is not compliance,
 * an uploaded DPIA is not a completed DPIA, and an approval button is not a
 * lawyer.
 *
 * What it does is refuse to let face matching run until the church has
 * actually written down its own answers — which basis, which condition, who
 * decided, who is accountable, what the notices say, what somebody who objects
 * is offered instead, and when it will all be looked at again — and make those
 * answers, and every change to them, impossible to lose.
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 *
 * Face matching cannot be switched on unless this is approved and in date.
 * When it expires or is withdrawn, new processing stops and anything already
 * held is deleted. That is enforced in the worker, not by hiding a button.
 */

/** How the authorisation can stand. */
export const STATES = [
  "not_configured",      // nobody has started
  "incomplete",          // started, but something required is missing
  "awaiting_approval",   // complete, waiting for the responsible person
  "approved",            // approved and in date — face matching may run
  "expired",             // the review date has passed
  "suspended",           // withdrawn by the church
];

/** An approval must be looked at again at least this often. */
export const MAX_REVIEW_MONTHS = 12;
/** A warning appears this long before the review date. */
export const WARN_BEFORE_MS = 30 * 86_400_000;
/** How many changes are kept. */
const LOG_KEEP = 300;

const str = (v, n = 200) => String(v ?? "").slice(0, n).trim();
const yes = (v) => v === true;

/**
 * The questions that must be answered before this can even be submitted.
 *
 * Each one asks the church to write something, not to tick something. A box
 * that only needs ticking records that somebody clicked; a box that needs
 * filling in records what they decided and can be read back by whoever has to
 * defend it.
 */
export const REQUIRED = [
  { id: "organisation", title: "The church and who is responsible for the data",
    needs: (a) => !!(a.organisation.name && a.organisation.controller_name && a.organisation.controller_role),
    why: "Someone has to be accountable by name, not 'the church'." },
  { id: "representative", title: "Who approved it",
    needs: (a) => !!(a.representative.name && a.representative.role),
    why: "The person taking the decision, and the position that lets them take it." },
  { id: "article6", title: "Lawful basis (Article 6)",
    needs: (a) => !!(a.article6.basis && a.article6.why.length >= 20),
    why: "Which basis, and why it applies here — in the church's own words." },
  { id: "article9", title: "Condition for biometric data (Article 9)",
    needs: (a) => !!(a.article9.condition && a.article9.why.length >= 20),
    why: "Biometric data needs a second, separate condition. Article 6 alone is not enough." },
  { id: "consent", title: "Consent arrangements",
    needs: (a) => a.consent.needed === false
      ? a.consent.why_not.length >= 20
      : !!(a.consent.how.length >= 20 && a.consent.withdraw_how.length >= 20),
    why: "If consent is the condition, how it is asked for and how somebody takes it back." },
  { id: "dpia", title: "Data protection impact assessment",
    needs: (a) => yes(a.dpia.completed) && !!a.dpia.by && !!a.dpia.at,
    why: "A DPIA is required for biometric monitoring in a public space. Kyro records that you have one; it cannot do it for you." },
  { id: "notices", title: "Telling people",
    needs: (a) => yes(a.notices.at_entrances) && a.notices.wording.length >= 20,
    why: "People have to be told before they walk past a camera that reads faces." },
  { id: "alternative", title: "For people who do not want to take part",
    needs: (a) => a.alternative.what.length >= 20,
    why: "There must be a way to attend without being measured, and somebody has to know what it is." },
  { id: "retention", title: "How long face data is kept",
    needs: (a) => !!a.retention.understood,
    why: "Kyro deletes face codes when a service ends, and within 12 hours whatever happens. The church confirms this matches what it told people." },
  { id: "processors", title: "Who else is involved",
    needs: (a) => a.processors.length > 0 || yes(a.processors_none),
    why: "Anyone handling the data on the church's behalf, and the agreement with them." },
  { id: "review", title: "When this will be looked at again",
    needs: (a) => !!a.review_by,
    why: "An authorisation with no end date is one nobody ever revisits." },
];

export function blank() {
  return {
    state: "not_configured",
    organisation: { name: "", controller_name: "", controller_role: "", controller_email: "", ico_registration: "" },
    representative: { name: "", role: "" },
    article6: { basis: "", why: "" },
    article9: { condition: "", why: "" },
    consent: { needed: null, how: "", withdraw_how: "", why_not: "" },
    dpia: { completed: false, by: "", at: "", reference: "" },
    notices: { at_entrances: false, wording: "", where: "" },
    alternative: { what: "" },
    retention: { understood: false },
    processors: [],
    processors_none: false,
    review_by: "",
    approved_by: "", approved_at: "", approved_role: "",
    suspended_by: "", suspended_at: "", suspended_why: "",
    documents: [],
    log: [],
    version: 0,
  };
}

export class Authorisation {
  constructor(saved) {
    const b = blank();
    const a = saved && typeof saved === "object" ? saved : {};
    // Merged field by field so an older record keeps what it had and gains
    // whatever is new, rather than being replaced by a blank one.
    this.d = {
      ...b, ...a,
      organisation: { ...b.organisation, ...(a.organisation ?? {}) },
      representative: { ...b.representative, ...(a.representative ?? {}) },
      article6: { ...b.article6, ...(a.article6 ?? {}) },
      article9: { ...b.article9, ...(a.article9 ?? {}) },
      consent: { ...b.consent, ...(a.consent ?? {}) },
      dpia: { ...b.dpia, ...(a.dpia ?? {}) },
      notices: { ...b.notices, ...(a.notices ?? {}) },
      alternative: { ...b.alternative, ...(a.alternative ?? {}) },
      retention: { ...b.retention, ...(a.retention ?? {}) },
      processors: Array.isArray(a.processors) ? a.processors : [],
      documents: Array.isArray(a.documents) ? a.documents : [],
      log: Array.isArray(a.log) ? a.log : [],
    };
  }

  /** Which required sections are still unanswered. */
  missing() {
    return REQUIRED.filter((r) => {
      try { return !r.needs(this.d); } catch { return true; }
    }).map((r) => ({ id: r.id, title: r.title, why: r.why }));
  }

  /**
   * Where this stands, worked out from what is actually written down.
   *
   * Deliberately computed rather than stored: a stored state can say
   * "approved" while the thing it approved has been emptied out underneath it.
   */
  state(now = Date.now()) {
    const d = this.d;
    if (d.suspended_at) return "suspended";
    const missing = this.missing();
    if (!d.approved_at) {
      if (missing.length === REQUIRED.length) return "not_configured";
      return missing.length ? "incomplete" : "awaiting_approval";
    }
    // Approved — but an approval only covers what was approved. If a required
    // answer has since been removed, it is not approved any more.
    if (missing.length) return "incomplete";
    const by = Date.parse(d.review_by || "");
    if (!by || by < now) return "expired";
    return "approved";
  }

  /** May face matching run right now? The only question the rest of Kyro asks. */
  allowsFaces(now = Date.now()) { return this.state(now) === "approved"; }

  /** Days until the review date, negative once it has passed. */
  daysLeft(now = Date.now()) {
    const by = Date.parse(this.d.review_by || "");
    return by ? Math.round((by - now) / 86_400_000) : null;
  }

  // ── Changing it ──────────────────────────────────────────────────────────

  note(who, what, detail = "") {
    this.d.log.unshift({ at: new Date().toISOString(), who: str(who, 60), what: str(what, 160), detail: str(detail, 200) });
    if (this.d.log.length > LOG_KEEP) this.d.log.length = LOG_KEEP;
    this.d.version++;
  }

  /**
   * Save answers. Approval is NOT part of this: changing what was approved
   * takes the approval away, because an approval covers particular words and
   * those words have changed.
   */
  update(patch, who, now = Date.now()) {
    const d = this.d;
    const before = this.state(now);
    const sections = ["organisation", "representative", "article6", "article9", "consent", "dpia", "notices", "alternative", "retention"];
    const changed = [];
    for (const k of sections) {
      if (!patch[k] || typeof patch[k] !== "object") continue;
      for (const [f, v] of Object.entries(patch[k])) {
        if (!(f in d[k])) continue;
        const clean = typeof d[k][f] === "boolean" ? !!v : typeof v === "boolean" ? v : str(v, 2000);
        if (d[k][f] !== clean) { d[k][f] = clean; changed.push(`${k}.${f}`); }
      }
    }
    if (Array.isArray(patch.processors)) {
      d.processors = patch.processors.slice(0, 20).map((p) => ({
        name: str(p?.name, 80), does: str(p?.does, 200), agreement: str(p?.agreement, 200),
      })).filter((p) => p.name);
      changed.push("processors");
    }
    if (typeof patch.processors_none === "boolean") { d.processors_none = patch.processors_none; changed.push("processors_none"); }
    if (patch.review_by !== undefined) {
      const by = str(patch.review_by, 40);
      const at = Date.parse(by);
      const far = now + MAX_REVIEW_MONTHS * 31 * 86_400_000;
      if (by && (!at || at > far)) {
        return { error: `The review date must be a real date within ${MAX_REVIEW_MONTHS} months. An authorisation with no end is one nobody revisits.` };
      }
      if (d.review_by !== by) { d.review_by = by; changed.push("review_by"); }
    }
    if (!changed.length) return { ok: true, nothing: true };

    // Changing what was approved removes the approval. Nothing in here may
    // quietly alter the terms of a decision somebody else signed.
    let lost = false;
    if (d.approved_at) {
      d.approved_at = ""; d.approved_by = ""; d.approved_role = "";
      lost = true;
    }
    this.note(who, `Changed ${changed.length} answer${changed.length === 1 ? "" : "s"}`, changed.join(", "));
    if (lost) this.note(who, "Approval removed because the answers changed", "It has to be approved again");
    return { ok: true, was: before, now: this.state(now), approval_lost: lost };
  }

  /**
   * The responsible person approves it.
   *
   * They must confirm each statement separately, by name and role, and nothing
   * may be missing. Kyro records a decision; it does not make one, and it
   * never says the church is compliant.
   */
  approve(who, role, confirmations, now = Date.now()) {
    const missing = this.missing();
    if (missing.length) {
      return { error: `Not everything has been answered yet: ${missing.map((m) => m.title).join(", ")}` };
    }
    const need = ["accountable", "read_dpia", "basis_is_ours", "notices_up", "alternative_real"];
    const short = need.filter((n) => !yes(confirmations?.[n]));
    if (short.length) return { error: "Each statement has to be confirmed before this can be approved." };
    if (!str(who) || !str(role)) return { error: "Who is approving this, and in what role?" };
    this.d.approved_by = str(who, 80);
    this.d.approved_role = str(role, 80);
    this.d.approved_at = new Date(now).toISOString();
    this.d.suspended_at = ""; this.d.suspended_by = ""; this.d.suspended_why = "";
    this.note(who, `Approved as ${str(role, 80)}`, `Review due ${this.d.review_by}`);
    return { ok: true, now: this.state(now) };
  }

  /**
   * Withdrawn. Face matching stops and anything held is deleted — the caller
   * does the deleting, and is expected to report whether it worked.
   */
  suspend(who, why, now = Date.now()) {
    this.d.suspended_by = str(who, 80);
    this.d.suspended_at = new Date(now).toISOString();
    this.d.suspended_why = str(why, 300);
    this.note(who, "Authorisation withdrawn", str(why, 200));
    return { ok: true, now: this.state(now) };
  }

  /** Put a withdrawn authorisation back, if nothing else is missing. */
  resume(who, now = Date.now()) {
    if (!this.d.suspended_at) return { error: "It isn't withdrawn" };
    this.d.suspended_at = ""; this.d.suspended_by = ""; this.d.suspended_why = "";
    this.note(who, "Withdrawal lifted", this.d.approved_at ? "The earlier approval still stands" : "It still needs approving");
    return { ok: true, now: this.state(now) };
  }

  /** A document the church holds. Kyro records it; it is not a filing cabinet. */
  addDocument(doc, who, now = Date.now()) {
    const d = {
      id: `doc-${Math.random().toString(36).slice(2, 10)}`,
      name: str(doc?.name, 120), kind: str(doc?.kind, 40) || "other",
      kept: str(doc?.kept, 300), reference: str(doc?.reference, 200),
      added_by: str(who, 60), at: new Date(now).toISOString(),
      has_file: !!doc?.has_file, bytes: Number(doc?.bytes) || 0,
    };
    if (!d.name) return { error: "The document needs a name" };
    this.d.documents.unshift(d);
    if (this.d.documents.length > 40) this.d.documents.length = 40;
    this.note(who, `Recorded a document: ${d.name}`, d.kind);
    return { ok: true, id: d.id };
  }

  removeDocument(id, who) {
    const was = this.d.documents.find((x) => x.id === id);
    if (!was) return { error: "No such document" };
    this.d.documents = this.d.documents.filter((x) => x.id !== id);
    this.note(who, `Removed a document: ${was.name}`);
    return { ok: true };
  }

  /**
   * Somebody has asked not to be included, or has taken consent back.
   *
   * Recorded with no face data of any kind — the point of the record is that a
   * request was made and acted on, and keeping a face code to prove it would
   * be keeping the very thing the person asked Kyro not to hold.
   */
  objection(what, who, now = Date.now()) {
    this.note(who, "Someone asked not to be included", str(what, 200));
    return { ok: true, at: new Date(now).toISOString() };
  }

  /** What the page shows. Everything here is safe to read. */
  view(now = Date.now()) {
    const state = this.state(now);
    const days = this.daysLeft(now);
    return {
      ...this.d,
      state,
      missing: this.missing(),
      allows_faces: state === "approved",
      days_left: days,
      due_soon: state === "approved" && days !== null && days * 86_400_000 <= WARN_BEFORE_MS,
      required: REQUIRED.map((r) => ({ id: r.id, title: r.title, why: r.why, done: !this.missing().some((m) => m.id === r.id) })),
    };
  }

  save() { return this.d; }
}
