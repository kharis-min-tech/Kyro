"use client";

import { useEffect, useState, FormEvent, useCallback } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { usersApi } from "@/lib/api";
import { isEdgeLive, edgeUsersApi, edgeRefreshSession, edgeTokenPayload } from "@/lib/edgeAuth";
import { DEMO_MODE, DEMO_USERS } from "@/lib/demo";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
const inDemoMode = () => typeof window !== "undefined" && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);
// Accounts kept in this browser: Demo mode, or a self-hosted build that has no backend.
// Live mode on the Cloudflare build uses the Kyro server instead (isEdgeLive).
const localStore = () => inDemoMode() && !isEdgeLive();
import { Eye, EyeOff, KeyRound, X, Check, Pencil } from "lucide-react";
import type { UserResponse } from "@/types";

const BG     = "var(--bg-base)";
const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";

// ─── All pages ────────────────────────────────────────────────────────────────

const ALL_PAGES = [
  { id: "attendance",    label: "AI Count"      },
  { id: "manual-count",  label: "Manual Count"  },
  { id: "live-cameras",  label: "Live Cameras"  },
  { id: "seating",       label: "Seat Map"      },
  { id: "cameras",       label: "Cameras"       },
  { id: "rota",          label: "Rota"          },
  { id: "sessions",      label: "Sessions"      },
  { id: "analytics",     label: "Analytics"     },
  { id: "layout-editor", label: "Seat Editor"   },
  { id: "integrations",  label: "Integrations"  },
  { id: "notifications", label: "Notifications" },
  { id: "users",         label: "Users"         },
] as const;

type PageId = typeof ALL_PAGES[number]["id"];

// Role is derived from pages — admin needs layout-editor or users, operator needs
// any "operator" page, otherwise viewer. The sidebar still uses role for nav gating.
function pagesToRole(pages: PageId[]): "admin" | "operator" | "viewer" {
  if (pages.includes("layout-editor") || pages.includes("users") || pages.includes("integrations")) return "admin";
  // Manual Count is a viewer page (ushers enter counts; operators approve them),
  // matching the default viewer pages below and the Kyro server's rule.
  const opPages: PageId[] = ["attendance","live-cameras","rota","sessions","analytics","notifications"];
  if (pages.some((p) => opPages.includes(p))) return "operator";
  return "viewer";
}

// Default pages per role (for initial state when editing an existing user)
const ROLE_DEFAULT_PAGES: Record<string, PageId[]> = {
  admin:    ALL_PAGES.map((p) => p.id),
  operator: ["attendance","manual-count","live-cameras","seating","cameras","rota","sessions","analytics","notifications"],
  viewer:   ["seating","cameras","manual-count"],
};

// ─── Extended user type with stored pages ─────────────────────────────────────
type DemoUser = UserResponse & { pages?: PageId[]; demo_password?: string };

// ─── Page colours ─────────────────────────────────────────────────────────────
// Chip colours use translucent backgrounds + a mid-weight text colour that
// stays readable in BOTH themes: dark-mode base is near-black (so a mid tone
// looks bright enough), light-mode base is white (so the same mid tone keeps
// enough contrast). Pale pastels (#a5b4fc, #86efac …) washed out on light
// mode — avoid them here.
const PAGE_COLOURS: Record<string, { bg: string; text: string }> = {
  "attendance":    { bg: "rgba(99,102,241,0.18)",  text: "#6366f1" },
  "manual-count":  { bg: "rgba(99,102,241,0.18)",  text: "#6366f1" },
  "live-cameras":  { bg: "rgba(34,197,94,0.15)",   text: "#16a34a" },
  "seating":       { bg: "rgba(124,58,237,0.18)",  text: "#7c3aed" },
  "cameras":       { bg: "rgba(59,130,246,0.18)",  text: "#2563eb" },
  "rota":          { bg: "rgba(245,158,11,0.18)",  text: "#d97706" },
  "sessions":      { bg: "rgba(16,185,129,0.15)",  text: "#059669" },
  "analytics":     { bg: "rgba(249,115,22,0.15)",  text: "#ea580c" },
  "layout-editor": { bg: "rgba(236,72,153,0.15)",  text: "#db2777" },
  "integrations":  { bg: "rgba(59,130,246,0.18)",  text: "#2563eb" },
  "notifications": { bg: "rgba(234,179,8,0.15)",   text: "#ca8a04" },
  "users":         { bg: "rgba(239,68,68,0.15)",   text: "#dc2626" },
};

