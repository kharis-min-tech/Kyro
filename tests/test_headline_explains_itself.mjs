/**
 * "Showing me 2-3 people when it's only me" has to be answerable from the
 * screen.
 *
 * A headline is only checkable if it says which rule produced it and what
 * went into it. Without that, the only thing anybody can do with a figure
 * they believe is wrong is say that it is wrong — which is where this
 * started.
 *
 * The three things that make one person read as two or three, none of which
 * the page said:
 *
 *   1. NO SERVICE, SO NO REGISTER. The register of people is what knows that
 *      the person on camera 1 and the person on camera 2 are the same person,
 *      and it only exists while a service is being recorded. Without one,
 *      every camera's count is simply added to the next — and face matching
 *      does nothing however the switch is set, because face codes belong to a
 *      service. The card said "On". The headline said 2.
 *
 *   2. TWO ROOMS. Cameras that share a room name are views of ONE room and
 *      the room takes the fullest view. Cameras with different room names are
 *      different rooms and are added up — right for a balcony and a main
 *      floor, wrong for two cameras on one desk. A camera that adds itself is
 *      given a room named after itself, so two cameras in one computer start
 *      out added together. The fix is a room name, which Kyro cannot choose.
 *
 *   3. The page was also still calling the second figure "everyone counted
 *      in, less everyone counted out, by the room cameras" — which stopped
 *      being true when room cameras stopped being asked a question they
 *      cannot answer.
 *
 *   node tests/test_headline_explains_itself.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const flat = page.replace(/\s+/g, " ");

// ── The figure says what went into it — behind one word ───────────────────
//
// It used to say it in four sentences of prose, printed under the figure on
// every load. "too much writing, i dont want it, dosent look neat or nice",
// which is fair: an explanation nobody asked for is not help, it is a wall to
// read past. It still has to be ANSWERABLE — that is what it was written for
// — so it costs one word until somebody wants it.
{
  ok("the figure is one short line, not a paragraph",
     /<summary style=\{\{ fontSize: 12/.test(page)
     && /in shot now · <span style=\{\{ textDecoration: "underline" \}\}>where this number comes from<\/span>/.test(page));
  ok("and the detail is behind it", /<details style=\{\{ marginTop: 6 \}\}>/.test(page));
  ok("which still starts with what the cameras can see",
     /The cameras can see <strong>\{seenNow\.toLocaleString\(\)\}<\/strong>/.test(page));
  ok("and still says when some of those are one person twice",
     /of them on two cameras at once and counted once/.test(flat));
  ok("the duplicate count comes from the website, not a guess",
     /seen_on_two_cameras\?: number/.test(page) && /seen_on_two_cameras: twice,/.test(worker));
}

// ── Each possible second figure is still named for what it is ─────────────
{
  ok("a doorway's figure is called the doorway's",
     /The entrance has counted <strong>\{countedNet\.toLocaleString\(\)\}<\/strong> in, less those out\./.test(flat));
  ok("the register's is called the register's",
     /The register has <strong>\{countedNet\.toLocaleString\(\)\}<\/strong> seen in the last five minutes\./.test(flat));
  ok("and it no longer claims the room cameras counted people in and out",
     !/by the room cameras/.test(page));
  ok("the page is told which one it was",
     /counted_net_from_register\?: boolean/.test(page)
     && /counted_net_from_register: doorNet === null && registerNow > 0,/.test(worker));
}

// ── The answer she needed: no service, no register ─────────────────────────
{
  ok("with no service running, it says why there is no register",
     /No service is being recorded, so there is no register yet/.test(flat));
  ok("and what that means for the figure",
     /each camera&apos;s count is simply added to the next/.test(flat));
  // The claim has to be true: the register really is service-only, and faces
  // really do need a live service.
  ok("the register genuinely only runs during a service",
     /\/\/ Nothing is recorded outside a service[\s\S]{0,200}if \(!service\) return;/.test(worker));
  ok("and faces genuinely need one too",
     /const faceOn = \(await this\.privacy\(\)\)\.face_matching && !!serviceNow;/.test(worker));
}

// ── Two rooms are added, and the page says so ──────────────────────────────
{
  ok("the page notices more than one room counting",
     /const countingRooms = edge && isToday/.test(page)
     && /const addedRooms = countingRooms\.length > 1 \? countingRooms : \[\];/.test(page));
  ok("it names them", /\{addedRooms\.slice\(0, 3\)\.join\(" and "\)\}/.test(page));
  ok("says their counts are added together", /their counts are <strong>added together<\/strong>/.test(flat));
  ok("and gives the one thing that fixes it",
     /give them the <strong>same room name<\/strong>/.test(flat));
  // Only when Kyro has NOT already worked out they are the same person —
  // otherwise it is a warning about something already handled.
  ok("and only when nothing has been de-duplicated already",
     /addedRooms\.length > 1 && seenTwice === 0 && \(/.test(page));
  // The claim has to be true: same room name really does take the fullest view.
  ok("cameras sharing a room name really are one room",
     /r\.current = take\(r\.current, z\.current\)/.test(worker) || /Cameras that share a zone name are views of ONE room/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The figure says how it was reached.");
process.exit(fails ? 1 : 0);
