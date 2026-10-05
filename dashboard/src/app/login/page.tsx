"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { setLiveMode, setDemoMode, DEMO_REVIEWS } from "@/lib/demo";
import { Radio, Zap, Server, ChevronRight, ArrowLeft, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";

const HARDCODED_ACCOUNTS = [
  { username: "admin",        password: "Kharis2024!",  role: "admin",    desc: "Full access — all pages" },
  { username: "sarah.usher",  password: "Sarah@2024!",  role: "operator", desc: "Operator — AI Count, Cameras, Seat Map, Rota, Sessions, Analytics" },
  { username: "james.viewer", password: "James@2024!",  role: "viewer",   desc: "Viewer — Seat Map & Cameras only" },
];

function loadDemoAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem("kyro_demo_users") ?? "[]");
    const active = saved.filter((u: any) => u.is_active);
    const names = new Set(active.map((u: any) => u.username));
    const base = HARDCODED_ACCOUNTS.filter((a) => !names.has(a.username));
    return [
      ...base,
      ...active.map((u: any) => {
        // If the saved user is one of the three built-ins (seeded by the
        // Users page WITHOUT a custom password), prefer the built-in's real
        // password rather than the generic "Demo@1234" fallback — otherwise
        // tapping the demo card tries to log in with "Demo@1234" but
        // validateDemoLogin checks against the built-in's real password
        // and rejects with "wrong password".
        const builtIn = HARDCODED_ACCOUNTS.find((a) => a.username === u.username);
        const password = u.demo_password ?? builtIn?.password ?? "Demo@1234";
        return {
          username: u.username,
          password,
          role: u.role,
          desc: u.role === "admin" ? "Full access" : u.role === "operator" ? "Operator access" : "Read only",
        };
      }),
    ];
  } catch { return HARDCODED_ACCOUNTS; }
}

interface ValidationResult {
  ok: boolean;
  /** Null-safe reason string for a failure; useful for a specific error message. */
  reason?: "no_such_user" | "wrong_password";
}

function validateDemoLogin(username: string, password: string): ValidationResult {
  // Trim both — mobile keyboards (iOS especially) often add a trailing
  // space after autocomplete, which would silently break an exact-match
  // compare.
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) return { ok: false, reason: "no_such_user" };

  // Collect EVERY password this username could legitimately have been given,
  // then accept any match. Avoids the "which source wins" edge cases that
  // kept rejecting valid credentials when the Users page had seeded a user
  // without a demo_password.
  const acceptablePasswords: string[] = [];

  // 1. Custom password set via the Users > Change Password dialog.
  try {
    const saved = JSON.parse(localStorage.getItem("kyro_demo_users") ?? "[]");
    const match = saved.find((x: any) => x.username === u && x.is_active);
    if (match?.demo_password) acceptablePasswords.push(String(match.demo_password));
  } catch {}

  // 2. The built-in hardcoded password for the three default accounts
  //    (admin, sarah.usher, james.viewer).
  const builtIn = HARDCODED_ACCOUNTS.find((a) => a.username === u);
  if (builtIn) acceptablePasswords.push(builtIn.password);

  // 3. The generic "Demo@1234" fallback that loadDemoAccounts hands to
  //    seeded-without-password users for demo cards.
  if (builtIn) acceptablePasswords.push("Demo@1234");

  if (acceptablePasswords.length === 0) return { ok: false, reason: "no_such_user" };
  return acceptablePasswords.includes(p)
    ? { ok: true }
    : { ok: false, reason: "wrong_password" };
}

type Screen = "landing" | "demo" | "live";

const ROLE_COLOURS: Record<string, { bg: string; text: string }> = {
  admin:    { bg: "rgba(139,92,246,0.15)", text: "#c4b5fd" },
  operator: { bg: "rgba(59,130,246,0.15)", text: "#93c5fd" },
  viewer:   { bg: "rgba(107,114,128,0.15)", text: "#9ca3af" },
};

// Floating theme toggle for the pre-login screens. The sidebar's toggle
// isn't shown yet, so without this users can't change theme until they
// sign in — which doesn't help the first-impression experience.
function PreLoginThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const Icon   = isDark ? Sun : Moon;
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="fixed top-4 right-4 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-primary)",
      }}
    >
      <Icon size={16} />
    </button>
  );
}

