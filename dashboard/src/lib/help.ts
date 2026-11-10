/**
 * help.ts — where the Kyro user guide lives, and which guide page explains
 * each dashboard page (so "Help" opens the right page, not just the home).
 */
export const HELP_URL = (process.env.NEXT_PUBLIC_HELP_URL ?? "https://kyro-help.kharischurch.com").replace(/\/$/, "");

const GUIDE_PAGES: Record<string, string> = {
  attendance: "/pages/ai-count",
  "manual-count": "/pages/manual-count",
  "live-cameras": "/pages/live-cameras",
  seating: "/pages/seat-map",
  cameras: "/pages/cameras",
  rota: "/pages/rota",
  sessions: "/pages/sessions",
  analytics: "/pages/analytics",
  "layout-editor": "/pages/seat-editor",
  integrations: "/pages/integrations",
  notifications: "/pages/notifications",
  users: "/pages/users",
  login: "/getting-started/signing-in",
};

/** Guide page for a dashboard path, e.g. "/manual-count/" → …/pages/manual-count. */
export function helpUrlFor(pathname: string | null | undefined): string {
  const first = (pathname ?? "").split("/").filter(Boolean)[0] ?? "";
  return HELP_URL + (GUIDE_PAGES[first] ?? "/");
}
