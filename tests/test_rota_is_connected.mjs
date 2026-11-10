/**
 * The rota has to be connected to something.
 *
 * What was reported: "i tried to put a rota in for the kyro system to know
 * the times etc whats going on but it wasnt working nor was the system aware
 * of it and was working together".
 *
 * All of that was true, and the page said otherwise. It promised "Kyro will
 * use these times immediately" and claimed it could tell a scheduled worship
 * team from somebody going forward at an altar call. In fact a rota entry
 * reached the camera computers, held a few seats, and was never mentioned by
 * any figure, any session or any screen again. Its TIMES were used for
 * nothing at all.
 *
 * Promising what a page does not do is worse than doing nothing: it sends
 * somebody away believing a thing is set up.
 *
 * So the rota is now the thing that tells Kyro what is on:
 *
 *   - while something on the rota is running, a session starts as soon as a
 *     camera sees anybody, instead of waiting for five people to stay for two
 *     minutes — Kyro is not guessing any more, it has been told;
 *   - the session is NAMED after the rota entry, so Sessions and Analytics
 *     say what it was;
 *   - it finishes shortly after the rota says it ends, rather than recording
 *     all afternoon because a few people stayed to stack chairs;
 *   - and it is shown beside the live figures, because "is Kyro aware of my
 *     rota?" is answered by seeing the two agree on one screen.
 *
 *   node tests/test_rota_is_connected.mjs
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
const rota = fs.readFileSync(path.join(root, "dashboard/src/app/rota/page.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/WhatsOn.tsx"), "utf8");
const attendance = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
const integrations = fs.readFileSync(path.join(root, "dashboard/src/app/integrations/page.tsx"), "utf8");
/** A help page, whitespace flattened so a wrapped sentence still matches. */
const docs = (f) => fs.readFileSync(path.join(root, "user-docs", f), "utf8").replace(/\s+/g, " ");

// ── What's on: one place that answers it ───────────────────────────────────
//
// Run for real. whatsOn() is a method on the Durable Object, so it is lifted
// out and given a stub `get` — the logic being checked is which entries count
// as on, which one names the service, and when the last of them ends.
{
  const src = worker.slice(worker.indexOf("  async whatsOn("));
  const body = src.slice(src.indexOf("{") + 1, src.indexOf("\n  }\n"));
  const AHEAD = 12 * 3600_000;
  const whatsOn = new Function("ROTA_AHEAD_MS", `return async function (now) { ${body} };`)(AHEAD);

  const t = (h, m = 0) => Date.UTC(2026, 10, 15, h, m);
  const entries = [
    { entry_id: "a", label: "Choir practice", start_time: new Date(t(9, 45)).toISOString(), end_time: new Date(t(10, 15)).toISOString() },
    { entry_id: "b", label: "Morning service", start_time: new Date(t(10)).toISOString(), end_time: new Date(t(11, 30)).toISOString() },
    { entry_id: "c", label: "Evening service", start_time: new Date(t(18)).toISOString(), end_time: new Date(t(19, 30)).toISOString() },
    { entry_id: "bad", label: "Nonsense", start_time: "not a time", end_time: "nor this" },
    { entry_id: "back", label: "Backwards", start_time: new Date(t(14)).toISOString(), end_time: new Date(t(13)).toISOString() },
  ];
  const hub = { get: async () => entries };

  const at10 = await whatsOn.call(hub, t(10, 5));
  ok("at five past ten, both the practice and the service are on", at10.on.length === 2);
  ok("and it is called after the one that started first — the practice",
     at10.now.label === "Choir practice", at10.now.label);
  ok("but it runs until the last of them finishes", at10.until === t(11, 30));
  ok("with the evening service named as next", at10.next?.label === "Evening service");

  const at11 = await whatsOn.call(hub, t(11));
  ok("once the practice is over, only the service is on", at11.on.length === 1 && at11.now.label === "Morning service");

  const at12 = await whatsOn.call(hub, t(12));
  ok("at midday nothing is on", at12.on.length === 0 && at12.now === null);
  ok("and the evening service is still what's next", at12.next?.label === "Evening service");

  const at20 = await whatsOn.call(hub, t(20));
  ok("after the last entry, nothing is on and nothing is next", at20.now === null && at20.next === null);

  // Entries Kyro can't read are left out rather than guessed at, and a broken
  // one must never take the rest down with it.
  ok("an unreadable time is ignored", !at10.on.some((e) => e.entry_id === "bad"));
  ok("and so is an entry that ends before it starts",
     !(await whatsOn.call(hub, t(13, 30))).on.some((e) => e.entry_id === "back"));

  // A rota that fails to load must not stop the service timer.
  const broken = { get: async () => { throw new Error("storage"); } };
  const safe = await whatsOn.call(broken, t(10));
  ok("a rota that won't load answers 'nothing on' instead of failing",
     safe.on.length === 0 && safe.now === null && safe.next === null);
  // …and an empty one, and rubbish in place of a list.
  ok("an empty rota is simply nothing on",
     (await whatsOn.call({ get: async () => [] }, t(10))).now === null);
  ok("and so is a rota that isn't a list at all",
     (await whatsOn.call({ get: async () => ({ nope: 1 }) }, t(10))).now === null);
}

