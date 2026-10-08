"use client";

import { useEffect, useState } from "react";

/**
 * What people see instead of Next.js's bare "Application error" screen.
 *
 *  • An out-of-date page (the site was updated while it was open, or the
 *    phone restored an old copy) can't load its script files — we just
 *    reload once, quietly, and the new version opens.
 *  • Anything else: report it to the Worker (so it can be fixed) and offer
 *    "Try again" and, as a last resort, "Reset this device" which clears
 *    Kyro's saved data in this browser (theme kept) and goes to sign-in.
 */
const RELOAD_KEY = "kyro_crash_reload_at";

function isStaleBuild(error: Error) {
  const m = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token '<'|expected expression, got '<'/i.test(m);
}

function report(error: Error & { digest?: string }) {
  try {
    const body = JSON.stringify({
      message: String(error?.message ?? error).slice(0, 500),
      stack: String(error?.stack ?? "").slice(0, 2000),
      page: location.pathname,
      mode: localStorage.getItem("kyro_mode") ?? "",
      ua: navigator.userAgent.slice(0, 300),
    });
    navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }));
  } catch { /* best effort */ }
}

export function CrashRecovery({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    report(error);
    if (isStaleBuild(error)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0); } catch {}
      if (Date.now() - last > 30_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch {}
        setReloading(true);
        location.reload();
      }
    }
  }, [error]);

  const resetDevice = () => {
    try {
      const theme = localStorage.getItem("kyro_theme");
      localStorage.clear();
      sessionStorage.clear();
      if (theme) localStorage.setItem("kyro_theme", theme);
    } catch {}
    location.href = "/login/";
  };

  const btn: React.CSSProperties = {
    padding: "10px 18px", borderRadius: 10, border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0d0f1a", color: "#e5e7eb", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <img src="/icon-192.png" alt="" width={56} height={56} style={{ margin: "0 auto 16px", borderRadius: 12 }} />
        {reloading ? (
          <p style={{ fontSize: 17 }}>Kyro was updated — loading the new version…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong on this page</h1>
            <p style={{ fontSize: 15, color: "#9ca3af", margin: "0 0 20px" }}>
              Tap <b>Try again</b>. If it keeps happening, <b>Reset this device</b> clears Kyro&apos;s saved data in this browser and takes you to sign-in. Your church&apos;s data on the server is not affected.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button style={{ ...btn, background: "#6366f1", color: "#fff" }} onClick={() => { reset(); location.reload(); }}>Try again</button>
              <button style={{ ...btn, background: "#1f2937", color: "#e5e7eb" }} onClick={resetDevice}>Reset this device</button>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 20, wordBreak: "break-word" }}>{String(error?.message ?? "").slice(0, 200)}</p>
          </>
        )}
      </div>
    </div>
  );
}
