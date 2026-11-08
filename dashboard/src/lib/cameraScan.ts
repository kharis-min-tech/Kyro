/**
 * Deciding what "Scan" found.
 *
 * The Cameras page notes which cameras were already there when you opened it,
 * so that plugging one in and tapping Scan highlights the one you just added
 * rather than a list of built-in webcams.
 *
 * What that got wrong: the usual order is to plug the camera in FIRST and then
 * open Kyro to add it. Once the browser has been granted camera access for
 * good, that already-plugged camera is in the "was already there" list, so
 * nothing counts as new — and the page said "nothing was plugged in" about a
 * camera it could see perfectly well. It only ever worked before access was
 * granted permanently, because until then the browser hides the identifiers
 * and every camera looks new.
 *
 * So: nothing new is not a problem. It only means Kyro can't tell which one
 * you mean, and it should show them all and let you pick.
 */

export interface ScannedCamera {
  id: string;
  label: string;
}

export interface ScanOutcome {
  /** Cameras plugged in since the page was opened — highlighted on their own. */
  fresh: ScannedCamera[];
  /** Whether to open the full list straight away instead of hiding it. */
  showAll: boolean;
  /** Nothing is wrong, this just explains what you're looking at. */
  note: string | null;
  /** Something genuinely needs fixing. */
  problem: string | null;
}

export function scanOutcome(found: ScannedCamera[], alreadyThere: Set<string>): ScanOutcome {
  if (found.length === 0) {
    return {
      fresh: [], showAll: false, note: null,
      problem: "Kyro can't see any camera on this computer. Check the cable is pushed "
        + "in at both ends — then tap Scan again. If it's plugged into a hub or an "
        + "adapter, try it straight into the computer.",
    };
  }

  const fresh = found.filter((c) => !alreadyThere.has(c.id));
  if (fresh.length > 0) {
    return { fresh, showAll: false, note: null, problem: null };
  }

  const n = found.length;
  return {
    fresh: [],
    showAll: true,
    note: `Nothing has been plugged in since you opened this page, but Kyro can see `
      + `${n} camera${n === 1 ? "" : "s"} on this computer. ${n === 1 ? "It's" : "They're"} `
      + `listed below — pick the one you want. (This is normal if you plugged the camera `
      + `in before opening Kyro.)`,
    problem: null,
  };
}
