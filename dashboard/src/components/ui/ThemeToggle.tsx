"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { MODE_LABEL, useTheme, type ThemeMode } from "@/lib/theme";

const ICON = { auto: Monitor, light: Sun, dark: Moon } as const;

/**
 * Light · Dark · Auto.
 *
 * Auto follows the device, which is what Auto means everywhere else —
 * including ChatGPT, whose auto follows the system rather than a clock. A
 * Mac or a phone set to Auto switches at SUNSET, so Kyro goes dark at about
 * ten past four in November and twenty past nine in June without being told
 * where it is.
 *
 * The choice is remembered, not the result. Storing "dark" the first time
 * the sun goes down is how an auto setting quietly stops being automatic.
 */
export function ThemeToggle({ compact = false, className = "" }: {
  /** Icon-only, for a tight space. Still all three, one tap each. */
  compact?: boolean;
  className?: string;
}) {
  const { mode, setMode, theme, deviceTheme } = useTheme();
  const modes: ThemeMode[] = ["light", "dark", "auto"];

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg p-0.5 ${className}`}
      style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}
      role="group" aria-label="Appearance">
      {modes.map((m) => {
        const Icon = ICON[m];
        const on = mode === m;
        return (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={on}
            aria-label={MODE_LABEL[m]}
            title={m === "auto"
              ? `Auto — follows this device, which is ${deviceTheme === "dark" ? "dark" : "light"} right now`
              : MODE_LABEL[m]}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
            style={on
              ? { background: "var(--bg-card)", color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }
              : { background: "transparent", color: "var(--text-muted)" }}>
            <Icon size={14} />
            {!compact && MODE_LABEL[m]}
          </button>
        );
      })}
      {/* Nothing is said when it is behaving: a settings control that
          explains itself on every screen is the writing she asked me to
          take out. Only the one case somebody would otherwise report as a
          fault — Auto chosen, and the device never changing. */}
      <span className="sr-only">{theme === "dark" ? "Dark" : "Light"} on screen</span>
    </div>
  );
}

/**
 * The one line worth printing, and only where somebody is looking at
 * settings: Auto is on, and it will not do anything, because the device
 * itself is not set to change.
 *
 * It cannot be known for certain — a browser reports light or dark, never
 * "scheduled" — so this says where to look rather than claiming a fault.
 */
export function ThemeAutoNote() {
  const { mode } = useTheme();
  if (mode !== "auto") return null;
  return (
    <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
      Auto follows this device. For it to change at sunset, set your device to switch too —
      on a Mac: <strong>System Settings → Appearance → Auto</strong>; on iPhone or Android:{" "}
      <strong>Display → Automatic</strong>.
    </p>
  );
}
