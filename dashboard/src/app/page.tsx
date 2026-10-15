"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Landing } from "@/components/landing/Landing";

/**
 * kyro.kharischurch.com — signed-in people go straight to their dashboard;
 * everyone else sees the welcome page (what Kyro is, Demo vs Live), with
 * the sign-in screen one tap away.
 */
export default function RootPage() {
  const { canViewAttendance, isAuthenticated } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<"checking" | "welcome">("checking");

  useEffect(() => {
    // Mode has to be an explicit choice made on the sign-in screen (see /login).
    const hasMode  = localStorage.getItem("kyro_mode");
    const hasToken = localStorage.getItem("kyro_token");
    if (hasMode && hasToken && isAuthenticated) {
      router.replace(canViewAttendance ? "/attendance" : "/seating");
      return;
    }
    setView("welcome");
  }, [isAuthenticated, canViewAttendance, router]);

  if (view === "checking") return <div style={{ minHeight: "100vh", background: "#0a0a0b" }} />;
  return <Landing />;
}
