/**
 * Permission to read faces.
 *
 * Reading faces is processing biometric data to identify people. Under UK
 * GDPR that needs a lawful basis under Article 6 AND a separate condition
 * under Article 9, and in a church it touches people who never chose to be
 * measured. Until now the whole of that was two tick boxes on a card.
 *
 * What is tested here is not that a church is compliant — Kyro cannot know
 * that and must never claim it. It is that face matching CANNOT RUN until the
 * decisions have actually been written down and approved by somebody who says
 * who they are, that changing an approved answer takes the approval away, and
 * that expiry or withdrawal stops the processing rather than merely hiding a
 * button.
 *
 *   node tests/test_authorisation.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Authorisation, REQUIRED, MAX_REVIEW_MONTHS } from "../worker/authorisation.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");
const LONG = "We rely on this because the church needs to know how many people are in the building for safety.";

/** Fill in everything a church would have to answer. */
function filled(now = Date.now()) {
  const a = new Authorisation();
  a.update({
    organisation: { name: "Kharis Church", controller_name: "A Person", controller_role: "Church secretary" },
    representative: { name: "A Trustee", role: "Trustee" },
    article6: { basis: "legitimate_interests", why: LONG },
    article9: { condition: "not_for_profit", why: LONG },
    consent: { needed: false, why_not: LONG },
    dpia: { completed: true, by: "A Person", at: "2026-10-01" },
    notices: { at_entrances: true, wording: LONG },
    alternative: { what: LONG },
    retention: { understood: true },
    processors_none: true,
    review_by: new Date(now + 90 * 86_400_000).toISOString().slice(0, 10),
  }, "Kharis Admin", now);
  return a;
}
const CONFIRM = { accountable: true, read_dpia: true, basis_is_ours: true, notices_up: true, alternative_real: true };

// ── It starts closed ───────────────────────────────────────────────────────
{
  const a = new Authorisation();
  ok("a new church starts with nothing set up", a.state() === "not_configured");
  ok("and faces may not be read", a.allowsFaces() === false);
  ok("every required answer is listed as missing", a.missing().length === REQUIRED.length, `${a.missing().length}`);
  ok("and each says why it is needed", a.missing().every((m) => m.title && m.why.length > 20));
}

// ── Half-done is not done ──────────────────────────────────────────────────
{
  const a = new Authorisation();
  a.update({ organisation: { name: "Kharis Church", controller_name: "A Person", controller_role: "Secretary" } }, "Admin");
  ok("part-way through, it is incomplete", a.state() === "incomplete");
  ok("and faces still may not be read", !a.allowsFaces());

  // The thing most often missed: Article 6 chosen, Article 9 forgotten.
  const b = filled();
  b.update({ article9: { condition: "", why: "" } }, "Admin");
  ok("Article 6 on its own is not enough", b.state() === "incomplete");
  ok("and it says exactly what is missing",
     b.missing().some((m) => m.id === "article9"), JSON.stringify(b.missing().map((m) => m.id)));
}

// ── A tick is not a basis ──────────────────────────────────────────────────
{
  const a = filled();
  a.update({ article6: { basis: "legitimate_interests", why: "yes" } }, "Admin");
  ok("a one-word answer does not count as having decided anything",
     a.missing().some((m) => m.id === "article6"), "a basis needs explaining, not selecting");
}

// ── Approval ───────────────────────────────────────────────────────────────
{
  const a = filled();
  ok("once everything is answered it awaits approval", a.state() === "awaiting_approval");
  ok("but faces still may not be read until somebody approves it", !a.allowsFaces());

  const noName = a.approve("", "", CONFIRM);
  ok("approving anonymously is refused", !!noName.error);
  const noConfirm = a.approve("A Trustee", "Trustee", { accountable: true });
  ok("approving without confirming each statement is refused", !!noConfirm.error);

  const done = a.approve("A Trustee", "Trustee", CONFIRM);
  ok("a named person confirming everything can approve it", done.ok === true, JSON.stringify(done));
  ok("and only then may faces be read", a.allowsFaces() === true);
  ok("with who approved it, and in what role", a.d.approved_by === "A Trustee" && a.d.approved_role === "Trustee");
}

