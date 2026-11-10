/**
 * The bin in Recently deleted has to be a button.
 *
 * "mae the bin icon button active so i can permanetly delte it so its out of
 * the way if ever i know for sure, and put a are you sure button with kyros
 * UI".
 *
 * It was a picture. It was also the only thing on the row that looked like a
 * way to get rid of something, which is exactly what it was tapped for — the
 * same mistake as the red ✗ on "Is Kyro working?", on a different page, a few
 * hours later. If a row shows a bin, the bin deletes.
 *
 * Recently deleted holds a service for thirty days so a mistake can be
 * undone. That is the right default and it is not always what is wanted: six
 * test runs from one evening sit in the way for a month under a Bring it back
 * button nobody will ever press.
 *
 * This is the one place in Kyro that really destroys a record, so:
 *
 *   - administrators only, on the website as well as on the page;
 *   - asked first, in the page, in terms of what is about to happen — not in
 *     a box the browser drew, which appears for reloads too and teaches
 *     people to click through warnings without reading them;
 *   - and narrow. Only rows that were marked deleted WITH that service are
 *     removed. A reading that is still live in the same minute — another
 *     service's, a day that was never deleted — is not touched, however much
 *     the timestamps overlap.
 *
 *   node tests/test_delete_for_good.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const view = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");

// ── The website ────────────────────────────────────────────────────────────
{
  ok("there is a way to delete one for good", /async purgeService\(id, user\) \{/.test(worker));
  ok("and a route to it", /const purge = p\.match\(\/\^\\\/api\\\/live\\\/services-deleted\\\/\(\[\\w-\]\+\)\$\/\);/.test(worker));
  ok("administrators only", /Only administrators can delete a service for good/.test(worker));
  ok("a service that isn't in the bin can't be purged",
     /if \(!was\) return json\(\{ error: "That service isn't in Recently deleted" \}, 404\);/.test(worker));

  // The narrowness is the whole safety argument, so it is checked on the SQL.
  ok("only rows already marked deleted are destroyed",
     /DELETE FROM people WHERE deleted_at IS NOT NULL AND service = \?/.test(worker)
     && /DELETE FROM history WHERE deleted_at IS NOT NULL AND ts >= \? AND ts <= \?/.test(worker));
  ok("and nothing is destroyed at all unless the counts went with it",
     /if \(was\.counts_deleted && was\.started_at && was\.ended_at\) \{/.test(worker));
  ok("a failure to remove the counts is reported, not swallowed",
     /Removed the service but couldn't remove the counts that went with it/.test(worker));
  ok("who did it and when is written down, because it can't be undone",
     /purged_by: clean\(user, 60\), purged_at: new Date\(\)\.toISOString\(\)/.test(worker)
     && /await this\.ctx\.storage\.put\("purged_services"/.test(worker));
  ok("it is taken out of the bin", /await this\.ctx\.storage\.put\("deleted_services", log\.filter\(\(x\) => x\.id !== id\)\);/.test(worker));

  ok("the whole bin can go in one go", /async purgeAllServices\(user\) \{/.test(worker));
  ok("by the same route, one at a time underneath",
     /const res = await this\.purgeService\(s\.id, user\);/.test(worker));
  ok("and it is admin-only too",
     /if \(p === "\/api\/live\/services-deleted" && request\.method === "DELETE"\) \{\s*\n\s*if \(role !== "admin"\)/.test(worker));

  // Bringing one back must still work for everything still in the bin.
  ok("restoring is untouched", /async restoreService\(id, user\) \{/.test(worker)
     && /UPDATE people SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND service = \?/.test(worker));
}

// ── The page ───────────────────────────────────────────────────────────────
{
  ok("the bin is a button", /<button onClick=\{\(\) => \{ setConfirmPurge\(s\);/.test(view));
  ok("and still a plain picture for anyone who may not use it",
     /<Trash2 size=\{13\} className="shrink-0 text-gray-500" aria-hidden \/>/.test(view));
  ok("it says what it does, for a pointer and for a screen reader",
     /title=\{`Delete "\$\{s\.name\}" for good, now`\} aria-label=\{`Delete \$\{s\.name\} for good`\}/.test(view));

  // Kyro's own confirmation, in the page.
  ok("the are-you-sure is in the page, not the browser's",
     !/window\.confirm|confirm\(/.test(view) && /Delete &ldquo;\{s\.name\}&rdquo; for good\?/.test(view));
  ok("it says this cannot be undone", /This cannot be undone/.test(view));
  ok("and that Bring it back will stop working", /will\s*\n?\s*no longer work for it/.test(view.replace(/\s+/g, " ")) || /no longer work for it/.test(view));
  ok("it says whether any counts go with it",
     /The counts that were deleted with it go too/.test(view)
     && /The counts it recorded are not touched/.test(view));
  ok("there is a Cancel beside it", /Cancel\s*\n?\s*<\/button>/.test(view));
  ok("and the dangerous button is the one that looks dangerous",
     /background: "#b91c1c"/.test(view) && /Yes, delete it for good/.test(view));

  ok("the whole bin can be emptied from the page", /Empty the bin \(\{binned\.length\}\)/.test(view));
  ok("with its own confirmation", /Delete all \{binned\.length\} for good\?/.test(view));
  ok("offered only when there is more than one", /binned\.length > 1 && !confirmPurgeAll/.test(view));

  ok("none of it is offered to anyone but an administrator",
     /\{admin \? \(\s*\n?\s*<button onClick=\{\(\) => \{ setConfirmPurge/.test(view)
     && /\{admin && binned\.length > 1 && !confirmPurgeAll && \(/.test(view));
  ok("the explanation above the list mentions it", /The <strong className="text-gray-400">bin<\/strong> on a row removes it now/.test(view));

  // While one delete is running, nothing else on the list may be pressed —
  // half a bin emptied is worse than none.
  ok("the other buttons are held while one is working",
     (view.match(/disabled=\{busy !== null\}/g) ?? []).length >= 4);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The bin deletes, and asks first.");
process.exit(fails ? 1 : 0);
