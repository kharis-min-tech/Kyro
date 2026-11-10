/**
 * The security findings, closed — and guarded so they cannot quietly reopen.
 *
 * Eight findings on the self-hosted backend (the FastAPI + Redis + Postgres
 * path, not the Cloudflare one). Each is checked here on the thing that was
 * actually wrong, not on a comment saying it was fixed.
 *
 *   node tests/test_security_findings.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
/**
 * The same file with its comments and docstrings taken out.
 *
 * These checks are about what the CODE does. A comment explaining what used
 * to be wrong has to mention the wrong thing by name, and a test that greps
 * the raw file then fails on the explanation rather than on the fault — which
 * teaches people to delete explanations. So the prose goes before the grep.
 */
const code = (f) => read(f)
  .replace(/"""[\s\S]*?"""/g, "")
  .replace(/^\s*#.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
/** Whitespace flattened, for matching a sentence that may have wrapped. */
const prose = (f) => read(f).replace(/\s+/g, " ");

const review = read("backend/api/routes/review.py");
const deps = read("backend/auth/dependencies.py");
const passwords = read("backend/auth/passwords.py");
const auth = read("backend/api/routes/auth.py");
const main = read("backend/main.py");
const setup = read("setup.sh");
const envEg = read(".env.example");

// ── 1. The role check no longer fails open ─────────────────────────────────
//
// It was enforced only while the question could be read back out of Redis.
// Expired key, missing key, malformed JSON, Redis down — the check was
// skipped and an operator could answer an admin-only spatial question. It was
// skippable on purpose: wait out the TTL, then answer.
{
  ok("1. the old 'check it if available' is gone", !/We check the stored request's review_type if available/.test(review));
  ok("1. the type is looked up in one place", /async def _review_type\(camera_id: str, review_id: str\) -> Optional\[str\]:/.test(review));
  ok("1. Redis first, then the pipeline that holds the same questions",
     /pipeline_registry\.get\(camera_id\)[\s\S]{0,400}review_queue/.test(review));
  ok("1. and when NEITHER can say, admin is required — it fails closed",
     /if review_type is None:\s*\n\s*if role != "admin":\s*\n\s*raise HTTPException\(\s*\n\s*403,/.test(review));
  ok("1. a known spatial question is still admin-only",
     /elif review_type in _ADMIN_ONLY_REVIEWS and role != "admin":/.test(review));
  ok("1. and which kinds those are is named once",
     /_ADMIN_ONLY_REVIEWS = \("stage_question", "zone_proposal"\)/.test(review));
  // The old shape must not come back: a bare `if raw:` guarding the check.
  ok("1. nothing guards the check on the cache being warm",
     !/if raw:\s*\n\s*try:\s*\n\s*req_data = json\.loads\(raw\)/.test(review));
}

// ── 2. Redis no longer blocks the event loop ───────────────────────────────
{
  ok("2. the async client is the one imported", /^import redis\.asyncio as redis$/m.test(review));
  ok("2. and every call is awaited",
     (review.match(/await _redis(_bytes)?\./g) ?? []).length >= 8
     && !/(?<!await )_redis(_bytes)?\.(get|publish|delete|keys)\(/.test(review));
}

// ── 3. One auth dependency, one Redis configuration ────────────────────────
{
  ok("3. the shadowing redefinition is gone",
     !/^async def require_admin_or_operator/m.test(review)
     && /from backend\.auth\.dependencies import .*require_admin_or_operator/.test(review));
  ok("3. and the two Redis clients share one configuration",
     /_REDIS_KWARGS = dict\(/.test(review)
     && /_redis = redis\.Redis\(\*\*_REDIS_KWARGS, decode_responses=True\)/.test(review)
     && /_redis_bytes = redis\.Redis\(\*\*_REDIS_KWARGS, decode_responses=False\)/.test(review));
}

// ── 4. Secrets are out of URLs ─────────────────────────────────────────────
//
// A query string is written to the web server's access log, to every proxy in
// front of it, and to the browser's history. A STATIC, NEVER-EXPIRING API key
// in one is a permanent key to the machine API sitting in a log file.
{
  ok("4. the API key query scheme is gone entirely",
     !/APIKeyQuery/.test(code("backend/auth/dependencies.py"))
     && !/api_key=/.test(code("backend/auth/dependencies.py")));
  ok("4. require_api_key takes a header and nothing else",
     /async def require_api_key\(\s*\n\s*header_key: Optional\[str\] = Security\(_api_key_header\),\s*\n\) -> str:/.test(deps));
  ok("4. and so does the worker-or-dashboard one",
     /if header_key and validate_api_key_value\(header_key\):/.test(deps));

  // What an <img> or a WebSocket gets instead: short-lived and watch-only.
  ok("4. there is a stream-only token", /def create_stream_token\(/.test(deps)
     && /"scope": "stream"/.test(deps));
  ok("4. it expires in minutes", /_STREAM_TOKEN_TTL_S = int\(os\.environ\.get\("KYRO_STREAM_TOKEN_TTL_S", "300"\)\)/.test(deps));
  ok("4. the query path accepts ONLY that",
     /if claims\.get\("scope"\) != "stream":/.test(deps));
  ok("4. and a stream token buys nothing anywhere else",
     /if claims\.get\("scope"\) == "stream":\s*\n\s*raise HTTPException\(/.test(deps));
  ok("4. there is somewhere to get one", /@router\.post\("\/stream-token"/.test(auth));

  // The dashboard has to actually use it.
  const api = read("dashboard/src/lib/api.ts");
  const seating = read("dashboard/src/app/seating/page.tsx");
  const ws = read("dashboard/src/hooks/usePipelineStream.ts");
  const useAuth = read("dashboard/src/hooks/useAuth.ts");
  ok("4. no session token is put in a URL anywhere",
     ![api, seating, ws].some((f) => /token=\$\{encodeURIComponent\(\s*localStorage/.test(f.replace(/\s+/g, " "))));
  ok("4. the stream URL asks for a stream token", /await streamQuery\(\)/.test(api));
  ok("4. so does the WebSocket", /const token = \(await streamToken\(\)\) \?\? "";/.test(ws));
  ok("4. and the seat snapshot", /await streamQuery\("&"\)/.test(seating));
  ok("4. signing out throws the cached one away", /forgetStreamToken\(\)/.test(useAuth));
}

// ── 5. Weak password hashes are upgraded, not accepted for ever ────────────
{
  ok("5. Kyro can tell a weak stored hash from a current one", /def needs_rehash\(hashed: str\) -> bool:/.test(passwords));
  ok("5. legacy rows count as weak", /if not hashed\.startswith\(f"\{_ALGORITHM\}\$"\):\s*\n\s*return True/.test(passwords));
  ok("5. and so does a PBKDF2 row with too few rounds",
     /return int\(hashed\.split\("\$", 2\)\[1\]\) < _ITERATIONS/.test(passwords));
  ok("5. signing in rewrites it", /if needs_rehash\(db_user\.hashed_password\):/.test(auth)
     && /db_user\.hashed_password = hash_password\(body\.password\)/.test(auth));
  ok("5. and NOBODY'S PASSWORD CHANGES — it is the same password, hashed properly",
     /NOBODY'S PASSWORD CHANGES/.test(auth));
  ok("5. a failed upgrade never costs anybody their sign-in",
     /except Exception:\s*\n\s*await db\.rollback\(\)[\s\S]{0,200}role = db_user\.role/.test(auth));
}

// ── 6. No published credentials, anywhere ──────────────────────────────────
{
  ok("6. setup.sh no longer prints a default login",
     !/kyro-admin-change-me/.test(code("setup.sh")));
  ok("6. it generates the secrets instead",
     /KYRO_JWT_SECRET": secrets\.token_hex\(32\)/.test(setup)
     && /KYRO_API_KEY": secrets\.token_hex\(32\)/.test(setup));
  ok("6. including the admin password, shown once", /Your admin login — write this down now/.test(setup));
  ok("6. and the database password, which the connection string follows",
     /DATABASE_URL=postgresql\+asyncpg:\/\/kyro:\{dbpw\}@postgres/.test(setup));
  ok("6. .env is written readable only by its owner", /chmod 600 \.env/.test(setup));
  ok("6. an existing .env is never overwritten", /Leaving your existing \.env alone/.test(setup));
  ok("6. and the template says plainly that its values are not secrets",
     /A placeholder that ships in a public repository is not a secret/.test(prose(".env.example")));
}

// ── 7. The startup refusal tells you how to get past it ────────────────────
{
  ok("7. it still refuses to start on the placeholder secret",
     /if os\.environ\.get\("KYRO_JWT_SECRET", _DEFAULT_JWT_SECRET\) == _DEFAULT_JWT_SECRET:/.test(main)
     && /raise RuntimeError\(/.test(main));
  ok("7. and now says what to do about it", /set -a && source \.env && set \+a/.test(main));
  ok("7. which is what the setup instructions tell you to run",
     /set -a && source \.env && set \+a/.test(setup));
}

// ── 8. The setup script checks its ground ──────────────────────────────────
{
  ok("8. it checks for python3, node, npm and openssl first",
     /need python3 /.test(setup) && /need node /.test(setup)
     && /need npm /.test(setup) && /need openssl /.test(setup));
  ok("8. and the Python version", /Kyro needs Python 3\.10 or newer/.test(setup));
  ok("8. it doesn't trample an existing virtual environment",
     /Using the Python environment that is already here/.test(setup));
  ok("8. it stops on the first error, and on an unset variable", /set -euo pipefail/.test(setup));
  ok("8. it says 4 terminals and lists 4",
     /open 4 terminals/.test(setup) && (setup.match(/echo "  Terminal \d/g) ?? []).length === 4);
  ok("8. and points at the folder it is actually in, not Kyro\\/Kyro",
     !/Kyro\/Kyro/.test(setup) && /in this folder \(\$ROOT\)/.test(setup));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Every finding closed, and guarded.");
process.exit(fails ? 1 : 0);
