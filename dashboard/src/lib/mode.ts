/**
 * "Is this a demo?" and "is there a backend?" are two questions.
 *
 * Fifteen files each carried their own copy of this line:
 *
 *     localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL
 *
 * …under the name inDemoMode. The second half reads "there is no FastAPI
 * backend" as "this is a demo". That variable is unset on every Cloudflare
 * build — which is the one the church runs. So on the live site, counting a
 * live service, all fifteen said DEMO.
 *
 * Mostly that was harmless, because the code asked `isEdgeLive()` first and
 * only fell back to this. Where it was not harmless it was invisible: the
 * seat panel drew a diagram of coloured dots labelled SCHEMATIC instead of
 * the camera, on a live site, for ever, whatever the cameras were doing.
 *
 * So the two questions have two names now:
 *
 *   noBackend()   — there is no FastAPI server to call. True on the edge
 *                   whether live or demo. This is what most of those call
 *                   sites actually meant: on the edge, sessions and the rest
 *                   are kept in the browser because there is nowhere else.
 *   inDemoMode()  — this is a demonstration. The figures are invented.
 *                   Never true while the edge is live.
 */
import { isEdgeLive } from "./edgeAuth";

/** No FastAPI backend to call — a Cloudflare build, live or demo. */
export function noBackend(): boolean {
  return typeof window !== "undefined"
    && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);
}

/** A demonstration: the figures are invented. Live cameras are never this. */
export function inDemoMode(): boolean {
  return noBackend() && !isEdgeLive();
}
