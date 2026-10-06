/**
 * Live-mode accounts and shared Manual Counts for the Cloudflare build.
 *
 * Before this, Live sign-in on the Cloudflare site checked passwords against
 * a list compiled into the dashboard's JavaScript (readable by anyone), and
 * manual counts lived only in the browser that typed them. Now:
 *
 *  - Accounts live in KV (SUBS namespace, "user:" keys) with salted
 *    PBKDF2-SHA256 password hashes. The plaintext never leaves the request.
 *  - Sign-in returns an HMAC-signed token (JWT layout: sub, role, pages,
 *    exp). The signing key is generated on first use and kept in KV.
 *  - Every request re-loads the user, so deactivating someone or changing
 *    their pages takes effect immediately, not when their token expires.
 *  - Manual counts are stored per service day and zone ("mc:" keys), so
 *    every usher's phone adds to one shared total.
 *
 * The first admin is created once with POST /api/auth/setup, which needs a
 * one-time setup code whose SHA-256 is in the SETUP_CODE_HASH var.
 */

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 10_000; // kept modest for the Workers CPU limit; login is rate-limited
const TOKEN_TTL_S = 12 * 3600;
const MANUAL_COUNT_TTL_S = 400 * 24 * 3600;

export const ALL_PAGES = [
  "attendance", "manual-count", "live-cameras", "seating", "cameras", "rota",
  "sessions", "analytics", "layout-editor", "integrations", "notifications", "users",
];
const ROLE_DEFAULT_PAGES = {
  admin: ALL_PAGES,
  operator: ["attendance", "manual-count", "live-cameras", "seating", "cameras", "rota", "sessions", "analytics", "notifications"],
  viewer: ["seating", "cameras", "manual-count"],
};

/** Same rule as the Users page: admin pages → admin, operator pages → operator. */
export function pagesToRole(pages) {
  if (pages.some((p) => p === "layout-editor" || p === "users" || p === "integrations")) return "admin";
  // Manual Count is deliberately NOT here: ushers (viewers) enter counts;
  // operators and admins approve them.
  const op = ["attendance", "live-cameras", "rota", "sessions", "analytics", "notifications"];
  return pages.some((p) => op.includes(p)) ? "operator" : "viewer";
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob((str + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));

/** Constant-time comparison so response timing doesn't leak a match. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 16 * 1024) throw Object.assign(new Error("Request too large"), { status: 413 });
  try { return JSON.parse(text || "{}"); } catch { throw Object.assign(new Error("Body must be JSON"), { status: 400 }); }
}

const normUser = (u) => String(u ?? "").trim().toLowerCase();
const validUsername = (u) => /^[a-z0-9._-]{2,40}$/.test(u);
const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function sanitizePages(pages) {
  if (!Array.isArray(pages)) return null;
  const out = [...new Set(pages.filter((p) => ALL_PAGES.includes(p)))];
  return out.length ? out : null;
}

/** Strip secrets before a user record leaves the Worker. */
function publicUser(u) {
  return {
    id: u.id, username: u.username, display_name: u.display_name || u.username,
    role: u.role, pages: u.pages, is_active: u.is_active, created_at: u.created_at,
  };
}

// ─── Passwords & tokens ─────────────────────────────────────────────────────

async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const salt = saltB64 ? b64urlDecode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { salt: b64url(salt), hash: b64url(bits), iterations };
}

