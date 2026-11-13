/**
 * Where to put a camera's photograph so that ONE SEAT fills the frame.
 *
 * "as i press one of the seats from the seat map, i should be able to see a
 * live view/section, i should be able to see the actual person and them on
 * the seat, not just a UI design."
 *
 * The panel showed the whole camera view, which on a hall camera is a
 * hundred chairs in a rectangle the size of a stamp. Kyro already knows
 * where each seat is in its camera's picture — that box is how it decides
 * the seat is taken at all — so the picture is slid and scaled until that
 * box is in the middle, and the box is drawn on top.
 *
 * The maths is here rather than in the component because it is the part
 * that can be wrong: a sign the wrong way round puts every seat in the
 * corner, and that is not something a type can catch.
 */

/** The picture every seat box is measured in — the one the AI is given, not
 *  the camera's own. See SEAT_W in seatFinder.ts. */
export const SEAT_SPACE_W = 1280;
export const SEAT_SPACE_H = 720;

/** How much wider than the seat itself to show. A chair filling the frame
 *  could be any chair in the building; its neighbours say which one. */
export const AROUND = 1.9;

export type Box = [number, number, number, number];

export interface CloseUp {
  /** The whole photograph, drawn this big and offset this far. */
  picW: number; picH: number; left: number; top: number;
  /** The seat's own box, in the frame's coordinates. */
  boxLeft: number; boxTop: number; boxW: number; boxH: number;
}

/** A seat Kyro has a real box for. */
export function usableBox(b?: Box | null): b is Box {
  return !!b && b.length === 4 && b.every((v) => Number.isFinite(v))
    && b[2] - b[0] >= 2 && b[3] - b[1] >= 2;
}

/**
 * @param bbox  the seat, in the 1280×720 picture
 * @param w,h   the frame it is being shown in, in pixels
 */
export function closeUp(bbox: Box, w: number, h: number, around = AROUND): CloseUp {
  const fx = (bbox[0] + bbox[2]) / 2 / SEAT_SPACE_W;
  const fy = (bbox[1] + bbox[3]) / 2 / SEAT_SPACE_H;
  const fw = Math.max(0.02, ((bbox[2] - bbox[0]) / SEAT_SPACE_W) * around);
  const fh = Math.max(0.02, ((bbox[3] - bbox[1]) / SEAT_SPACE_H) * around);
  /**
   * Big enough that the wanted part fills the frame, and no bigger.
   *
   * Both limits are worked out as a WIDTH, because that is what is being
   * chosen. fh is a fraction of the picture's height, so the height limit
   * has to be turned into a width through the picture's shape first —
   * comparing `w / fw` with `h / fh` directly compares a width with a
   * height, and quietly zooms in about twice as far as asked.
   */
  const picW = Math.min(w / fw, (h / fh) * (SEAT_SPACE_W / SEAT_SPACE_H));
  const picH = picW * (SEAT_SPACE_H / SEAT_SPACE_W);
  const left = w / 2 - fx * picW;
  const top = h / 2 - fy * picH;
  return {
    picW, picH, left, top,
    boxLeft: left + (bbox[0] / SEAT_SPACE_W) * picW,
    boxTop: top + (bbox[1] / SEAT_SPACE_H) * picH,
    boxW: ((bbox[2] - bbox[0]) / SEAT_SPACE_W) * picW,
    boxH: ((bbox[3] - bbox[1]) / SEAT_SPACE_H) * picH,
  };
}
