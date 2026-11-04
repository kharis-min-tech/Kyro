/**
 * Keeping Kyro's AI files in the browser, so they download once and never again.
 *
 * There are five: two for the counting AI it uses on a good computer, one for
 * the lighter counting AI, and two for face matching — about 70 MB in all.
 * They are downloaded once and kept in the browser's own store, so opening
 * Kyro again starts in seconds instead of downloading them all over.
 *
 * This used to go wrong, badly. Kyro starts the light AI first (so counting
 * begins quickly) then quietly upgrades to the accurate one, and the old
 * tidy-up step threw away every file that wasn't the one being loaded at that
 * moment — so each AI deleted the other, and every page load downloaded 60 MB
 * again. Hence one list of every file the current Kyro uses, in one place, and
 * a tidy-up that only removes files that are not on it.
 */

/** Every AI file this version of Kyro uses. Names carry their version, so a
 *  new model is a new name here and the old one is cleared out on its own.
 *  tests/test_model_cache.mjs checks this matches what's actually shipped. */
export const MODEL_FILES = [
  "yolo11m1280-w16-v1.part0.bin",
  "yolo11m1280-w16-v1.part1.bin",
  "yolo11s-w16-v1.part0.bin",
  "face-find-v1.bin",
  "face-code-v1.bin",
] as const;

const STORE = "kyro-models";

async function store(): Promise<Cache | null> {
  return "caches" in globalThis ? await caches.open(STORE).catch(() => null) : null;
}

/** True if this file is one the current Kyro uses. */
function current(url: string): boolean {
  return MODEL_FILES.some((f) => url.endsWith(`/models/${f}`));
}

/**
 * One AI file, from the browser's store if it's there and off the internet if
 * it isn't. Church Wi-Fi drops, so a failed download is retried a few times
 * before giving up.
 */
export async function modelResponse(url: string): Promise<Response> {
  const c = await store();
  const kept = c ? await c.match(url) : undefined;
  if (kept) return kept;

  let net: Response | null = null;
  for (let attempt = 0; attempt < 4 && !net; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try {
      const got = await fetch(url, { cache: "force-cache" });
      if (got.ok) net = got;
    } catch { /* try again */ }
  }
  if (!net) throw new Error("Couldn't download the AI — check the internet connection, then try again");
  if (c) await c.put(url, net.clone()).catch(() => {});
  return net;
}

/** The whole file, as bytes. */
export async function modelBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await modelResponse(url)).arrayBuffer());
}

/**
 * Clears out AI files left over from an older version of Kyro. Safe to call
 * whenever: it only removes files that are not on the list above.
 */
export async function forgetOldModels(): Promise<void> {
  try {
    const c = await store();
    if (!c) return;
    for (const req of await c.keys()) {
      if (!current(req.url)) await c.delete(req).catch(() => {});
    }
  } catch { /* tidying up is never worth interrupting counting for */ }
}
