/**
 * Is this picture worth asking somebody to look at?
 *
 * "this is not even a person, well what you are showing me" — a question
 * asking whether two people were the same, where one of the two pictures
 * was a near-black frame with a dark shape filling it. No face, no outline,
 * nothing anybody could answer from.
 *
 * Kyro kept ONE picture per person and replaced it every eight seconds with
 * whatever the latest one happened to be. A person is in shot for minutes,
 * so there are dozens of pictures of them and the one shown was simply the
 * most recent — which at a door, or during worship with the lights down, is
 * as likely as not to be the worst of them.
 *
 * So two things, and only one of them needs a number:
 *
 *   · keep the CLEAREST picture of somebody rather than the latest one.
 *     No threshold involved — whichever scores higher wins — and it can
 *     only improve what is shown.
 *
 *   · and refuse to ask at all when even the clearest is unanswerable.
 *     That one needs a line drawn, so it is drawn at the indefensible end:
 *     a picture that is almost entirely black. A dim hall during worship is
 *     still worth asking about; a black rectangle is not.
 *
 * Nothing here looks at WHO is in the picture. It is about whether there is
 * enough light in it to see anybody at all.
 */

/** Perceived brightness, 0–255. The green channel carries most of it. */
function brightness(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Darker than this and there is nothing to see — not "a dark coat", but
 * "no information". Well below the darkest skin or clothing a camera
 * still renders detail in.
 */
const NEARLY_BLACK = 32;

/**
 * A picture this black has nothing in it to answer from.
 *
 * Deliberately extreme. The job here is not to judge picture quality, it
 * is to catch the rectangle that is simply black, so a dim room is never
 * mistaken for a broken one.
 */
export const MOSTLY_BLACK = 0.85;

/** How many pixels to look at. Every Nth, so a big crop costs the same. */
const LOOK_AT = 1500;

export interface Clarity {
  /** How much of the picture is bright enough to show anything, 0–1. */
  lit: number;
  /** How far apart the brightest and darkest parts are, 0–1. */
  contrast: number;
  /** The two together: higher is a better picture to ask about. */
  score: number;
}

/**
 * Judge a picture from its pixels.
 *
 * Takes the raw RGBA a canvas gives back, so this can be measured without
 * a browser — see tests/test_a_picture_worth_asking_about.mjs.
 */
export function clarity(pixels: Uint8ClampedArray | number[], width: number, height: number): Clarity {
  // No pixels means no picture. Forcing a minimum of one here read past the
  // end of an empty array and made every figure NaN, which compares false
  // against any threshold — so an empty picture would have been treated as
  // worth asking about rather than as nothing at all.
  const pixelCount = Math.floor(Math.min(pixels.length / 4, width * height));
  if (!(pixelCount > 0)) return { lit: 0, contrast: 0, score: 0 };
  const step = Math.max(1, Math.floor(pixelCount / LOOK_AT));
  const seen: number[] = [];
  let litCount = 0;
  for (let i = 0; i < pixelCount; i += step) {
    const at = i * 4;
    const v = brightness(pixels[at], pixels[at + 1], pixels[at + 2]);
    seen.push(v);
    if (v >= NEARLY_BLACK) litCount++;
  }
  if (!seen.length) return { lit: 0, contrast: 0, score: 0 };
  const lit = litCount / seen.length;
  // The spread between a dark tenth and a bright tenth, rather than the
  // very darkest and brightest: one stray highlight — a ceiling lamp in
  // shot — must not make a black picture look full of detail.
  seen.sort((a, b) => a - b);
  const at = (f: number) => seen[Math.min(seen.length - 1, Math.floor(f * seen.length))];
  const contrast = Math.max(0, at(0.9) - at(0.1)) / 255;
  /**
   * Both matter, so they multiply.
   *
   * A picture that is bright but flat — a wall, a lens cap in daylight —
   * scores nothing on contrast. A picture that is black with one lamp in
   * it scores nothing on lit. Only a picture with light in it AND
   * something going on scores well, and that is what somebody can answer
   * a question from.
   */
  return { lit, contrast, score: lit * contrast };
}

/** The same, straight off a canvas. Returns null if the pixels can't be read. */
export function clarityOf(canvas: HTMLCanvasElement): Clarity | null {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return null;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return clarity(d, canvas.width, canvas.height);
  } catch {
    return null;   // a tainted canvas; judge it no worse than anything else
  }
}

/**
 * Is there enough in this picture to ask somebody about it?
 *
 * Only the black-rectangle case. Anything a person could squint at is
 * worth asking, because the alternative is silence and Kyro has been
 * silent about enough already.
 */
export function worthAskingAbout(c: Clarity | null): boolean {
  if (!c) return true;            // couldn't measure it — don't block on that
  return c.lit >= 1 - MOSTLY_BLACK;
}
