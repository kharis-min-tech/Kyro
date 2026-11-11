"use client";

/**
 * "Kyro has been updated — reload to get it."
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A deploy publishes a new set of page files, every one named after its
 * contents. The old set is kept alongside it on purpose, for three days, so a
 * tab that was already open never breaks halfway through a service (see
 * keep_old_chunks in scripts/deploy-and-verify.sh). That is the right trade,
 * and it has exactly one cost: a page left open goes on running the old code
 * for ever, in silence.
 *
 * That cost was paid in full in one evening. Four deploys were made during a
 * service while the page doing the counting ran the code from before any of
 * them. Every fix looked like it had failed — "still not 114", "this is not
 * working", "i dont understand" — and the honest answer each time was that
 * the fix had never reached the screen. Nothing on the page said so, because
 * nothing on the page knew.
 *
 * So each build is given a name. The name is compiled into the pages and
 * published beside them at /build.json. A page that finds a different name
 * there is out of date, and says so, with the button that fixes it.
 *
 * Deliberately a quiet strip rather than a forced reload: somebody counting a
 * service decides when their screen restarts, not Kyro.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** The name of the build these files came from. Empty in development, and
 *  when it is empty this component does nothing at all. */
const MINE = process.env.NEXT_PUBLIC_KYRO_BUILD ?? "";

/** How often to look. Rare on purpose: this is a courtesy, not a poll that
 *  costs anybody anything, and a service lasts hours. */
const LOOK_EVERY_MS = 2 * 60_000;

export function NewVersion() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!MINE) return;                       // development, or an older build
    let stop = false;
    const look = async () => {
      try {
        // no-store, because the whole question is "what is on the server NOW".
        const res = await fetch("/build.json", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        const theirs = typeof body?.build === "string" ? body.build : "";
        if (!stop && theirs && theirs !== MINE) setStale(true);
      } catch { /* offline, or the file isn't there: say nothing */ }
    };
    look();
    const id = setInterval(look, LOOK_EVERY_MS);
    // And whenever somebody comes back to the tab, which is when they are
    // most likely to be about to trust what it says.
    const onShow = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed left-0 right-0 z-50 flex justify-center px-4"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-lg max-w-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--gold-border, rgba(245,158,11,0.45))" }}>
        <RefreshCw size={15} className="shrink-0" style={{ color: "var(--gold, #b7791f)" }} />
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text-primary)" }}>Kyro has been updated.</strong> This page is still running
          the older version, so anything just fixed will not show here until it is reloaded.
        </p>
        <button type="button" onClick={() => window.location.reload()}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ background: "#4f46e5" }}>
          Reload
        </button>
      </div>
    </div>
  );
}
