/**
 * The number a camera tile should show.
 *
 * Kyro had two different counters. "Counting on this computer" runs the real
 * one: YOLO11, shipped with the site, with tracking, arrivals and departures
 * and face matching. The tiles on Live and Attendance ran a second one —
 * TensorFlow's COCO-SSD, fetched from Google's servers every time the page
 * opened. Two counters meant two different answers for the same room, and
 * when the download was slow or blocked the tile sat on "Loading detector…"
 * for ever while the real engine was counting perfectly well a few pixels
 * away.
 *
 * There is one counter now. The tile reads the engine's figure for its camera
 * and says plainly when the engine isn't running, instead of pretending to
 * load something.
 */

export interface EngineView {
  key: string;
  label: string;
  count: number;
  streaming: boolean;
  error: string | null;
  countedAt: number;
}

/** "remote" = counted, but by another computer — nothing to say and nothing wrong. */
export type TileState = "counting" | "starting" | "off" | "problem" | "remote";

export interface TileCount {
  /** null whenever the figure would be a guess. */
  count: number | null;
  state: TileState;
  /** What to show instead of a number. null when counting. */
  message: string | null;
  /** The engine's name for this camera, when it was found. */
  key: string | null;
}

function tidy(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The engine's camera that this tile is showing.
 *
 * By its key first, which is exact. The website's camera_id is "device:key",
 * and the key is what the counting engine calls its own cameras — so the two
 * can be matched with certainty however the camera has been renamed.
 *
 * Matching on the name was the only way before, and it fails the moment
 * somebody renames a camera: the engine knows a webcam as "HD USB Camera
 * (046d:0825)" and the website knows it as "Entrance - Morning". Both tiles
 * then said "This camera isn't being counted" while the camera was being
 * counted perfectly well.
 */
export function matchView(views: EngineView[], cameraName: string | undefined, cameraId?: string): EngineView | null {
  const key = cameraId && cameraId.includes(":") ? cameraId.slice(cameraId.indexOf(":") + 1) : "";
  if (key) {
    const byKey = views.find((v) => v.key === key);
    if (byKey) return byKey;
  }
  const name = tidy(cameraName ?? "");
  if (name) {
    const hit = views.find((v) => {
      const label = tidy(v.label);
      return !!label && (label === name || name.includes(label) || label.includes(name));
    });
    if (hit) return hit;
  }
  // Falling back to "the only camera counting" is only safe when there was
  // nothing to match on. With a name that matched nothing, the honest answer
  // is that this camera isn't being counted — otherwise a second camera's
  // tile quietly shows the first one's figure for a room it can't see.
  const unnamed = views.length === 1 && (!name || !tidy(views[0].label));
  return unnamed ? views[0] : null;
}

export function tileCount(
  phase: "idle" | "starting" | "running" | null,
  views: EngineView[],
  cameraName: string | undefined,
  cameraId?: string,
  /**
   * The camera is reporting to the website right now — it is being counted,
   * just not by THIS computer. Most people looking at Kyro are on their phone
   * at the back of the hall, not on the machine doing the counting, and
   * telling them counting is off is simply false.
   */
  countedElsewhere = false,
): TileCount {
  const elsewhere: TileCount = { count: null, state: "remote", message: null, key: null };
  if (phase === null) return countedElsewhere ? elsewhere : { count: null, state: "off", message: "Counting is off", key: null };
  if (phase === "starting") return { count: null, state: "starting", message: "Starting…", key: null };
  if (phase === "idle") {
    return countedElsewhere ? elsewhere
      : { count: null, state: "off", message: "Counting is off — turn it on on the Cameras page", key: null };
  }

  const view = matchView(views, cameraName, cameraId);
  if (!view) {
    return countedElsewhere ? elsewhere
      : { count: null, state: "off", message: "This camera isn't being counted", key: null };
  }
  if (view.error) return { count: null, state: "problem", message: view.error, key: view.key };
  if (!view.streaming) return { count: null, state: "problem", message: "Camera not open", key: view.key };
  if (!view.countedAt) return { count: null, state: "starting", message: "Counting…", key: view.key };

  return { count: view.count, state: "counting", message: null, key: view.key };
}
