import type { Look } from "./personTracker";

/**
 * What someone looks like, roughly: the colour of what they are wearing above
 * and below the waist, and how tall and wide their shape is.
 *
 * Why this exists. A camera follows a person by where they were a moment ago.
 * That works until they step out of view — behind a pillar, behind the two
 * people coming through the door next — and it stops working within seconds,
 * because the patch of picture they were standing in is the same patch the
 * next person walks into. After that Kyro has to treat them as a stranger, and
 * a stranger leaving is a second departure that never happened.
 *
 * A face would settle it, but reading faces is biometric data under UK GDPR,
 * is off unless the church has switched it on with a DPIA and notices at the
 * doors, and is wiped when a service ends. This is the much weaker, much less
 * intrusive thing that can be done without any of that: a navy coat over grey
 * trousers, about so tall. It cannot tell anyone apart in a crowd and is not
 * meant to — it is only ever asked "is this the same person who was standing
 * here four seconds ago?", and when more than one person fits, it answers no.
 *
 * It is never stored, never sent anywhere, and never written down. It lives on
 * the track in this browser's memory and dies with it, within minutes.
 */

/**
 * Colour as a share of the light rather than an amount of it, so the same coat
 * reads the same in a bright doorway and a dim corridor. Brightness is kept
 * separately, and counts for much less.
 */
function band(px: ImageData, x0: number, x1: number, y0: number, y1: number): [number, number, number] | null {
  let r = 0, g = 0, b = 0, n = 0;
  // Every third pixel in each direction: a ninth of the work, same answer.
  for (let y = Math.max(0, y0); y < Math.min(px.height, y1); y += 3) {
    for (let x = Math.max(0, x0); x < Math.min(px.width, x1); x += 3) {
      const i = (y * px.width + x) * 4;
      r += px.data[i]; g += px.data[i + 1]; b += px.data[i + 2];
      n++;
    }
  }
  if (n < 12) return null;            // too small a patch to mean anything
  r /= n; g /= n; b /= n;
  const sum = r + g + b || 1;
  return [r / sum, g / sum, (r + g + b) / 765];
}

/**
 * A person's look, from the picture they were found in.
 *
 * The middle 60% of their width only, so the background either side of them
 * doesn't get mixed in. Head and feet are left out: hair and floor say more
 * about the room than the person.
 */
export function lookOf(px: ImageData, box: [number, number, number, number]): Look | null {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 16) return null;   // too small to read anything from
  const lx = Math.round(x0 + w * 0.2), rx = Math.round(x1 - w * 0.2);
  const top = band(px, lx, rx, Math.round(y0 + h * 0.15), Math.round(y0 + h * 0.5));
  const bottom = band(px, lx, rx, Math.round(y0 + h * 0.55), Math.round(y0 + h * 0.9));
  if (!top || !bottom) return null;
  return { top, bottom, shape: h / Math.max(1, w), height: h / Math.max(1, px.height) };
}