async function signingKey(env) {
  let raw = await env.SUBS.get("sys:signing_key");
  if (!raw) {
    raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await env.SUBS.put("sys:signing_key", raw);
  }
  return crypto.subtle.importKey("raw", b64urlDecode(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function issueToken(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson({
    sub: user.username, name: user.display_name || user.username, role: user.role,
    pages: user.pages, iat: now, exp: now + TOKEN_TTL_S, iss: "kyro-edge",
  });
  const sig = await crypto.subtle.sign("HMAC", await signingKey(env), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Returns the signed-in, still-active user for this request, or null. */
export async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await signingKey(env), b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.iss !== "kyro-edge" || !payload.exp || payload.exp * 1000 < Date.now()) return null;
    const user = await env.SUBS.get(`user:${normUser(payload.sub)}`, "json");
    return user && user.is_active ? user : null;
  } catch { return null; }
}

const canUsePage = (user, page) => user.role === "admin" || (user.pages || []).includes(page);

// ─── Rate limiting (failed sign-ins) ────────────────────────────────────────

// Limits are per network address (and per address + username) — never per
// username alone, or anyone could lock the real admin out by guessing.
async function tooManyFailures(env, limits) {
  for (const [k, max] of limits) {
    const n = parseInt((await env.SUBS.get(k)) || "0", 10);
    if (n >= max) return true;
  }
  return false;
}
async function recordFailure(env, limits) {
  for (const [k] of limits) {
    const n = parseInt((await env.SUBS.get(k)) || "0", 10);
    await env.SUBS.put(k, String(n + 1), { expirationTtl: 15 * 60 });
  }
}

// ─── Users ──────────────────────────────────────────────────────────────────

async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "user:", cursor });
    const vals = await Promise.all(page.keys.map((k) => env.SUBS.get(k.name, "json")));
    vals.forEach((v) => v && out.push(v));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function anyUserExists(env) {
  const page = await env.SUBS.list({ prefix: "user:", limit: 1 });
  return page.keys.length > 0;
}

async function createUserRecord(env, { username, password, display_name, pages }) {
  const uname = normUser(username);
  if (!validUsername(uname)) throw Object.assign(new Error("Username must be 2–40 letters, numbers, dots, dashes or underscores"), { status: 400 });
  if (typeof password !== "string" || password.length < 8) throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  if (await env.SUBS.get(`user:${uname}`)) throw Object.assign(new Error(`An account named "${uname}" already exists`), { status: 409 });
  const pg = sanitizePages(pages) || ROLE_DEFAULT_PAGES.viewer;
  const user = {
    id: Date.now(), username: uname, display_name: cleanText(display_name, 60) || uname,
    pages: pg, role: pagesToRole(pg), is_active: true, created_at: new Date().toISOString(),
    ...(await hashPassword(password)),
  };
  await env.SUBS.put(`user:${uname}`, JSON.stringify(user));
  return user;
}

async function activeAdminCount(env) {
  return (await listUsers(env)).filter((u) => u.is_active && u.role === "admin").length;
}

// ─── Route handler ──────────────────────────────────────────────────────────

/**
 * Handles /api/auth/*, /api/users*, /api/manual-counts*. Returns null for
 * other paths. `hooks.notifyCount` sends the phone alerts for counts.
 */
