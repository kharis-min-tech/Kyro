"use client";

/**
 * What the church's own rota says is happening — now, and next.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The Rota page said "Kyro will use these times immediately" and then did
 * nothing with them. A rota entry reached the camera computers and held a few
 * seats; no figure, no session, no page ever mentioned it again. Reported as:
 * "i tried to put a rota in for the kyro system to know the times etc whats
 * going on but it wasnt working nor was the system aware of it and was
 * working together".
 *
 * A rota that works has to be VISIBLE where the figures are. "Is Kyro aware
 * of my rota?" is answered by seeing the rota and the count on one screen
 * agreeing with each other — not by opening a second page to check, and
 * certainly not by a sentence on the page where you typed it in.
 *
 * It says nothing at all when the rota is empty. An empty panel explaining
 * that there is nothing to show is still a panel.
 */

import { CalendarDays } from "lucide-react";
import type { WhatsOn as Plan } from "@/types";

const BORDER = "var(--border-subtle)";

const at = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};
const onDay = (iso: string) => {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay ? "" : ` ${d.toLocaleDateString([], { weekday: "long" })}`;
  } catch { return ""; }
};

export function WhatsOn({ plan, recording }: {
  plan: Plan | null | undefined;
  /** The name of the service Kyro is recording, if it is recording one. */
  recording?: string | null;
}) {
  if (!plan) return null;
  const now = plan.now ?? null;
  const next = plan.next ?? null;
  if (!now && !next) return null;

  return (
    <div className="rounded-2xl px-5 py-4 flex items-start gap-3"
      style={{ background: "var(--bg-card)", border: `1px solid ${now ? "rgba(34,197,94,0.35)" : BORDER}` }}>
      <CalendarDays size={16} className="shrink-0 mt-0.5" style={{ color: now ? "#22c55e" : "var(--text-faint)" }} />
      <div className="min-w-0 flex-1">
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          On the rota
        </p>
        {now ? (
          <>
            <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
              {now.label} <span className="font-normal" style={{ color: "var(--text-secondary)" }}>· {at(now.start_time)}–{at(now.end_time)}</span>
            </p>
            {/* The whole point: the rota and the recording, side by side, so
                "it isn't aware of it" can be seen to be false — or seen to be
                true, which is just as important. */}
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {recording
                ? <>Kyro is recording this as <strong>{recording}</strong>. It started counting when the first person was seen and will finish shortly after the rota says it ends.</>
                : <>Nothing is being recorded yet — Kyro starts the moment a camera sees somebody. Check a camera is counting.</>}
            </p>
            {plan.on.length > 1 && (
              <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                Also on: {plan.on.slice(1).map((e) => `${e.label} (${at(e.start_time)}–${at(e.end_time)})`).join(" · ")}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-secondary)" }}>Nothing on right now</p>
        )}
        {next && (
          <p className="text-xs mt-1.5" style={{ color: "var(--text-tertiary)" }}>
            Next: <strong style={{ color: "var(--text-secondary)" }}>{next.label}</strong>
            {onDay(next.start_time)} at {at(next.start_time)}
          </p>
        )}
      </div>
    </div>
  );
}
