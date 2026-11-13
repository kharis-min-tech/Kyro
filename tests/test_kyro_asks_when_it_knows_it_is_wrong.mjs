/**
 * Once Kyro knows the count is impossible, it stops guessing quietly.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "Questions are not asked enough with proof/pictures, you keep assuming
 * things and not say a word, how will you learn."
 *
 * Making somebody new is the decision that puts a wrong number on a church's
 * screen, and it asked about itself only when somebody already on file looked
 * seventy per cent alike. Below that — silence.
 *
 * Which is precisely backwards for the case that actually happened. In a hall
 * of dark coats under a blurred lens the appearance readings are washed out,
 * so nothing scores seventy — and the duplicates that really occurred were
 * exactly the ones nobody was ever asked about. A hundred and seventy nine
 * people in a room of a hundred and fourteen, and not one question.
 *
 * When more different people have been written down than the room holds, Kyro
 * KNOWS at least one entry is wrong. That is not a moment to keep guessing.
 *
 *   node tests/test_kyro_asks_when_it_knows_it_is_wrong.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const person = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35,
          0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45, 2.5, 0.5];
};
/** Strangers arriving one after another, none resembling anybody on file. */
const morning = (crowded, n = 20) => {
  const r = new IdentityRegistry({ zoneOf: () => "Main", createsIdentities: () => true });
  r.crowded = crowded;
  let t = 0;
  for (let who = 1; who <= n; who++) {
    for (let f = 0; f < 5; f++) {
      t += 5000;
      r.observe("room", [{ track: who, look: person(who * 7), face: null }], t);
    }
  }
  return { made: r.size, asks: r.takeAsks() };
};

// ── A normal morning stays as quiet as it ever was ─────────────────────────
{
  const quiet = morning(false);
  ok("nobody is asked about while the count is still possible", quiet.asks.length === 0,
     `${quiet.asks.length} asked`);
  ok("…and people are still counted", quiet.made > 0, `${quiet.made}`);
}

// ── Once it cannot be right, every new person is asked about ───────────────
{
  const full = morning(true);
  ok("every new person is asked about once the room is over its seats",
     full.asks.length >= full.made, `${full.asks.length} asked, ${full.made} made`);
  ok("and each question says why it is being asked",
     full.asks.every((a) => /more people have been counted than this room holds/.test(a.reason ?? "")),
     JSON.stringify(full.asks.map((a) => a.reason).slice(0, 2)));
  /**
   * Each one carries something that can be photographed: the camera and the
   * track it is about. A question without a picture is the thing she was
   * complaining about.
   */
  ok("and names the sighting, so a picture can be taken of it",
     full.asks.every((a) => a.camera && Number.isFinite(a.track)));
  // Two shapes, both answerable from a picture: "is this the same person as
  // that one" when there is somebody to compare against, and "is this a
  // person at all" when there is not — which is the other way a count climbs
  // past a room's walls.
  ok("asking either 'same person?' or 'is this a person?'",
     full.asks.every((a) => a.kind === "person" || a.person !== null));
}

// ── Only ever when the seats are actually known ────────────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("the hub tells the register whether the room is over-full",
     /this\.register\.crowded = seats > 0 && \(this\.register\.size \|\| 0\) >= seats;/.test(worker));
  ok("…and unknown seats mean unknown, not crowded",
     /seats > 0 &&/.test(worker));
  ok("a failure to work it out never accuses anybody",
     /catch \{ this\.register\.crowded = false; \}/.test(worker));
  const id = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  ok("and the register only does this while it is over the seats",
     /if \(this\.crowded && !\(near && near\.look >= LOOK_ASK\)\) \{/.test(id));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. When Kyro knows it is wrong, it asks.");
process.exit(fails ? 1 : 0);
