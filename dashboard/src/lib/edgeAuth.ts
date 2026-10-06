/**
 * edgeAuth.ts — Live-mode accounts on the Cloudflare build (no FastAPI
 * backend). Talks to worker/accounts.js: sign-in checks the password on the
 * server and returns a signed token; users and manual counts are read and
 * written with that token. Demo mode and backend deployments don't use this.
 */

export interface EdgeUser {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "operator" | "viewer";
  pages: string[];
  is_active: boolean;
  created_at: string;
}

/** Live mode on a deployment without the FastAPI backend → the Worker is the server. */
export function isEdgeLive(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("kyro_mode") === "live" && !process.env.NEXT_PUBLIC_API_URL;
}

export function edgeToken(): string | null {
  if (typeof window === "undefined") return null;
  const t = localStorage.getItem("kyro_token");
  return t && t.split(".").length === 3 && !t.includes("demo_signature") ? t : null;
}

/** The signed-in user's details as issued by the server (not trusted by the server itself). */
export function edgeTokenPayload(): { sub: string; name?: string; role: string; pages?: string[]; exp: number } | null {
  const t = edgeToken();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.iss === "kyro-edge" ? p : null;
  } catch { return null; }
}

function storeSession(token: string, user: EdgeUser) {
  localStorage.setItem("kyro_token", token);
  // Older code paths read the display name from here.
  localStorage.setItem("kyro_demo_last_user", user.username);
  localStorage.removeItem("kyro_demo_role");
  sessionStorage.setItem("kyro_active_login", "1");
  sessionStorage.removeItem("kyro_signed_out");
}

async function parse<T>(res: Response): Promise<T> {
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!isJson) throw new Error("Live sign-in needs the Kyro server, which isn't reachable from this address.");
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export async function edgeFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = edgeToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) window.dispatchEvent(new Event("kyro_session_expired"));
  return parse<T>(res);
}

export async function edgeLogin(username: string, password: string): Promise<EdgeUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const data = await parse<{ access_token: string; user: EdgeUser }>(res);
  storeSession(data.access_token, data.user);
  return data.user;
}

/** Re-reads the signed-in user (pages may have changed) and refreshes the token. */
export async function edgeRefreshSession(): Promise<EdgeUser | null> {
  if (!edgeToken()) return null;
  try {
    const data = await edgeFetch<{ access_token: string; user: EdgeUser }>("/api/auth/me");
    localStorage.setItem("kyro_token", data.access_token);
    window.dispatchEvent(new Event("kyro_access_changed"));
    return data.user;
  } catch { return null; }
}

export const edgeUsersApi = {
  list: () => edgeFetch<EdgeUser[]>("/api/users"),
  create: (body: { username: string; password: string; display_name?: string; pages: string[] }) =>
    edgeFetch<EdgeUser>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  update: (username: string, body: { display_name?: string; pages?: string[]; password?: string }) =>
    edgeFetch<EdgeUser>(`/api/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (username: string) =>
    edgeFetch<{ removed: boolean }>(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" }),
  changeOwnPassword: (current_password: string, new_password: string) =>
    edgeFetch<{ changed: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
};
