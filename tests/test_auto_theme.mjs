/**
 * Light · Dark · Auto — and Auto stays Auto.
 *
 * "can kyro have an auto light and dark mode like normal systems, if it gets
 * to a evening time it turns to dark mode like chat gpt i think from 4 pm it
 * turns to dark mode, recheck ... so the person can have an option to press
 * auto and it stays auto and beats refreshing etc so even when you log back
 * in it stays like that forever"
 *
 * ── The recheck ────────────────────────────────────────────────────────────
 *
 * Four o'clock is not a rule anywhere. ChatGPT's auto follows the system, and
 * a Mac or a phone set to Auto switches at SUNSET — which in London in
 * mid-November is about ten past four, and in June is about twenty past nine.
 * The four o'clock she noticed is the sun, not a setting.
 *
 * So Auto follows the device, which is both what Auto means everywhere else
 * and what gives her exactly what she described, in November AND in June,
 * without Kyro having to be told where the church is or asking for anybody's
 * location.
 *
 * ── What this guards ───────────────────────────────────────────────────────
 *
 *   - the CHOICE is remembered, not the result. Storing "dark" the first
 *     time the sun goes down is how an auto setting quietly stops being
 *     automatic — and it is the one way this feature can fail silently;
 *   - it follows the device WHILE it changes, so a page open since the
 *     morning turns dark at sunset without being reloaded ("beats
 *     refreshing");
 *   - nothing resets it on sign-out, so logging back in finds it as it was;
 *   - and the first paint is already right, so there is no flash of the
 *     wrong colour.
 *
 *   node tests/test_auto_theme.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const theme = fs.readFileSync(path.join(root, "dashboard/src/lib/theme.tsx"), "utf8");
const toggle = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ThemeToggle.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "dashboard/src/components/layout/Sidebar.tsx"), "utf8");
const login = fs.readFileSync(path.join(root, "dashboard/src/app/login/page.tsx"), "utf8");
const useAuth = fs.readFileSync(path.join(root, "dashboard/src/hooks/useAuth.ts"), "utf8");

// ── Three choices, and Auto is one of them ─────────────────────────────────
{
  ok("there are three", /export type ThemeMode = "auto" \| "dark" \| "light";/.test(theme));
  ok("and what is on the screen is worked out from the choice",
     /const theme: Theme = mode === "auto" \? deviceTheme : mode;/.test(theme));
  ok("auto is the default for somebody who has never chosen", /return "auto";/.test(theme));
}

// ── The one way it could fail silently ─────────────────────────────────────
//
// Writing the RESULT instead of the CHOICE. Auto resolves to "dark" at
// sunset; store that and the next morning it is stuck on dark for ever, and
// nothing on screen says why.
{
  ok("the CHOICE is what gets remembered",
     /localStorage\.setItem\(STORAGE_KEY, mode\)/.test(theme)
     && !/localStorage\.setItem\(STORAGE_KEY, theme\)/.test(theme));
  ok("and it is read back as a choice", /if \(saved === "dark" \|\| saved === "light" \|\| saved === "auto"\) return saved;/.test(theme));
  ok("the note explaining why is kept next to it",
     /Remembering\s*\n?\s*\/\/ "dark" instead of "auto" is how an auto setting quietly stops being auto/.test(theme)
     || /is how an auto setting quietly stops being auto/.test(theme.replace(/\s+/g, " ")));
}

// ── It changes without a reload ────────────────────────────────────────────
{
  ok("the device's setting is watched, not read once",
     /mq\.addEventListener\("change", onChange\)/.test(theme));
  ok("with the old Safari way as a fallback", /mq\.addListener\(onChange\)/.test(theme));
  ok("and the listener is taken off again", /mq\.removeEventListener\("change", onChange\)/.test(theme));
}

// ── Signing out must not undo it ───────────────────────────────────────────
{
  ok("nothing clears the theme on sign-out", !/removeItem\("kyro_theme"\)/.test(useAuth));
  // …nor anywhere else. A tidy-up that sweeps localStorage would take it.
  const all = ["dashboard/src/hooks/useAuth.ts", "dashboard/src/lib/edgeAuth.ts"]
    .map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  ok("and nothing clears the whole of storage either", !/localStorage\.clear\(\)/.test(all));
}

// ── No flash of the wrong colour ───────────────────────────────────────────
{
  ok("the first paint resolves auto itself, before React",
     /var t = m === "auto"\s*\n?\s*\? \(window\.matchMedia/.test(theme));
  ok("and falls back to dark if anything throws",
     /document\.documentElement\.setAttribute\("data-theme", "dark"\);/.test(theme));
}

// ── The control ────────────────────────────────────────────────────────────
{
  ok("all three are on screen, one tap each", /const modes: ThemeMode\[\] = \["light", "dark", "auto"\];/.test(toggle));
  ok("the one in use is shown as pressed", /aria-pressed=\{on\}/.test(toggle));
  ok("Auto says what it is following right now",
     /Auto — follows this device, which is \$\{deviceTheme === "dark" \? "dark" : "light"\} right now/.test(toggle));
  ok("it is in the sidebar", /<ThemeToggle className="w-full justify-between" \/>/.test(sidebar));
  ok("and on the sign-in page, so the choice is made before signing in",
     /\[\["light", Sun\], \["dark", Moon\], \["auto", Monitor\]\]/.test(login));

  // The only line of prose, and only for the case somebody would report as a
  // fault: Auto on, device not set to change, so nothing ever happens.
  ok("there is one line for the case where Auto appears to do nothing",
     /export function ThemeAutoNote\(\)/.test(toggle)
     && /System Settings → Appearance → Auto/.test(toggle));
  ok("and it is not printed when Auto isn't even on", /if \(mode !== "auto"\) return null;/.test(toggle));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Auto follows the device, and stays Auto.");
process.exit(fails ? 1 : 0);
