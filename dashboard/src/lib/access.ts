/**
 * access.ts — which pages each signed-in person may open. Shared by the
 * sidebar (what's listed) and <PageGuard> (what can actually be opened by
 * typing an address), so the two can never disagree.
 */
import { edgeTokenPayload, isEdgeLive } from "@/lib/edgeAuth";

export const PAGE_IDS = [
  "attendance", "manual-count", "live-cameras", "seating", "cameras", "rota",
  "sessions", "analytics", "layout-editor", "integrations", "notifications", "users",
  "data-protection",
] as const;
export type PageId = typeof PAGE_IDS[number];

export const ROLE_DEFAULT_PAGES: Record<string, PageId[]> = {
  admin:    [...PAGE_IDS],
  operator: ["attendance", "manual-count", "live-cameras", "seating", "cameras", "rota", "sessions", "analytics", "notifications"],
  viewer:   ["seating", "cameras", "manual-count"],
};

/**
 * Pages that belong to a ROLE rather than to a list of pages.
 *
 * Every account's pages were chosen before this page existed, so nobody's
 * saved list contains it — which made Data Protection invisible to everybody
 * including the administrator who has to fill it in, while Kyro refused to
 * switch face matching on until they had. A governance page cannot be
 * something an administrator can accidentally not have.
 */
const ALWAYS_FOR_ADMIN: PageId[] = ["data-protection"];

export function getAllowedPages(username: string, role: string): PageId[] {
  const withAdminPages = (list: PageId[], r: string): PageId[] =>
    r === "admin" ? [...new Set([...list, ...ALWAYS_FOR_ADMIN])] : list;
  // Live on the Cloudflare build: the server decides (pages are in the signed token).
  if (isEdgeLive()) {
    const p = edgeTokenPayload();
    const r = p?.role ?? role;
    if (p?.pages?.length) {
      return withAdminPages(p.pages.filter((x): x is PageId => (PAGE_IDS as readonly string[]).includes(x)), r);
    }
    return withAdminPages(ROLE_DEFAULT_PAGES[r] ?? ["seating", "cameras"], r);
  }
  try {
    // Demo mode: read from the demo users store
    const saved = JSON.parse(localStorage.getItem(`kyro_${localStorage.getItem("kyro_mode") ?? "demo"}_users`) ?? "[]");
    const match = saved.find((u: { username: string; is_active: boolean }) => u.username === username && u.is_active);
    if (match?.pages && Array.isArray(match.pages) && match.pages.length > 0) return match.pages as PageId[];
  } catch {}
  try {
    // Backend deployments: pages-by-username store (set by admin in Users page)
    const byUsername = JSON.parse(localStorage.getItem("kyro_user_pages_by_name") ?? "{}");
    if (byUsername[username]?.length > 0) return byUsername[username] as PageId[];
  } catch {}
  return withAdminPages(ROLE_DEFAULT_PAGES[role] ?? ["seating", "cameras"], role);
}

/** "/live-cameras/" → "live-cameras"; null for pages that aren't access-controlled (login, home). */
export function pageIdForPath(pathname: string): PageId | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return (PAGE_IDS as readonly string[]).includes(first) ? (first as PageId) : null;
}
