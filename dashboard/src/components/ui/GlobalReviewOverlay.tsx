"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useReviewContext } from "@/lib/ReviewContext";
import { ReviewPanel } from "@/components/ui/ReviewPanel";

/**
 * Mounted once in the root layout.
 *
 * We hide the whole review surface — including the floating "archived"
 * notifications bell at the top right — until the user is actually signed
 * in. Otherwise the bell shows on the login page the first time a user
 * visits (localStorage might carry archived items from a previous session
 * on this device, which looks like a stray notification icon pre-login).
 *
 * ReviewPanel manages its own visibility beyond that (one card at a time,
 * draggable backlog panel, etc.).
 */
export function GlobalReviewOverlay() {
  const pathname = usePathname();
  const { reviews, dismissReview, activeCameraId } = useReviewContext();
  const [authed, setAuthed] = useState(false);

  // Watch for sign-in / sign-out while the overlay is mounted so the
  // panel appears the moment the user lands on an authenticated page,
  // and disappears when they log out.
  useEffect(() => {
    function check() {
      try {
        const t = localStorage.getItem("kyro_token");
        setAuthed(Boolean(t));
      } catch { setAuthed(false); }
    }
    check();
    const t = setInterval(check, 1000);
    window.addEventListener("storage", check);
    return () => { clearInterval(t); window.removeEventListener("storage", check); };
  }, []);

  // Never show on the login page, even if a stale token is present.
  if (pathname === "/login" || pathname?.startsWith("/login/")) return null;
  if (!authed) return null;

  return (
    <ReviewPanel
      reviews={reviews}
      cameraId={activeCameraId}
      onDismiss={dismissReview}
    />
  );
}
