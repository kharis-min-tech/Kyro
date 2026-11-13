"use client";

/**
 * GlobalReviewContext
 *
 * Holds pending AI review questions across all cameras.
 * Any page can see and dismiss questions — not just the one that opened the stream.
 *
 * Also runs a dedicated pipeline stream for "demo-main" so questions
 * fire even when no page-level component has opened that stream.
 */

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import type { ReviewRequest } from "@/types";
import { DEMO_MODE, getNextDemoReviews } from "@/lib/demo";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
import { noBackend as inDemoMode } from "@/lib/mode";
import { useAuth } from "@/hooks/useAuth";
import { edgeFetch, isEdgeLive } from "@/lib/edgeAuth";

interface ReviewContextValue {
  reviews: ReviewRequest[];
  addReview: (r: ReviewRequest) => void;
  dismissReview: (reviewId: string) => void;
  activeCameraId: string;
  setActiveCameraId: (id: string) => void;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [reviews, setReviews]               = useState<ReviewRequest[]>([]);
  const [activeCameraId, setActiveCameraId] = useState("demo-main");
  const { role } = useAuth();

  // Only generate fake AI questions when the user explicitly picked Demo
  // mode. Live mode (even without a backend) should never spawn fake
  // questions — operators would get bogus 'AI has N questions' badges.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const userChoseDemo = localStorage.getItem("kyro_mode") === "demo";
    if (!userChoseDemo) return;
    if (role !== "admin" && role !== "operator") return;

    const URGENT_TYPES   = ["altar_call_question", "front_rush_question"];
    const STANDARD_TYPES = ["stage_question", "absence_question", "zone_proposal"];

    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    function tryAdd(urgentOnly: boolean) {
      setReviews((prev) => {
        if (prev.length >= 2) return prev; // wait for answers
        const next = getNextDemoReviews(role as "admin" | "operator");
        const pool = next.filter((r) =>
          urgentOnly
            ? URGENT_TYPES.includes(r.review_type as string)
            : STANDARD_TYPES.includes(r.review_type as string)
        );
        const toAdd = pool.filter((r) => !prev.find((x) => x.review_id === r.review_id));
        if (toAdd.length === 0) return prev;
        const req = toAdd[0] as ReviewRequest;
        try {
          const stored: string[] = JSON.parse(localStorage.getItem("kyro_pending_reviews") ?? "[]");
          localStorage.setItem("kyro_pending_reviews", JSON.stringify([...stored, req.review_id]));
          window.dispatchEvent(new Event("kyro_reviews_changed"));
        } catch {}
        return [...prev, req].slice(-5);
      });
    }

    // Fire first standard question 8s after login
    timers.push(setTimeout(() => tryAdd(false), 8_000));

    // Urgent questions (altar call, front rush) — every 5 min if <2 pending
    intervals.push(setInterval(() => tryAdd(true), 5 * 60 * 1000));

    // Standard questions — fixed 15 min intervals
    intervals.push(setInterval(() => tryAdd(false), 15 * 60 * 1000));

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
  }, [role]);

  const addReview = useCallback((r: ReviewRequest) => {
    setReviews((prev) => {
      if (prev.find((x) => x.review_id === r.review_id)) return prev;
      return [...prev, r].slice(-20);
    });
  }, []);

  // Live on the website on its own: the camera computers' AI questions, every 3 s.
  useEffect(() => {
    if (typeof window === "undefined" || !isEdgeLive()) return;
    if (role !== "admin" && role !== "operator") return;
    let alive = true;
    const seen = new Set<string>();
    const load = async () => {
      if (document.hidden) return;
      try {
        const list = await edgeFetch<ReviewRequest[]>("/api/live/questions");
        if (!alive) return;
        const open = new Set(list.map((q) => q.review_id));
        for (const q of list) {
          if (seen.has(q.review_id)) continue;
          seen.add(q.review_id);
          window.dispatchEvent(new CustomEvent("kyro_new_review", { detail: q }));
        }
        // Answered elsewhere (another phone) or expired: take it off this screen too.
        setReviews((prev) => prev.filter((r) => open.has(r.review_id)));
      } catch { /* try again shortly */ }
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [role]);

  // Also listen for reviews dispatched from usePipelineStream (real mode)
  useEffect(() => {
    function onNewReview(e: Event) {
      const r = (e as CustomEvent).detail as ReviewRequest;
      if (r?.review_id) {
        setReviews((prev) => {
          if (prev.find((x) => x.review_id === r.review_id)) return prev;
          return [...prev, r].slice(-20);
        });
        if (r.camera_id) setActiveCameraId(r.camera_id);
      }
    }
    window.addEventListener("kyro_new_review", onNewReview);
    return () => window.removeEventListener("kyro_new_review", onNewReview);
  }, []);

  const dismissReview = useCallback((reviewId: string) => {
    setReviews((prev) => prev.filter((r) => r.review_id !== reviewId));
    try {
      const stored: string[] = JSON.parse(localStorage.getItem("kyro_pending_reviews") ?? "[]");
      localStorage.setItem("kyro_pending_reviews", JSON.stringify(stored.filter((id) => id !== reviewId)));
      window.dispatchEvent(new Event("kyro_reviews_changed"));
    } catch {}
  }, []);

  return (
    <ReviewContext.Provider value={{ reviews, addReview, dismissReview, activeCameraId, setActiveCameraId }}>
      {children}
    </ReviewContext.Provider>
  );
}

export function useReviewContext() {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReviewContext must be inside ReviewProvider");
  return ctx;
}