// ── An approval covers particular words ────────────────────────────────────
{
  const a = filled();
  a.approve("A Trustee", "Trustee", CONFIRM);
  ok("approved", a.allowsFaces());
  a.update({ article9: { why: "Something else entirely, which nobody has approved." } }, "Someone Else");
  ok("changing an approved answer takes the approval away", !a.allowsFaces(), a.state());
  ok("and says so in the history", a.d.log.some((l) => /Approval removed/.test(l.what)));
  ok("it goes back to waiting for approval, not to broken", a.state() === "awaiting_approval");
}

// ── Review dates ───────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-11-10T12:00:00Z");
  const a = filled(now);
  a.approve("A Trustee", "Trustee", CONFIRM, now);
  ok("approved and in date", a.allowsFaces(now));
  const later = now + 120 * 86_400_000;            // past the 90-day review
  ok("after the review date it expires by itself", a.state(later) === "expired");
  ok("and faces may not be read", !a.allowsFaces(later));
  ok("nobody has to remember to do it", a.d.approved_at !== "");

  // A review date that never comes is not a review date.
  const b = filled(now);
  const far = b.update({ review_by: new Date(now + 5 * 365 * 86_400_000).toISOString().slice(0, 10) }, "Admin", now);
  ok(`a review date beyond ${MAX_REVIEW_MONTHS} months is refused`, !!far.error, JSON.stringify(far));
}

// ── Withdrawal ─────────────────────────────────────────────────────────────
{
  const a = filled();
  a.approve("A Trustee", "Trustee", CONFIRM);
  a.suspend("Kharis Admin", "Someone objected and we are looking at it again");
  ok("withdrawing stops it", a.state() === "suspended" && !a.allowsFaces());
  ok("with who and why", a.d.suspended_by === "Kharis Admin" && /objected/.test(a.d.suspended_why));
  a.resume("Kharis Admin");
  ok("and it can be put back", a.allowsFaces() === true);
}

// ── The audit trail ────────────────────────────────────────────────────────
{
  const a = filled();
  a.approve("A Trustee", "Trustee", CONFIRM);
  a.objection("Somebody asked not to be included; told the ushers", "Kharis Admin");
  const log = a.d.log;
  ok("every change is recorded with who made it", log.every((l) => "who" in l && "at" in l));
  ok("including somebody asking not to be included",
     log.some((l) => /asked not to be included/.test(l.what)));
  // Nothing in the history may contain face data — keeping a face code to
  // prove somebody asked not to be measured is keeping the very thing they
  // asked Kyro not to hold.
  const text = JSON.stringify(log);
  ok("and no face data is anywhere in it",
     !/face_code|embedding|descriptor|[A-Za-z0-9+/]{200,}/.test(text));
}

