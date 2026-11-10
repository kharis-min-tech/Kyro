"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** What is actually on the screen. */
export type Theme = "dark" | "light";
/**
 * What was CHOSEN. "auto" means "whatever this device is set to", which is
 * what Auto means in every other app — including ChatGPT, whose auto follows
 * the system rather than a clock.
 *
 * Which is also the answer to "I think from 4pm it turns to dark mode": a Mac
 * or a phone set to Auto switches at SUNSET, and sunset in London in
 * mid-November is about ten past four. In June it is twenty past nine. The
 * four o'clock is the sun, not a rule — and following the device means Kyro
 * is right in both months without being told where it is.
 */
export type ThemeMode = "auto" | "dark" | "light";

const STORAGE_KEY = "kyro_theme";

interface ThemeContextValue {
  /** What is on the screen now. */
  theme: Theme;
  /** What was chosen: auto, dark or light. */
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** Light → Dark → Auto → Light. */
  toggle: () => void;
  /** What Auto is currently following, for a page that wants to say so. */
  deviceTheme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** What this device is set to, right now. */
function deviceNow(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch { return "dark"; }
}

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light" || saved === "auto") return saved;
  } catch { /* a browser with storage blocked still gets a theme */ }
  // Never chosen: follow the device, which is what somebody who has never
  // thought about it almost certainly wants.
  return "auto";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [deviceTheme, setDeviceTheme] = useState<Theme>("dark");

  // Read what was chosen, and what the device says, after mounting — this
  // page is also built ahead of time, where there is no browser.
  useEffect(() => {
    setModeState(readMode());
    setDeviceTheme(deviceNow());
  }, []);

  /**
   * Follow the device while it changes.
   *
   * This is the half that makes Auto worth having: the Mac flips at sunset
   * and Kyro flips with it, on a page that has been open since the morning.
   * Without the listener, Auto would only be read when the page loaded —
   * which is "beats refreshing" exactly backwards.
   */
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(prefers-color-scheme: light)"); } catch { return; }
    const onChange = () => setDeviceTheme(mq.matches ? "light" : "dark");
    onChange();
    // Safari before 14 has only the deprecated addListener.
    if (mq.addEventListener) { mq.addEventListener("change", onChange); return () => mq.removeEventListener("change", onChange); }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const theme: Theme = mode === "auto" ? deviceTheme : mode;

  // Put it on <html>, and remember the CHOICE — not the result. Remembering
  // "dark" instead of "auto" is how an auto setting quietly stops being auto
  // the first time the sun goes down.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* fine without it */ }
  }, [theme, mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const toggle = useCallback(
    () => setModeState((m) => (m === "light" ? "dark" : m === "dark" ? "auto" : "light")),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode, setMode, toggle, deviceTheme }),
    [theme, mode, setMode, toggle, deviceTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // For anything rendering outside the provider (server-only rendering).
    return { theme: "dark", mode: "auto", setMode: () => {}, toggle: () => {}, deviceTheme: "dark" };
  }
  return ctx;
}

/** "Auto", "Dark" or "Light", for a button that has to say what it is on. */
export const MODE_LABEL: Record<ThemeMode, string> = { auto: "Auto", dark: "Dark", light: "Light" };

/**
 * Inline script that runs BEFORE React hydrates, setting the theme on <html>
 * so the page never flashes the wrong one on first paint.
 *
 * It has to resolve "auto" itself: by the time React could do it, the wrong
 * colour has already been painted. Injected verbatim by app/layout.tsx.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var m = localStorage.getItem("${STORAGE_KEY}");
    if (m !== "dark" && m !== "light") m = "auto";
    var t = m === "auto"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : m;
    var r = document.documentElement;
    r.setAttribute("data-theme", t);
    r.classList.add(t);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.classList.add("dark");
  }
})();
`;