export default function LoginPage() {
  const { login, isLoading, error, isAuthenticated, role } = useAuth();
  const router = useRouter();
  const [screen, setScreen]       = useState<Screen>("landing");
  const [user, setUser]           = useState("");
  const [pass, setPass]           = useState("");
  const [localError, setLocalError] = useState("");
  const [accounts, setAccounts]   = useState(HARDCODED_ACCOUNTS);

  const signedOut = typeof window !== "undefined" && !!sessionStorage.getItem("kyro_signed_out");

  useEffect(() => {
    if (!signedOut && isAuthenticated) {
      // Viewers go to Seat Map, everyone else goes to AI Count
      router.replace(role === "viewer" ? "/seating" : "/attendance");
    }
  }, [isAuthenticated, role, router, signedOut]);

  useEffect(() => {
    setAccounts(loadDemoAccounts());
  }, []);

  async function handleDemoLogin(username: string, password: string) {
    setLocalError("");
    const check = validateDemoLogin(username, password);
    if (!check.ok) {
      setLocalError(check.reason === "no_such_user"
        ? `No account named "${username.trim()}"`
        : "Wrong password for this account");
      return;
    }
    // Demo login is always local — never hits the real backend
    // Set up demo session directly in localStorage/sessionStorage
    sessionStorage.removeItem("kyro_signed_out");
    sessionStorage.removeItem("kyro_live_mode"); // ensure not in live mode

    // Look up the role for this demo user
    let resolvedRole = "viewer";
    try {
      const saved = JSON.parse(localStorage.getItem("kyro_demo_users") ?? "[]");
      const match = saved.find((u: any) => u.username === username && u.is_active);
      if (match) {
        resolvedRole = match.role;
      } else {
        const hardcoded: Record<string, string> = {
          "admin": "admin", "sarah.usher": "operator", "james.viewer": "viewer",
        };
        resolvedRole = hardcoded[username] ?? "viewer";
      }
    } catch {}

    // Import DEMO_TOKEN and set up demo session
    const { DEMO_TOKEN } = await import("@/lib/demo");
    localStorage.setItem("kyro_token", DEMO_TOKEN);
    localStorage.setItem("kyro_demo_role", resolvedRole);
    setDemoMode(); // ensure kyro_mode=demo so DEMO_MODE resolves correctly
    localStorage.setItem("kyro_demo_last_user", username);

    // Hard navigate so useAuth re-hydrates from fresh localStorage
    const dest = resolvedRole === "viewer" ? "/seating" : "/attendance";
    window.location.href = dest;
  }

  async function handleLiveLogin(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    // Cloudflare Pages has no backend to hit — validate against the same
    // hardcoded accounts as demo, then set up a session locally.
    const check = validateDemoLogin(user, pass);
    if (!check.ok) {
      setLocalError(check.reason === "no_such_user"
        ? `No account named "${user.trim()}". Try admin, sarah.usher, or james.viewer.`
        : "Wrong password for this account.");
      return;
    }
    const trimmedUser = user.trim();
    let resolvedRole = "viewer";
    try {
      const saved = JSON.parse(localStorage.getItem("kyro_demo_users") ?? "[]");
      const match = saved.find((u: any) => u.username === trimmedUser && u.is_active);
      if (match) {
        resolvedRole = match.role;
      } else {
        const hardcoded: Record<string, string> = {
          "admin": "admin", "sarah.usher": "operator", "james.viewer": "viewer",
        };
        resolvedRole = hardcoded[trimmedUser] ?? "viewer";
      }
    } catch {}

    sessionStorage.removeItem("kyro_signed_out");
    sessionStorage.removeItem("kyro_live_mode");
    const { DEMO_TOKEN } = await import("@/lib/demo");
    localStorage.setItem("kyro_token", DEMO_TOKEN);
    localStorage.setItem("kyro_demo_role", resolvedRole);
    // IMPORTANT: Live login must stay in LIVE mode, not demo. Previously we
    // called setDemoMode() here so the UI had something to show without a
    // backend — but that made Live mode display fabricated demo numbers,
    // which confused operators who wanted to enter real data. In live mode
    // without a backend, pages show empty/zero state; operators enter real
    // numbers via the Manual Count page.
    setLiveMode();
    localStorage.setItem("kyro_demo_last_user", trimmedUser);

    // Fresh Live login — wipe every bit of local demo-ish state so the
    // operator sees a true empty slate (no fake past sessions, no fake
    // AI alerts, no fake cameras, no fake seat layouts). We leave
    // kyro_demo_users alone because operators need admin / sarah.usher /
    // james.viewer to log in — and the stored passwords may be custom.
    try {
      [
        "kyro_unanswered_reviews",
        "kyro_archived_reviews",
        "kyro_pending_reviews",
        "kyro_demo_sessions",
        "kyro_demo_layouts",
        "kyro_demo_cameras_added",
        "kyro_demo_cameras_overrides",
        "kyro_demo_cameras_deleted",
        "kyro_demo_rota",
        // reserved seats + seat overrides per camera
      ].forEach((k) => localStorage.removeItem(k));
      // Clear per-camera reserved-seat and seat-override keys too
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("kyro_demo_reserved_") || k.startsWith("kyro_seat_overrides_")
            || k.startsWith("kyro_demo_zones_")) {
          localStorage.removeItem(k);
        }
      }
      window.dispatchEvent(new Event("kyro_unanswered_changed"));
    } catch {}

    const dest = resolvedRole === "viewer" ? "/seating" : "/attendance";
    window.location.href = dest;
  }

  // ── Landing ────────────────────────────────────────────────────────────────
  if (screen === "landing") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: "linear-gradient(160deg, var(--grad-login-a) 0%, var(--bg-base) 50%, var(--grad-login-a) 100%)" }}>
        <PreLoginThemeToggle />

        {/* Logo */}
        <div className="mb-10 flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
            <Radio size={26} className="text-white" strokeWidth={2} />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white tracking-tight">Kyro</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Vision Intelligence</p>
          </div>
        </div>

        {/* Mode cards */}
        <div className="w-full max-w-md flex flex-col gap-4">

          {/* Demo mode */}
          <button onClick={() => { setDemoMode(); setScreen("demo"); }}
            className="w-full rounded-2xl p-5 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.4)" }}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(99,102,241,0.15)" }}>
                <Zap size={18} className="text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-base font-semibold text-white">Demo mode</p>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}>
                    No setup needed
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Explore Kyro with live simulated data — cameras, seat maps, Kyro questions,
                  analytics and more. No backend required.
                </p>
              </div>
              <ChevronRight size={18} className="text-gray-600 shrink-0 mt-1" />
            </div>
          </button>

          {/* Live mode */}
          <button onClick={() => { setLiveMode(); setScreen("live"); }}
            className="w-full rounded-2xl p-5 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: "var(--bg-card)", border: "1px solid rgba(34,197,94,0.3)" }}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(34,197,94,0.12)" }}>
                <Server size={18} className="text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-base font-semibold text-white">Live mode</p>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(34,197,94,0.12)", color: "#86efac" }}>
                    Real data
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Connect to your Kyro backend with real cameras, live attendance tracking,
                  and full AI analysis. Sign in with your account.
                </p>
              </div>
              <ChevronRight size={18} className="text-gray-600 shrink-0 mt-1" />
            </div>
          </button>
        </div>

        <p className="text-xs mt-8" style={{ color: "var(--text-faint)" }}>
          Kyro Vision Intelligence · Church Attendance Platform
        </p>
      </main>
    );
  }

  // ── Demo mode — account picker ─────────────────────────────────────────────
  if (screen === "demo") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: "linear-gradient(160deg, var(--grad-login-a) 0%, var(--bg-base) 50%, var(--grad-login-a) 100%)" }}>
        <PreLoginThemeToggle />

        <div className="w-full max-w-md">
          <button onClick={() => setScreen("landing")}
            className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}>
            <ArrowLeft size={15} /> Back
          </button>

          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.15)" }}>
                <Zap size={16} className="text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Demo mode</h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Choose an account to explore with</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {accounts.map((a) => {
              const col = ROLE_COLOURS[a.role] ?? ROLE_COLOURS.viewer;
              return (
                <button key={a.username}
                  onClick={() => handleDemoLogin(a.username, a.password)}
                  className="w-full rounded-2xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ background: a.role === "admin" ? "#4f46e5" : a.role === "operator" ? "#0369a1" : "var(--text-faint)" }}>
                      {a.username[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-white font-mono">{a.username}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: col.bg, color: col.text }}>{a.role}</span>
                      </div>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{a.desc}</p>
                    </div>
                    <ChevronRight size={15} className="text-gray-600 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          {localError && (
            <p className="text-red-400 text-xs mt-3 rounded-lg px-3 py-2 text-center"
              style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
              {localError}
            </p>
          )}

          <p className="text-xs text-center mt-5" style={{ color: "var(--text-faint)" }}>
            Demo data resets when you clear browser storage
          </p>
        </div>
      </main>
    );
  }

  // ── Live mode — sign in form ───────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "linear-gradient(160deg, var(--grad-login-a) 0%, var(--bg-base) 50%, var(--grad-login-a) 100%)" }}>
      <PreLoginThemeToggle />

      <div className="w-full max-w-sm">
        <button onClick={() => setScreen("landing")}
          className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}>
          <ArrowLeft size={15} /> Back
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(34,197,94,0.12)" }}>
            <Server size={16} className="text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Live mode</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sign in to your Kyro account</p>
          </div>
        </div>

        <form onSubmit={handleLiveLogin}
          className="rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>

          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>Username</label>
            <input type="text" value={user} onChange={(e) => setUser(e.target.value)} required
              autoComplete="username" autoFocus
              className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>Password</label>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required
              autoComplete="current-password"
              className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }} />
          </div>

          {(localError || error) && (
            <p className="text-red-400 text-xs rounded-lg px-3 py-2"
              style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
              {localError || error}
            </p>
          )}

          <button type="submit" disabled={isLoading}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: "#4f46e5" }}>
            {isLoading ? "Signing in…" : "Sign in"}
          </button>

          <p className="text-xs text-center" style={{ color: "var(--text-faint)" }}>
            Sign in with your Kyro account
          </p>
        </form>
      </div>
    </main>
  );
}
