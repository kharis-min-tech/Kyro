/// <reference lib="webworker" />
/**
 * Camera Mode's background worker: holds the counting AI and counts each
 * picture the page sends, off the page's own thread, so the camera pictures
 * and buttons never freeze while it works.
 */
import { startEngine, countWith, seatingWith, ensureFast, type LocalEngine } from "@/lib/countEngine";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: LocalEngine | null = null;
/** Loading the quick AI for a doorway camera, started the first time one asks. */
let fastLoading = false;

ctx.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === "load") {
    try {
      engine = await startEngine(
        (pct, step) => ctx.postMessage({ type: "progress", pct, step }),
        m.prefer,
        (kind) => ctx.postMessage({ type: "settled", kind }),
      );
      ctx.postMessage({ type: "ready", kind: engine.kind, backend: engine.backend });
    } catch (e) {
      ctx.postMessage({ type: "load-error", message: e instanceof Error ? e.message : String(e) });
    }
  } else if (m.type === "count" && engine) {
    try {
      // A doorway camera wants the quick AI. If it isn't here yet, fetch it in
      // the background and count with what we have meanwhile — never make a
      // camera wait for a download.
      if (m.fast && !engine.fast && !fastLoading) {
        fastLoading = true;
        ensureFast(engine).catch(() => {}).finally(() => { fastLoading = false; });
      }
      // Chairs, benches and sofas instead of people: the same model, one look,
      // asked for every few minutes so the seats can be found automatically.
      const people = m.seating
        ? await seatingWith(engine, m.px)
        : await countWith(engine, m.px, m.tiles, m.fast);
      ctx.postMessage({ type: "result", id: m.id, people });
    } catch (e) {
      ctx.postMessage({ type: "count-error", id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
};