export async function handleAccounts(request, env, ctx, url, hooks) {
  const p = url.pathname;
  if (!p.startsWith("/api/auth/") && !p.startsWith("/api/users") && !p.startsWith("/api/manual-counts")) return null;
  if (!env.SUBS) return json({ error: "Accounts are not configured on this deployment" }, 503);
  try {
    // ── Sign-in & setup ──
    if (p === "/api/auth/status" && request.method === "GET") {
      return json({ configured: await anyUserExists(env) });
    }
    if (p === "/api/auth/setup" && request.method === "POST") {
      const body = await readBody(request);
      if (await anyUserExists(env)) return json({ error: "Kyro already has accounts — sign in instead" }, 409);
      const expected = env.SETUP_CODE_HASH || "";
      const given = b64url(await crypto.subtle.digest("SHA-256", enc.encode(String(body.setup_code ?? ""))));
      if (!expected || !safeEqual(given, expected)) return json({ error: "Setup code is not valid" }, 403);
      const user = await createUserRecord(env, { ...body, pages: ALL_PAGES });
      return json({ user: publicUser(user), access_token: await issueToken(env, user) }, 201);
    }
    if (p === "/api/auth/login" && request.method === "POST") {
      const body = await readBody(request);
      const uname = normUser(body.username);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rl = [[`rl:login:ip:${ip}`, 30], [`rl:login:ipuser:${ip}:${uname}`, 10]];
      if (await tooManyFailures(env, rl)) return json({ error: "Too many failed sign-ins. Wait 15 minutes and try again." }, 429);
      const user = uname ? await env.SUBS.get(`user:${uname}`, "json") : null;
      // Hash even when the user doesn't exist so timing doesn't reveal which usernames are real.
      const check = await hashPassword(String(body.password ?? ""), user?.salt, user?.iterations);
      if (!user || !user.is_active || !safeEqual(check.hash, user.hash)) {
        await recordFailure(env, rl);
        return json({ error: "Wrong username or password." }, 401);
      }
      return json({ access_token: await issueToken(env, user), user: publicUser(user) });
    }

    const me = await currentUser(request, env);
    if (!me) return json({ error: "Please sign in again" }, 401);

    if (p === "/api/auth/me" && request.method === "GET") {
      return json({ user: publicUser(me), access_token: await issueToken(env, me) });
    }
    if (p === "/api/auth/password" && request.method === "POST") {
      const body = await readBody(request);
      const check = await hashPassword(String(body.current_password ?? ""), me.salt, me.iterations);
      if (!safeEqual(check.hash, me.hash)) return json({ error: "Current password is wrong" }, 403);
      if (typeof body.new_password !== "string" || body.new_password.length < 8) return json({ error: "New password must be at least 8 characters" }, 400);
      await env.SUBS.put(`user:${me.username}`, JSON.stringify({ ...me, ...(await hashPassword(body.new_password)) }));
      return json({ changed: true });
    }

    // ── Users (admins only) ──
    if (p === "/api/users" || p.startsWith("/api/users/")) {
      if (me.role !== "admin") return json({ error: "Only administrators can manage users" }, 403);
      if (p === "/api/users" && request.method === "GET") {
        return json((await listUsers(env)).filter((u) => u.is_active).map(publicUser));
      }
      if (p === "/api/users" && request.method === "POST") {
        const user = await createUserRecord(env, await readBody(request));
        return json(publicUser(user), 201);
      }
      const uname = normUser(decodeURIComponent(p.slice("/api/users/".length)));
      const user = await env.SUBS.get(`user:${uname}`, "json");
      if (!user) return json({ error: "No such user" }, 404);
      if (request.method === "PATCH") {
        const body = await readBody(request);
        const next = { ...user };
        if (body.display_name !== undefined) next.display_name = cleanText(body.display_name, 60) || user.username;
        if (body.pages !== undefined) {
          const pg = sanitizePages(body.pages);
          if (!pg) return json({ error: "Choose at least one page" }, 400);
          next.pages = pg; next.role = pagesToRole(pg);
        }
        if (body.password !== undefined) {
          if (typeof body.password !== "string" || body.password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
          Object.assign(next, await hashPassword(body.password));
        }
        if (user.role === "admin" && next.role !== "admin" && (await activeAdminCount(env)) <= 1) {
          return json({ error: "Kyro needs at least one administrator — give someone else admin access first" }, 409);
        }
        await env.SUBS.put(`user:${uname}`, JSON.stringify(next));
        return json(publicUser(next));
      }
      if (request.method === "DELETE") {
        if (uname === me.username) return json({ error: "You can't remove your own account" }, 409);
        if (user.role === "admin" && (await activeAdminCount(env)) <= 1) return json({ error: "Kyro needs at least one administrator" }, 409);
        await env.SUBS.put(`user:${uname}`, JSON.stringify({ ...user, is_active: false }));
        return json({ removed: true });
      }
      return json({ error: "Not found" }, 404);
    }

    // ── Shared manual counts ──
    if (p.startsWith("/api/manual-counts")) {
      if (!canUsePage(me, "manual-count")) return json({ error: "You don't have access to Manual Count" }, 403);
      const canApprove = me.role === "admin" || me.role === "operator";

      if (p === "/api/manual-counts" && request.method === "GET") {
        const date = url.searchParams.get("date") || "";
        if (!validDate(date)) return json({ error: "date must be YYYY-MM-DD" }, 400);
        const page = await env.SUBS.list({ prefix: `mc:${date}:` });
        const rows = await Promise.all(page.keys.map((k) => env.SUBS.get(k.name, "json")));
        return json({ counts: rows.filter(Boolean).sort((a, b) => b.counted_at - a.counted_at), can_approve: canApprove });
      }
      if (p === "/api/manual-counts" && request.method === "PUT") {
        const body = await readBody(request);
        const date = String(body.date || "");
        const zone = cleanText(body.zone, 60);
        const count = Math.round(Number(body.count));
        if (!validDate(date) || !zone) return json({ error: "date and zone are required" }, 400);
        if (!Number.isFinite(count) || count < 0 || count > 1_000_000) return json({ error: "Invalid count" }, 400);
        const key = `mc:${date}:${zone.toLowerCase()}`;
        const prev = await env.SUBS.get(key, "json");
        const rec = {
          id: prev?.id || `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          zone, count, session_id: date,
          // Who counted comes from the signed-in account, not the request.
          counted_by: me.display_name || me.username,
          counted_by_user: me.username,
          counted_at: Math.floor(Date.now() / 1000),
          camera_also_counting: !!body.camera_also_counting,
          approved: false,
        };
        await env.SUBS.put(key, JSON.stringify(rec), { expirationTtl: MANUAL_COUNT_TTL_S });
        if (hooks?.notifyCount) ctx.waitUntil(hooks.notifyCount({
          kind: "count", zone, count, capacity: body.capacity, counted_by: rec.counted_by, sender_endpoint: body.sender_endpoint,
        }).catch(() => {}));
        return json({ count: rec, replaced: !!prev });
      }
      if (p === "/api/manual-counts" && request.method === "DELETE") {
        const date = url.searchParams.get("date") || "";
        const zone = cleanText(url.searchParams.get("zone"), 60);
        if (!validDate(date) || !zone) return json({ error: "date and zone are required" }, 400);
        const key = `mc:${date}:${zone.toLowerCase()}`;
        const rec = await env.SUBS.get(key, "json");
        if (!rec) return json({ removed: false });
        // Ushers may remove their own drafts; approved counts need an admin/operator.
        if (!canApprove && (rec.approved || rec.counted_by_user !== me.username)) {
          return json({ error: "Only an admin or operator can remove this count" }, 403);
        }
        await env.SUBS.delete(key);
        return json({ removed: true });
      }
      if (p === "/api/manual-counts/approve" && request.method === "POST") {
        if (!canApprove) return json({ error: "Only an admin or operator can approve the final count" }, 403);
        const body = await readBody(request);
        const date = String(body.date || "");
        if (!validDate(date)) return json({ error: "date must be YYYY-MM-DD" }, 400);
        const page = await env.SUBS.list({ prefix: `mc:${date}:` });
        const stamp = Math.floor(Date.now() / 1000);
        let approved = 0, total = 0;
        for (const k of page.keys) {
          const rec = await env.SUBS.get(k.name, "json");
          if (!rec) continue;
          total += rec.count || 0;
          if (!rec.approved) {
            approved++;
            await env.SUBS.put(k.name, JSON.stringify({ ...rec, approved: true, approved_at: stamp, approved_by: me.display_name || me.username }), { expirationTtl: MANUAL_COUNT_TTL_S });
          }
        }
        if (approved && hooks?.notifyCount) ctx.waitUntil(hooks.notifyCount({
          kind: "approved", count: total, counted_by: me.display_name || me.username, sender_endpoint: body.sender_endpoint,
        }).catch(() => {}));
        return json({ approved, total });
      }
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message || "Error" }, e.status || 500);
  }
}
