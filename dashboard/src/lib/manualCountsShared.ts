/**
 * manualCountsShared.ts — Manual Counts shared through the Kyro server
 * (worker/accounts.js) in Live mode on the Cloudflare build, so every usher's
 * phone adds to ONE total instead of each phone keeping its own list.
 *
 * Each fetch also mirrors the day's counts into this browser's usual
 * localStorage key, so pages that read counts synchronously (AI Count's
 * headline, the Integrations payload) see the shared numbers too.
 */
import { edgeFetch, isEdgeLive } from "@/lib/edgeAuth";
import { currentPushEndpoint } from "@/lib/edgePush";

export interface SharedCount {
  id: string;
  zone: string;
  count: number;
  counted_by: string;
  counted_by_user?: string;
  counted_at: number;
  session_id: string;
  camera_also_counting: boolean;
  approved?: boolean;
  approved_at?: number;
  approved_by?: string;
}

export const usesSharedCounts = (): boolean => isEdgeLive();

const LOCAL_KEY = "kyro_live_manual_counts";

function mirror(date: string, counts: SharedCount[]) {
  try {
    const others = (JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as SharedCount[])
      .filter((c) => c.session_id !== date);
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...counts, ...others]));
    window.dispatchEvent(new Event("kyro_manual_counts_changed"));
  } catch {}
}

export async function fetchSharedCounts(date: string): Promise<{ counts: SharedCount[]; can_approve: boolean }> {
  const data = await edgeFetch<{ counts: SharedCount[]; can_approve: boolean }>(`/api/manual-counts?date=${date}`);
  mirror(date, data.counts);
  return data;
}

export async function saveSharedCount(rec: { date: string; zone: string; count: number; capacity?: number | null; camera_also_counting?: boolean }) {
  return edgeFetch<{ count: SharedCount; replaced: boolean }>("/api/manual-counts", {
    method: "PUT",
    body: JSON.stringify({ ...rec, sender_endpoint: await currentPushEndpoint() }),
  });
}

export async function removeSharedCount(date: string, zone: string) {
  return edgeFetch<{ removed: boolean }>(`/api/manual-counts?date=${date}&zone=${encodeURIComponent(zone)}`, { method: "DELETE" });
}

export async function approveSharedCounts(date: string) {
  return edgeFetch<{ approved: number; total: number }>("/api/manual-counts/approve", {
    method: "POST",
    body: JSON.stringify({ date, sender_endpoint: await currentPushEndpoint() }),
  });
}

/** Pull today's shared counts into this browser (used by AI Count / Integrations). */
export async function syncTodayCounts(date: string): Promise<void> {
  if (!usesSharedCounts()) return;
  try { await fetchSharedCounts(date); } catch {}
}
