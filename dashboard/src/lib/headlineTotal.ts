/**
 * The big number at the top of Attendance.
 *
 * It is made of up to three things, and the rule for the third one changed
 * underneath it.
 *
 *   - what the cameras report,
 *   - plus anything counted by hand today,
 *   - plus cameras counting in this browser.
 *
 * That last line was right when a camera plugged into someone's laptop was
 * invisible to Kyro's server: the only way its people appeared in the total
 * was for this page to add them. It isn't right any more. A browser counting
 * people now reports them like any other camera, so the server's figure
 * already contains them — and adding them here counted every one of them
 * twice. Twenty people in the room, forty in the headline.
 *
 * So: add the browser's own counts only when the server doesn't have them.
 *
 * And one more, which changes what `base` even means: when a camera is on the
 * doorway, "how many people are in the building" is everyone who has come in
 * less everyone who has gone out — not what the cameras can see. A camera
 * watching a door sees eleven people, then six, then twenty, as they walk
 * through it; those are arrivals, and they should add up.
 */

export interface HeadlineParts {
  /** What the cameras report right now (or the day's figure, for a past day). */
  base: number;
  /** Counted by hand today. */
  manualToday: number;
  /** Cameras counting in this browser, right now. */
  browserNow: number;
  /** Whether `base` already includes those browser cameras. */
  serverHasBrowserCameras: boolean;
  /** Today, rather than a day in the past. */
  isToday: boolean;
  /** Which figure is being shown. */
  metric: string;
  /**
   * People in the building, counted at the door (came in − went out), or null
   * when no camera is watching a door well enough to say. When there is one it
   * is the better answer for "how many people are here", and replaces what the
   * cameras happen to see.
   */
  inBuilding?: number | null;
}

/** The metrics that are a number of people, and so can be added to. */
const HEADCOUNT = ["people", "entries"];

export function headlineTotal(p: HeadlineParts): number {
  if (!p.isToday || !HEADCOUNT.includes(p.metric)) return p.base;
  const browser = p.serverHasBrowserCameras ? 0 : p.browserNow;
  // "People" with a door camera: the door's running total, not the view.
  // "Entries" is already a running total and is left alone.
  const base = p.metric === "people" && typeof p.inBuilding === "number" ? p.inBuilding : p.base;
  return base + p.manualToday + browser;
}