// ─── Demo storage ─────────────────────────────────────────────────────────────
const DEMO_USERS_KEY = "kyro_demo_users";

// Mode-scoped storage: Live mode's user list is separate from Demo mode's.
function usersKey(): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_users`;
}

function loadDemoUsers(): DemoUser[] {
  try {
    const saved = localStorage.getItem(usersKey());
    if (saved) {
      const parsed: DemoUser[] = JSON.parse(saved);
      return parsed.map((u) => ({
        ...u,
        pages: u.pages ?? (ROLE_DEFAULT_PAGES[u.role] as PageId[]) ?? ["seating","cameras"],
      }));
    }
    // Only seed admin/sarah/james in Demo mode. Live accounts live on a
    // server (the FastAPI backend, or the Kyro Worker on Cloudflare) and
    // never use these built-in demo credentials.
    const isActualDemo = typeof window !== "undefined" && localStorage.getItem("kyro_mode") === "demo";
    const defaults: DemoUser[] = isActualDemo
      ? (DEMO_USERS as UserResponse[]).map((u) => ({
          ...u,
          pages: (ROLE_DEFAULT_PAGES[u.role] as PageId[]) ?? ["seating","cameras"],
        }))
      : [];
    localStorage.setItem(usersKey(), JSON.stringify(defaults));
    return defaults;
  } catch { return []; }
}

function saveDemoUsers(users: DemoUser[]) {
  try { localStorage.setItem(usersKey(), JSON.stringify(users)); } catch {}
}

// ─── Page toggle picker ───────────────────────────────────────────────────────
function PagePicker({ selected, onChange }: {
  selected: PageId[];
  onChange: (s: PageId[]) => void;
}) {
  function toggle(id: PageId) {
    if (selected.includes(id)) onChange(selected.filter((p) => p !== id));
    else onChange([...selected, id]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {ALL_PAGES.map(({ id, label }) => {
        const on = selected.includes(id);
        const col = PAGE_COLOURS[id];
        return (
          <button key={id} type="button" onClick={() => toggle(id)}
            className="text-xs px-3 py-1.5 rounded-full border transition-all font-medium"
            style={on
              ? { background: col.bg, color: col.text, borderColor: col.text + "60" }
              : { background: "transparent", color: "var(--text-faint)", borderColor: "var(--border-subtle)" }}>
            {on && "✓ "}{label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const s: Record<string, { bg: string; text: string }> = {
    admin:    { bg: "rgba(139,92,246,0.2)",  text: "#c4b5fd" },
    operator: { bg: "rgba(59,130,246,0.2)",  text: "#93c5fd" },
    viewer:   { bg: "rgba(107,114,128,0.2)", text: "#9ca3af" },
  };
  const { bg, text } = s[role] ?? s.viewer;
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: text }}>{role}</span>;
}

// ─── Password dialog: view + change (with verified persistent save) ──────────
const HARDCODED_PASSWORDS: Record<string, string> = {
  admin: "Kharis2024!", "sarah.usher": "Sarah@2024!", "james.viewer": "James@2024!",
};
const HARDCODED_ROLES: Record<string, "admin" | "operator" | "viewer"> = {
  admin: "admin", "sarah.usher": "operator", "james.viewer": "viewer",
};

function readCurrentPassword(username: string): string {
  if (!localStore()) return "Stored as encrypted hash — cannot be retrieved";
  try {
    const u = loadDemoUsers().find((u) => u.username === username);
    if (u?.demo_password) return u.demo_password;
  } catch {}
  return HARDCODED_PASSWORDS[username] ?? "Demo@1234";
}

function PasswordDialog({ username, onPasswordChanged, onClose }: {
  username: string;
  onPasswordChanged: () => void;
  onClose: () => void;
}) {
  const [showPw, setShowPw]   = useState(false);
  // Live (server) passwords are hashed and can never be shown — go straight to "change".
  const [mode, setMode]       = useState<"view" | "change">(() => (isEdgeLive() ? "change" : "view"));
  const [newPw, setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr]         = useState<string | null>(null);
  const [ok, setOk]           = useState<string | null>(null);
  const [pw, setPw]           = useState<string>(() => readCurrentPassword(username));
  const isHardcoded = HARDCODED_PASSWORDS[username] !== undefined;
  const hasCustomOverride = pw !== HARDCODED_PASSWORDS[username];

  function savePassword() {
    setErr(null); setOk(null);
    if (newPw.length < 8) { setErr("Must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setErr("Passwords don't match"); return; }
    if (isEdgeLive()) {
      edgeUsersApi.update(username, { password: newPw })
        .then(() => {
          setOk("Password changed. They'll use it next time they sign in.");
          setNewPw(""); setConfirmPw("");
          setTimeout(() => { onPasswordChanged(); onClose(); }, 1200);
        })
        .catch((e: Error) => setErr(e.message));
      return;
    }
    try {
      const all = loadDemoUsers();
      const idx = all.findIndex((u) => u.username === username);
      if (idx >= 0) {
        all[idx] = { ...all[idx], demo_password: newPw };
      } else {
        // User not yet in the saved list (edge case) — add a shadow entry
        const role = HARDCODED_ROLES[username] ?? "viewer";
        all.push({
          id: Date.now(),
          username,
          display_name: username,
          role,
          is_active: true,
          created_at: new Date().toISOString(),
          demo_password: newPw,
          pages: (ROLE_DEFAULT_PAGES[role] as PageId[]) ?? ["seating", "cameras"],
        } as DemoUser);
      }
      saveDemoUsers(all);
      // Verify: read it back and confirm it stuck
      const check = loadDemoUsers().find((u) => u.username === username);
      if (check?.demo_password !== newPw) {
        setErr("Save failed — browser storage may be blocked or full.");
        return;
      }
      setPw(newPw);
      setOk("Password saved. It will survive page refreshes on this browser.");
      setNewPw(""); setConfirmPw("");
      setTimeout(() => { setMode("view"); onPasswordChanged(); }, 1000);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save");
    }
  }

  function resetToDefault() {
    if (!isHardcoded) return;
    if (!window.confirm(`Reset ${username}'s password back to the built-in default?`)) return;
    setErr(null); setOk(null);
    try {
      const all = loadDemoUsers().map((u) =>
        u.username === username ? { ...u, demo_password: undefined } : u
      );
      saveDemoUsers(all);
      setPw(HARDCODED_PASSWORDS[username]);
      setOk("Password reset to built-in default.");
      onPasswordChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to reset");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="rounded-2xl p-6 w-96 shadow-2xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <KeyRound size={16} style={{ color: "#818cf8" }} />
            <h3 className="text-sm font-semibold text-white">
              {mode === "view" ? "Password" : "Change password"} — {username}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        {mode === "view" ? (
          <>
            <div className="flex items-center gap-2 rounded-lg px-3 py-3 mb-2" style={{ background: "var(--bg-base)", border: "1px solid #374151" }}>
              <span className="flex-1 text-sm font-mono text-white tracking-wider select-all">
                {showPw ? pw : "•".repeat(Math.min(pw.length, 16))}
              </span>
              <button
                onClick={() => {
                  if (!showPw && !window.confirm(`Reveal the plaintext password for "${username}"?\n\nOnly do this on a screen no-one else can see.`)) return;
                  setShowPw((p) => !p);
                }}
                className="text-gray-500 hover:text-white flex-shrink-0"
                aria-label={showPw ? "Hide password" : "Reveal password"}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Demo storage — passwords live in this browser only, not hashed.
              A production backend would store hashes and never allow reveal.
            </p>
            {ok && <p className="text-xs text-green-400 mb-3 rounded-lg px-3 py-2" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}>{ok}</p>}
            {isHardcoded && hasCustomOverride && (
              <p className="text-xs text-amber-400 mb-3">Custom password set (overrides the built-in default)</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setMode("change"); setOk(null); setErr(null); }}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "#4f46e5" }}>
                Change password
              </button>
              {isHardcoded && hasCustomOverride && (
                <button onClick={resetToDefault}
                  className="py-2 px-3 rounded-lg text-xs text-gray-400 hover:text-white" style={{ background: "var(--border-subtle)" }}>
                  Reset
                </button>
              )}
              <button onClick={onClose} className="py-2 px-4 rounded-lg text-sm text-gray-400 hover:text-white" style={{ background: "var(--border-subtle)" }}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">New password (min 8 characters)</label>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg-base)", border: "1px solid #374151" }}>
                  <input type={showPw ? "text" : "password"} value={newPw} onChange={(e) => setNewPw(e.target.value)}
                    autoFocus minLength={8} autoComplete="new-password"
                    className="flex-1 bg-transparent text-sm text-white focus:outline-none" />
                  <button type="button" onClick={() => setShowPw((p) => !p)} className="text-gray-500 hover:text-white flex-shrink-0">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Confirm new password</label>
                <input type={showPw ? "text" : "password"} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                  minLength={8} autoComplete="new-password"
                  className="w-full text-sm text-white rounded-lg px-3 py-2 focus:outline-none"
                  style={{ background: "var(--bg-base)", border: "1px solid #374151" }} />
              </div>
              {err && <p className="text-xs text-red-400 rounded-lg px-3 py-2" style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>{err}</p>}
              {ok  && <p className="text-xs text-green-400 rounded-lg px-3 py-2" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}>{ok}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={savePassword} disabled={!newPw || !confirmPw}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: "#4f46e5" }}>
                Save password
              </button>
              <button onClick={() => { if (isEdgeLive()) { onClose(); return; } setMode("view"); setNewPw(""); setConfirmPw(""); setErr(null); setOk(null); }}
                className="flex-1 py-2 rounded-lg text-sm text-gray-400 hover:text-white" style={{ background: "var(--border-subtle)" }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline access editor ─────────────────────────────────────────────────────
function AccessEditor({ user, onSaved, onCancel }: {
  user: DemoUser;
  onSaved: (updated: DemoUser) => void;
  onCancel: () => void;
}) {
  const initial = user.pages ?? (ROLE_DEFAULT_PAGES[user.role] as PageId[]) ?? ["seating","cameras"];
  const [selected, setSelected] = useState<PageId[]>(initial);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const derivedRole = pagesToRole(selected);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const updated: DemoUser = { ...user, pages: selected, role: derivedRole };
      if (isEdgeLive()) {
        const res = await edgeUsersApi.update(user.username, { pages: selected });
        onSaved({ ...user, ...res, pages: res.pages as PageId[] });
      } else if (localStore()) {
        onSaved(updated);
      } else {
        const res = await usersApi.update(user.id, { role: derivedRole });
        onSaved({ ...res, pages: selected });
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-3" style={{ background: "var(--bg-inset)", borderTop: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Edit access for {user.display_name || user.username}</p>
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: derivedRole === "admin" ? "rgba(139,92,246,0.2)" : derivedRole === "operator" ? "rgba(59,130,246,0.2)" : "rgba(107,114,128,0.2)",
                   color: derivedRole === "admin" ? "#c4b5fd" : derivedRole === "operator" ? "#93c5fd" : "#9ca3af" }}>
          Role: {derivedRole}
        </span>
      </div>
      <PagePicker selected={selected} onChange={setSelected} />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
          style={{ background: "#4f46e5" }}>
          <Check size={12} />{saving ? "Saving…" : "Save access"}
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white" style={{ background: "var(--border-subtle)" }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const [users, setUsers]               = useState<DemoUser[]>([]);
  const [loading, setLoading]           = useState(true);
  const [status, setStatus]             = useState<{ ok: boolean; msg: string } | null>(null);
  const [revealingFor, setRevealingFor] = useState<string | null>(null);
  const [editingId, setEditingId]       = useState<number | null>(null);
  const [edgeMode, setEdgeMode]         = useState(false);
  const [localMode, setLocalMode]       = useState(false);
  useEffect(() => { setEdgeMode(isEdgeLive()); setLocalMode(localStore()); }, []);

  const [creating, setCreating]   = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplay,  setNewDisplay]  = useState("");
  const [newPages, setNewPages]   = useState<PageId[]>(["seating","cameras"]);
  const newRole = pagesToRole(newPages);

  const loadUsers = useCallback(() => {
    if (isEdgeLive()) {
      edgeUsersApi.list()
        .then((us) => setUsers(us.map((u) => ({ ...u, pages: u.pages as PageId[] }))))
        .catch((e: Error) => setStatus({ ok: false, msg: e.message }))
        .finally(() => setLoading(false));
      return;
    }
    if (localStore()) {
      setUsers(loadDemoUsers().filter((u) => u.is_active));
      setLoading(false);
      return;
    }
    usersApi.list()
      .then((us) => setUsers(us.map((u) => {
        // Restore saved page access for this user if admin set it
        try {
          const byName = JSON.parse(localStorage.getItem("kyro_user_pages_by_name") ?? "{}");
          if (byName[u.username]?.length > 0) return { ...u, pages: byName[u.username] as PageId[] };
        } catch {}
        return { ...u, pages: (ROLE_DEFAULT_PAGES[u.role] as PageId[]) ?? ["seating","cameras"] };
      })))
      .catch((e: any) => setStatus({ ok: false, msg: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true); setStatus(null);
    if (isEdgeLive()) {
      try {
        await edgeUsersApi.create({ username: newUsername, password: newPassword, display_name: newDisplay || undefined, pages: newPages });
        setNewUsername(""); setNewPassword(""); setNewDisplay(""); setNewPages(["seating","cameras"]);
        setStatus({ ok: true, msg: `"${newUsername}" created — they can sign in now` });
        loadUsers();
      } catch (err: unknown) { setStatus({ ok: false, msg: err instanceof Error ? err.message : "Failed" }); }
      finally { setCreating(false); }
      return;
    }
    if (localStore()) {
      const newUser: DemoUser = {
        id: Date.now(), username: newUsername,
        display_name: newDisplay || newUsername,
        role: newRole, pages: newPages,
        is_active: true, created_at: new Date().toISOString(),
        demo_password: newPassword || "Demo@1234",
      };
      const all = [...loadDemoUsers(), newUser];
      saveDemoUsers(all);
      setUsers(all.filter((u) => u.is_active));
      setNewUsername(""); setNewPassword(""); setNewDisplay(""); setNewPages(["seating","cameras"]);
      setStatus({ ok: true, msg: `"${newUsername}" created` });
      setCreating(false);
      return;
    }
    try {
      await usersApi.create({ username: newUsername, password: newPassword, display_name: newDisplay || undefined, role: newRole });
      setNewUsername(""); setNewPassword(""); setNewDisplay(""); setNewPages(["seating","cameras"]);
      setStatus({ ok: true, msg: "User created" });
      loadUsers();
    } catch (err: any) { setStatus({ ok: false, msg: err.message }); }
    finally { setCreating(false); }
  }

  async function handleDeactivate(id: number, username: string) {
    if (!confirm(`Remove ${username}?`)) return;
    if (isEdgeLive()) {
      try { await edgeUsersApi.remove(username); setStatus({ ok: true, msg: `${username} removed — they can no longer sign in` }); loadUsers(); }
      catch (err: unknown) { setStatus({ ok: false, msg: err instanceof Error ? err.message : "Failed" }); }
      return;
    }
    if (localStore()) {
      const all = loadDemoUsers().map((u) => u.id === id ? { ...u, is_active: false } : u);
      saveDemoUsers(all);
      setUsers(all.filter((u) => u.is_active));
      setStatus({ ok: true, msg: `${username} removed` });
      return;
    }
    try { await usersApi.deactivate(id); setStatus({ ok: true, msg: `${username} deactivated` }); loadUsers(); }
    catch (err: any) { setStatus({ ok: false, msg: err.message }); }
  }

  function handleAccessSaved(updated: DemoUser) {
    if (isEdgeLive()) {
      setUsers((prev) => prev.map((u) => u.username === updated.username ? updated : u));
      // Editing your own access: pick up the new pages right away.
      if (edgeTokenPayload()?.sub === updated.username) edgeRefreshSession();
    } else if (localStore()) {
      const all = loadDemoUsers().map((u) => u.id === updated.id ? { ...u, role: updated.role, pages: updated.pages } : u);
      saveDemoUsers(all);
      setUsers(all.filter((u) => u.is_active));
      const lastUser = localStorage.getItem("kyro_demo_last_user");
      if (lastUser === updated.username) {
        localStorage.setItem("kyro_demo_role", updated.role);
      }
      window.dispatchEvent(new CustomEvent("kyro_role_changed", { detail: { role: updated.role, username: updated.username } }));
    } else {
      // Real mode: persist page list to localStorage keyed by user ID
      // (backend stores role only; pages are a frontend UI concept)
      try {
        const pagesStore = JSON.parse(localStorage.getItem("kyro_user_pages") ?? "{}");
        pagesStore[updated.id] = updated.pages ?? [];
        localStorage.setItem("kyro_user_pages", JSON.stringify(pagesStore));
        // Also store by username so the sidebar can look it up
        const byUsername = JSON.parse(localStorage.getItem("kyro_user_pages_by_name") ?? "{}");
        byUsername[updated.username] = updated.pages ?? [];
        localStorage.setItem("kyro_user_pages_by_name", JSON.stringify(byUsername));
      } catch {}
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
    }
    setEditingId(null);
    setStatus({ ok: true, msg: `Access updated for ${updated.display_name || updated.username}` });
  }

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: BG }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 p-3 sm:p-6 overflow-auto max-w-4xl">

        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create accounts and control exactly which sections each person can access</p>
        </div>

        {status && (
          <div className={`mb-5 text-sm px-4 py-3 rounded-xl border ${status.ok ? "border-green-800 text-green-300" : "border-red-800 text-red-300"}`}
            style={{ background: status.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
            {status.msg}
          </div>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="rounded-2xl overflow-hidden mb-8" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold text-white">Add a new user</p>
            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>Toggle the pages they can access</p>
          </div>
          <div className="p-4 sm:p-5 flex flex-col gap-5">
            {/* On mobile, each field takes the full row so the password field
                is never cut off; on sm+ they lay out side-by-side. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>Username</label>
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required placeholder="john.doe"
                  autoComplete="username"
                  className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                  style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>Display name</label>
                <input value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder="John Doe"
                  className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                  style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>Password</label>
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required={!localMode}
                  type="password" minLength={8} placeholder="min 8 chars"
                  autoComplete="new-password"
                  className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                  style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-xs text-gray-500">Page access</label>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: newRole === "admin" ? "rgba(139,92,246,0.2)" : newRole === "operator" ? "rgba(59,130,246,0.2)" : "rgba(107,114,128,0.2)",
                           color: newRole === "admin" ? "#c4b5fd" : newRole === "operator" ? "#93c5fd" : "#9ca3af" }}>
                  → {newRole}
                </span>
              </div>
              <PagePicker selected={newPages} onChange={setNewPages} />
            </div>
            <button type="submit" disabled={creating}
              className="self-start px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#4f46e5" }}>
              {creating ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>

        {/* Users list */}
        {loading ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-600 py-8 text-center">No users yet.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <div className="px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{users.length} user{users.length !== 1 ? "s" : ""}</p>
            </div>
            {users.map((u, i) => {
              const pages = u.pages ?? (ROLE_DEFAULT_PAGES[u.role] as PageId[]) ?? [];
              const isEditing = editingId === u.id;
              return (
                <div key={u.id} style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
                  {/* Mobile: stack avatar/info and actions vertically so the
                      date and access-chips never collide with the buttons.
                      Desktop (md+): original horizontal layout. */}
                  <div className="px-5 py-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                        style={{ background: u.role === "admin" ? "#4f46e5" : u.role === "operator" ? "#0369a1" : "var(--text-faint)" }}>
                        {(u.display_name || u.username)[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <p className="text-sm font-semibold text-white">{u.display_name || u.username}</p>
                          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{u.username}</p>
                          <RoleBadge role={u.role} />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_PAGES.filter((p) => pages.includes(p.id)).map((p) => {
                            const col = PAGE_COLOURS[p.id];
                            return (
                              <span key={p.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: col.bg, color: col.text }}>
                                {p.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 md:gap-3 md:shrink-0 pl-12 md:pl-0 md:border-l-0 border-t md:border-t-0 pt-3 md:pt-0" style={{ borderColor: BORDER }}>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(u.created_at).toLocaleDateString()}</p>
                      <button onClick={() => setRevealingFor(u.username)}
                        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                        <KeyRound size={11} /> Password
                      </button>
                      <button onClick={() => setEditingId(isEditing ? null : u.id)}
                        className="flex items-center gap-1 text-xs hover:text-white transition-colors"
                        style={{ color: isEditing ? "#818cf8" : "var(--text-muted)" }}>
                        <Pencil size={11} /> {isEditing ? "Cancel" : "Edit access"}
                      </button>
                      <button onClick={() => handleDeactivate(u.id, u.username)}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors">Remove</button>
                    </div>
                  </div>
                  {isEditing && (
                    <AccessEditor user={u} onSaved={handleAccessSaved} onCancel={() => setEditingId(null)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-gray-700 mt-5">
          {edgeMode
            ? "Passwords are stored securely on the Kyro server and can't be shown. Kyro always keeps at least one administrator."
            : "The built-in admin account always has full access."}
        </p>
      </main>
      {revealingFor && <PasswordDialog username={revealingFor} onPasswordChanged={loadUsers} onClose={() => setRevealingFor(null)} />}
    </div>
  );
}
