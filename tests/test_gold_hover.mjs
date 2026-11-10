/**
 * Everything you can point at warms to gold.
 *
 * "when i hover over every section on kyro, it should turn gold like a light
 * fade gold"
 *
 * One gold, the same one as the K in the wordmark, so the product has a
 * single gold rather than two that nearly match. Soft enough to read as a
 * hint rather than a selection, and it FADES — a colour that snaps reads as a
 * glitch, a colour that eases in reads as a response.
 *
 * The one thing this must not do is paint over meaning. A button that is
 * indigo because it is the main action, or red because it deletes something,
 * keeps its colour: making "Yes, delete it for good" gold on hover would turn
 * a warning into a link. So only the NEUTRAL hovers change — the greys and
 * whites that said "this moves" and nothing more.
 *
 *   node tests/test_gold_hover.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(root, "dashboard/src/app/globals.css"), "utf8");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ── One gold, in both themes ───────────────────────────────────────────────
{
  ok("there is a gold, and a soft wash of it", /--gold:\s+#f8b537;/.test(css) && /--gold-soft:\s+rgba\(248, 181, 55, 0\.12\);/.test(css));
  ok("and a darker one for white backgrounds, which would wash it out",
     /--gold:\s+#b7791f;/.test(css) && /--gold-text:\s+#8a5a12;/.test(css));
  ok("it is the wordmark's gold, not a second one",
     /--brand-gold: #f8b537;/.test(css) && /--gold:\s+#f8b537;/.test(css));
}

// ── It fades ───────────────────────────────────────────────────────────────
{
  ok("anything hoverable eases rather than snaps",
     /transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;/.test(css));
  ok("and that covers links, buttons, rows and the rest",
     /a, button, summary, \[role="button"\], \[role="tab"\], \[role="menuitem"\],\s*\n\s*tr, li, label\[for\], select, \.kyro-hover \{/.test(css));
}

// ── The neutral hovers turn gold ───────────────────────────────────────────
{
  ok("white-on-hover text is gold now", /\.hover\\:text-white:hover,/.test(css));
  ok("the grey ones too", /\.hover\\:text-gray-300:hover,/.test(css) && /\.hover\\:text-gray-400:hover,/.test(css));
  ok("and the grey hover backgrounds", /\.hover\\:bg-white\\\/5:hover,/.test(css)
     && /background-color: var\(--gold-soft\) !important;/.test(css));
  ok("with !important, since Tailwind's own rule comes later in the file",
     /color: var\(--gold-text\) !important;/.test(css));
}

// ── Meaning is not painted over ────────────────────────────────────────────
//
// The whole risk of a global hover colour.
{
  ok("the indigo main-action hover is untouched", !/hover\\:bg-indigo-500:hover/.test(css));
  ok("and every red, destructive one",
     !/hover\\:bg-red-600:hover/.test(css) && !/hover\\:text-red-400:hover/.test(css));
  ok("which is written down where somebody might undo it",
     /painting "Yes, delete it for good" gold\s*\n?\s*would turn a warning into a link/.test(css)
     || /would turn a warning into a link/.test(css.replace(/\s+/g, " ")));
  // And they are still in use, so the exclusion means something.
  const sources = ["dashboard/src/components/ui/AutoServices.tsx", "dashboard/src/components/ui/SystemHealth.tsx"]
    .map(read).join("\n");
  ok("destructive buttons really do still carry their own red", /#b91c1c/.test(sources));
}

// ── The hand-written hovers, swapped ───────────────────────────────────────
{
  ok("the sidebar's nav no longer goes white", !/style\.color = "#fff"/.test(read("dashboard/src/components/layout/Sidebar.tsx")));
  ok("nor the sign-in page's", !/style\.color = "#fff"/.test(read("dashboard/src/app/login/page.tsx")));
  ok("both go gold", /style\.color = "var\(--gold-text\)"/.test(read("dashboard/src/components/layout/Sidebar.tsx"))
     && /style\.color = "var\(--gold-text\)"/.test(read("dashboard/src/app/login/page.tsx")));
  ok("the date picker's cells warm instead of greying",
     /const HOVER  = "var\(--gold-soft\)";/.test(read("dashboard/src/components/ui/DatePicker.tsx")));
  ok("and so do the camera tiles' expand buttons",
     !/rgba\(79,70,229,0\.7\)/.test(read("dashboard/src/app/live-cameras/page.tsx")));
}

// ── Keyboard gets what the mouse gets ──────────────────────────────────────
{
  ok("tabbing through shows the same gold",
     /a:focus-visible, button:focus-visible, summary:focus-visible,/.test(css)
     && /outline: 2px solid var\(--gold-border\);/.test(css));
}

// ── A gold block behind a word in a sentence is a highlighter ──────────────
{
  ok("a link in prose warms its colour, not its background",
     /a:not\(\[class\*="bg-"\]\):not\(\[style\*="background"\]\):hover \{ color: var\(--gold-text\); \}/.test(css));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. It warms, and it fades.");
process.exit(fails ? 1 : 0);