// ── The service timer reads it ─────────────────────────────────────────────
{
  ok("the timer asks what is on", /const plan = await this\.whatsOn\(now\);/.test(worker));
  ok("on the rota, one person starts it straight away",
     /const enough = onRota \? 1 : SERVICE_START_PEOPLE;/.test(worker)
     && /const forLong = onRota \? 0 : SERVICE_START_MS;/.test(worker));
  ok("and off it, the old rule is untouched",
     /const SERVICE_START_PEOPLE = 5;/.test(worker) && /const SERVICE_START_MS = 2 \* 60_000;/.test(worker));
  ok("the session is named after the rota entry",
     /name: onRota \? plan\.now\.label : serviceName\(began\),/.test(worker));
  ok("and starts when the rota said, not when somebody wandered into shot",
     /Math\.min\(st\.busy_since, Math\.max\(Date\.parse\(plan\.now\.start_time\), now - 3600_000\)\)/.test(worker));
  ok("it remembers which entry it came from", /rota_entry: plan\.now\.entry_id, from_rota: true/.test(worker));
  ok("it finishes after the rota says it is over",
     /} else if \(live\.from_rota && !onRota\) \{/.test(worker)
     && /else if \(now - over >= ROTA_OVERRUN_MS\) \{/.test(worker));
  ok("with room for an overrun", /const ROTA_OVERRUN_MS = 20 \* 60_000;/.test(worker));
  ok("and an empty hall still ends it sooner, as it always did",
     /if \(st\.quiet_since && now - st\.quiet_since >= SERVICE_END_MS\) \{/.test(worker));
  ok("coming back on the rota cancels the countdown",
     /} else if \(live\.from_rota\) \{[\s\S]{0,200}this\.ctx\.storage\.delete\("rota_over_since"\)/.test(worker));
  ok("and finishing a service tidies it away wherever it came from",
     /await this\.ctx\.storage\.delete\("register"\);\s*\n\s*await this\.ctx\.storage\.delete\("rota_over_since"\);/.test(worker));
}

// ── And it is shown where the figures are ──────────────────────────────────
{
  ok("the live figures carry what's on", /whats_on: plan,/.test(worker));
  ok("and the service being recorded, by name",
     /service_now: serviceNow\s*\n?\s*\? \{ id: serviceNow\.id, name: serviceNow\.name/.test(worker));
  ok("the attendance page shows them together",
     /<WhatsOn plan=\{venueTotal\?\.whats_on \?\? null\} recording=\{venueTotal\?\.service_now\?\.name \?\? null\} \/>/.test(attendance));
  ok("the panel says what Kyro is recording it as", /Kyro is recording this as/.test(panel));
  ok("and says so plainly when it is recording nothing",
     /Nothing is being recorded yet/.test(panel));
  ok("it shows nothing at all when there is no rota",
     /if \(!now && !next\) return null;/.test(panel));
}

// ── The page stops claiming what it never did ──────────────────────────────
{
  ok("the altar-call claim is gone", !/altar call/i.test(rota));
  ok("and 'will use these times immediately' with it", !/use these times immediately/.test(rota));
  // The four-bullet "What Kyro does with this" banner is gone from the page
  // — "and this too on rotas section, not needed". It was written to replace
  // a FALSE claim, and the fix for a false claim is a true one; but once the
  // page works, a list of what it does is a wall between somebody and the
  // thing they came to use. It lives on the help page, which has room to do
  // it properly, and that is where it is checked.
  ok("the banner is off the page", !/What Kyro does with this/.test(rota));
  ok("but what it does is written down where there is room",
     /It names the session after the rota entry\./.test(docs("pages/rota.md")));
  ok("and what it does NOT do, just as plainly",
     /Kyro counts people; it doesn't know who anybody is/.test(docs("pages/rota.md")));
}

// ── Saving actually saves, or says why not ─────────────────────────────────
//
// The Save button did nothing — no entry, no error, nothing — whenever there
// was no camera, which on the live site it does not need. A button that does
// nothing silently is the worst kind there is.
{
  ok("saving no longer stops dead when there is no camera",
     /async function confirm\(\) \{\s*\n\s*if \(!parsed\) return;/.test(rota));
  ok("the old per-camera server still says what it needs",
     /Kyro has no camera to attach this to yet/.test(rota));
  ok("an entry with no name is refused with a reason", /Give each entry a name/.test(rota));
  ok("and entries Kyro silently dropped are reported, not called a clean save",
     /Kyro couldn't read those times/.test(rota) && /const added = Array\.isArray\(res\?\.added\) \? res\.added\.length : 0;/.test(rota));
  ok("the rota loads without a camera on the live site",
     /if \(!activeCamId && !edge\) return;/.test(rota));
  ok("and times can be entered before any camera exists",
     /No camera rooms yet — times still work/.test(rota));
}

// ── Integrations says what state it is in ──────────────────────────────────
//
// It was working. It was waiting for a web address that nobody had, and said
// so nowhere — which reads as broken, and reading as broken is a kind of
// broken.
{
  // One line, not a block — "and this too from integration section". The
  // three-bullet guide to getting an address out of Zapier, Slack or a
  // reporting portal is on the help page, which can do it properly; the page
  // itself only has to say which of three states it is in.
  ok("the page still says when it isn't set up", /Not set up yet\./.test(integrations));
  ok("it says when a send failed, and what to press",
     /Last send failed/.test(integrations) && /Send a test/.test(integrations));
  ok("and when it is working, where things go and when",
     /Set up and ready\./.test(integrations) && /Sending automatically on/.test(integrations));
  // The URL box still shows a Zapier address as its placeholder, which is
  // one word of help in the right place. What is gone is the guide ABOVE the
  // form explaining how to get one out of three different services.
  ok("in one line rather than a wall",
     !/Where that address comes from/.test(integrations)
     && !/Incoming Webhook/.test(integrations)
     && !/Create Spreadsheet Row/.test(integrations));
  ok("with the how-to kept where there is room for it",
     /hooks\.zapier\.com/.test(docs("pages/integrations.md"))
     && /Incoming Webhook/.test(docs("pages/integrations.md")));
  ok("and nobody left thinking their figures depend on it",
     /All your figures are in \[Analytics\]\(\/pages\/analytics\) either way/.test(docs("pages/integrations.md")));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The rota tells Kyro what is on.");
process.exit(fails ? 1 : 0);
