"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function RootPage() {
  const { canViewAttendance, isAuthenticated } = useAuth();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (!hydrated) return;

    // Mode has to be an explicit user choice — on a static Cloudflare build
    // there is no backend, so previously `inDemoMode()` returned true for
    // every fresh visitor and this page bypassed the mode chooser entirely,
    // dropping first-time users straight into an attendance page they never
    // asked for. If the user has not picked a mode and signed in in this
    // browser, send them to the landing screen so they can.
    const hasMode  = typeof window !== "undefined" && localStorage.getItem("kyro_mode");
    const hasToken = typeof window !== "undefined" && localStorage.getItem("kyro_token");

    if (!hasMode || !hasToken || !isAuthenticated) {
      router.replace("/login");
      return;
    }

    router.replace(canViewAttendance ? "/attendance" : "/seating");
  }, [hydrated, isAuthenticated, canViewAttendance, router]);

  return null;
}
