/// <reference lib="webworker" />
/**
 * Camera Mode's background worker: holds the counting AI and counts each
 * picture the page sends, off the page's own thread, so the camera pictures
 * and buttons never freeze while it works.
 */
import { startEngine, countWith, type LocalEngine } from "@/lib/countEngine";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: LocalEngine | null = null;

ctx.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === "load") {
    try {
      engine = await startEngine((pct, step) => ctx.postMessage({ type: "progress", pct, step }));
      ctx.postMessage({ type: "ready", kind: engine.kind, backend: engine.backend });
    } catch (e) {
      ctx.postMessage({ type: "load-error", message: e instanceof Error ? e.message : String(e) });
    }
  } else if (m.type === "count" && engine) {
    try {
      const people = await countWith(engine, m.px);
      ctx.postMessage({ type: "result", id: m.id, people });
    } catch (e) {
      ctx.postMessage({ type: "count-error", id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
};