// ── The gate is in the worker, not in the page ─────────────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("switching face matching on checks the authorisation",
     /const auth = await this\.authorisation\(\);\s*\n\s*if \(!auth\.allowsFaces\(\)\)/.test(worker));
  ok("and says what is missing rather than just refusing",
     /needs_authorisation: true, state, missing: auth\.missing\(\)/.test(worker));
  ok("it is checked on every report, not only when the switch is flipped",
     /const mayReadFaces = await this\.facesAllowed\(\);/.test(worker));
  ok("expiry or withdrawal stops it and deletes the face codes",
     /auth\.note\("Kyro", "Face matching stopped automatically"/.test(worker)
     && /this\.wipeFaces\(\);[\s\S]{0,200}Face matching stopped automatically/.test(worker));
  ok("withdrawing deletes them there and then, not at the end of the service",
     /a\.note\(user, "Face codes deleted", "because the authorisation was withdrawn"\)/.test(worker));
  ok("and the failure is reported where it can be seen",
     /await this\.wrong\("Face matching",/.test(worker));
  ok("changing it is administrators only",
     /Only administrators can change the data protection record/.test(worker));
}

// ── The page says what it is not ───────────────────────────────────────────
{
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/data-protection/page.tsx"), "utf8");
  ok("the page refuses to claim compliance",
     /Answering these is not the same as being compliant, and Kyro will never tell you that you are/.test(page));
  ok("it says a tick is not a DPIA",
     /ticking a box saying you have a DPIA is not the same as\s*\n?\s*having done one/.test(page.replace(/\s+/g, " ")) || /is not the same as having done one/.test(page.replace(/\s+/g, " ")));
  ok("it explains Article 9 is a SECOND condition", /needs a second condition &lt;em&gt;as well as&lt;\/em&gt;|as well as/.test(page));
  ok("it asks for the alternative for people who object", /For people who do not want to take part/.test(page));
  ok("and does not pretend to be a filing cabinet",
     /It is not a filing cabinet and does not store the\s+file/.test(page));
  ok("every one of the eleven areas has a section",
     REQUIRED.every((r) => page.includes(`id="${r.id}"`)), REQUIRED.filter((r) => !page.includes(`id="${r.id}"`)).map((r) => r.id).join(", "));
}

// ── The page has to be reachable by the person who must fill it in ─────────
//
// Every account's pages were chosen before this page existed, so nobody's
// saved list contained it. The menu is built from that list — which made Data
// Protection invisible to everybody, including the administrator, while Kyro
// refused to switch face matching on until they had completed it. "There's no
// form to fill" was exactly right.
{
  const access = fs.readFileSync(path.join(root, "dashboard/src/lib/access.ts"), "utf8");
  ok("the page is a known page", /"data-protection",/.test(access));
  // It has no menu button: a once-a-year task does not belong in the way of
  // the pages used every Sunday. It is reached from the Face matching card,
  // which is where somebody meets the gate, and from the guide.
  const sidebar = fs.readFileSync(path.join(root, "dashboard/src/components/layout/Sidebar.tsx"), "utf8");
  ok("but it has no permanent menu button",
     !/href: "\/data-protection"/.test(sidebar));
  ok("and the menu says why, so nobody adds one back by accident",
     /deliberately NOT in this menu/.test(sidebar));
  const faces = fs.readFileSync(path.join(root, "dashboard/src/components/ui/FaceMatching.tsx"), "utf8");
  ok("it is linked from the switch it gates", /href="\/data-protection"/.test(faces));
  ok("with the promise beside the link", /Face codes last one service and are then deleted/.test(faces));
  ok("and an administrator always has it, whatever their saved list says",
     /const ALWAYS_FOR_ADMIN: PageId\[\] = \["data-protection"\];/.test(access));
  ok("added to a saved list of pages", /withAdminPages\(p\.pages\.filter/.test(access));
  ok("and to the defaults", /withAdminPages\(ROLE_DEFAULT_PAGES\[r\]/.test(access));
  ok("only for administrators", /r === "admin" \? \[\.\.\.new Set/.test(access));
}

// ── It leads with the promise, not with the caveats ────────────────────────
{
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/data-protection/page.tsx"), "utf8");
  ok("the first thing on the page is that face data is temporary",
     /Face data is temporary\. It lasts one service and is then deleted\./.test(page));
  ok("it says there are no photographs", /Kyro keeps <strong>no photographs of anybody<\/strong>/.test(page));
  ok("and no record of who attended", /no names, no record of who attended/.test(page));
  ok("and that nobody has to remember to delete anything",
     /Nobody has to remember to do any of it/.test(page));

  const docs = fs.readFileSync(path.join(root, "user-docs/pages/data-protection.md"), "utf8");
  ok("the guide leads with it too",
     docs.indexOf("Face data is temporary") < docs.indexOf("not the same as being compliant"));
  ok("and says where to find the page", /open \*\*Data Protection\*\* in the left-hand menu/.test(docs));
  ok("including what to do if it isn't there", /sign out and back in/.test(docs));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Face matching cannot run until the church has decided it may.");
process.exit(fails ? 1 : 0);
