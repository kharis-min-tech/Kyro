/**
 * Every query is answered with an index, however long Kyro has been running.
 *
 * Found by sweeping, not by being told, and it would never have been
 * reported as a bug: nothing is wrong on the screen, it just gets slower
 * every day.
 *
 * The history is one row per camera per minute and is never pruned, because
 * it IS the attendance record — "do not delete historical records". Nine of
 * the twelve places that read it ask for a stretch of TIME across every
 * camera, and the only index began with camera_id, which SQLite cannot seek
 * with unless that column is fixed. So each of those was a full scan of the
 * whole table plus a temporary sort.
 *
 * Measured on a year of two cameras — 1,051,200 rows — reading one day:
 *
 *     SCAN history + TEMP B-TREE ....... 48 ms
 *     SEARCH history USING history_ts ... 1 ms
 *
 *   node tests/test_the_history_does_not_get_slower.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── 1. A table built exactly as the worker builds it ──────────────────────
const db = new DatabaseSync(":memory:");
// The statements are not always on one line with their exec call.
for (const m of worker.matchAll(/"(CREATE (?:TABLE|INDEX) IF NOT EXISTS[^"]+)"/g)) {
  try { db.exec(m[1]); } catch { /* a table this test does not need */ }
}
// The columns added later, as the worker adds them with ALTER TABLE.
for (const col of ["people INTEGER", "door_people INTEGER", "deleted_at INTEGER"]) {
  try { db.exec(`ALTER TABLE history ADD COLUMN ${col}`); } catch { /* already there */ }
}
{
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='history'").all().map((r) => r.name);
  ok("1. the history is indexed by time", idx.includes("history_ts"), idx.join(", "));
  ok("1. and by camera and time", idx.includes("history_cam_ts"), idx.join(", "));
}

// ── 2. Every read the worker makes is answered with an index ──────────────
//
// Not "the index exists" — each query the worker actually runs, put to
// SQLite, and asked how it would answer.
{
  const reads = [...worker.matchAll(/"(SELECT [^"]*FROM history[^"]*)"/g)].map((m) => m[1]);
  ok(`2. found the reads in the worker (${reads.length})`, reads.length >= 8, `${reads.length}`);
  const scans = [];
  for (const q of reads) {
    const args = (q.match(/\?/g) ?? []).map(() => 0);
    let plan;
    try { plan = db.prepare("EXPLAIN QUERY PLAN " + q).all(...args).map((r) => r.detail).join(" | "); }
    catch (e) { scans.push(`${q.slice(0, 60)}… → could not plan: ${e.message}`); continue; }
    if (/SCAN history(?! USING)/.test(plan)) scans.push(`${q.slice(0, 70)}…\n        ${plan}`);
  }
  ok("2. none of them scans the whole history", scans.length === 0, scans.join("\n      "));
}

// ── 3. And it stays that way as the table grows ───────────────────────────
//
// The point of the index is that the cost stops growing with the table.
{
  const ins = db.prepare("INSERT INTO history (ts, camera_id, current, entries, exits, capacity, people) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const start = Date.now() - 120 * 86_400_000;
  db.exec("BEGIN");
  for (let i = 0; i < 120 * 24 * 60; i++) {
    const t = start + i * 60_000;
    ins.run(t, "box:a", 5, 1, 1, 0, 5);
    ins.run(t, "box:b", 3, 1, 1, 0, 3);
  }
  db.exec("COMMIT");
  const rows = db.prepare("SELECT COUNT(*) n FROM history").get().n;
  const q = "SELECT camera_id, ts, current FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts < ? ORDER BY ts";
  const day = [Date.now() - 86_400_000, Date.now()];
  const plan = db.prepare("EXPLAIN QUERY PLAN " + q).all(...day).map((r) => r.detail).join(" | ");
  ok(`3. with ${rows.toLocaleString()} rows it still seeks rather than scans`,
     /SEARCH history USING INDEX history_ts/.test(plan), plan);
  ok("3. and does not need a temporary sort", !/TEMP B-TREE/.test(plan), plan);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) db.prepare(q).all(...day);
  const ms = (performance.now() - t0) / 5;
  ok(`3. a day's reading out of four months takes ${ms.toFixed(1)} ms`, ms < 15, `${ms}`);
}

// ── 4. Nothing is deleted to make it fast ─────────────────────────────────
//
// The history IS the attendance record. "Do not delete or rewrite
// historical records to make the dashboard appear correct."
{
  const deletes = [...worker.matchAll(/DELETE FROM history([^"]*)/g)].map((m) => m[1]);
  ok("4. history is only ever deleted when somebody deleted it",
     deletes.every((d) => /deleted_at IS NOT NULL/.test(d)), deletes.join(" | "));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
