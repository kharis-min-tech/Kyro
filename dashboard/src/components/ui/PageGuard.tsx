"use client";

/**
 * PageGuard — stops people opening pages they haven't been given by typing
 * the address. The sidebar already hides those pages; this enforces it.
 *
 * In Live mode on the Cloudflare build it also re-checks the account with
 * the server on every app load, so an admin's change to someone's pages (or
 * removing them) applies straight away; a rejected session signs them out.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAllowedPages, pageIdForPath } from "@/lib/access";
import { edgeRefreshSession, edgeToken, edgeTokenPayload, isEdgeLive } from "@/lib/edgeAuth";

function currentIdentity(): { username: string; role: string } | null {
  if (isEdgeLive()) {
    const p = edgeTokenPayload();
    return p ? { username: p.sub, role: p.role } : null;
  }
  const username = localStorage.getItem("kyro_demo_last_user");
  const role = localStorage.getItem("kyro_demo_role");
  if (username && role) return { username, role };
  const t = localStorage.getItem("kyro_token");
  if (t && t.split(".").length === 3) {
    try {
      const b64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const p = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
      if (p.sub && p.role) return { username: p.sub, role: p.role };
    } catch {}
  }
  return null;
}

function signOutToLogin() {
  localStorage.removeItem("kyro_token");
  sessionStorage.removeItem("kyro_active_login");
  sessionStorage.setItem("kyro_signed_out", "1");
  window.location.href = "/login";
}

export function PageGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshed, setRefreshed] = useState(0);

  // Live (Cloudflare): confirm the account is still active and pick up page changes.
  useEffect(() => {
    if (!isEdgeLive() || !edgeToken()) return;
    edgeRefreshSession().then((u) => {
      if (!u) signOutToLogin();
      else setRefreshed((n) => n + 1);
    });
    const onExpired = () => signOutToLogin();
    window.addEventListener("kyro_session_expired", onExpired);
    return () => window.removeEventListener("kyro_session_expired", onExpired);
  }, []);

  useEffect(() => {
    const page = pageIdForPath(pathname ?? "");
    if (!page) return;
    // Live on Cloudflare: a page needs a valid server-issued session.
    if (isEdgeLive() && !edgeToken()) { router.replace("/login"); return; }
    const who = currentIdentity();
    if (!who) return; // the page's own sign-in check handles this
    const allowed = getAllowedPages(who.username, who.role);
    if (!allowed.includes(page)) {
      const fallback = allowed.includes("attendance") ? "attendance" : allowed[0] ?? "seating";
      router.replace(`/${fallback}`);
    }
  }, [pathname, router, refreshed]);

  return null;
}
