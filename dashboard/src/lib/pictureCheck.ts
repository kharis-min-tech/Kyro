/**
 * Is this picture any use?
 *
 * A camera with a connection and a black picture is not a working camera, and
 * a camera that froze twenty minutes ago is still handing Kyro the frame it
 * froze on. Both look perfectly healthy from every direction except this one:
 * frames arrive, counting runs, the tile says Live, and the count is zero
 * because there is nothing in the picture to count.
 *
 * This is the one place that can tell, because it is the only place that sees
 * the pixels. Both checks are deliberately cheap — a sample of the pixels, a
 * few thousand additions — because they run on every count.
 *
 * The HuddleCam at Kharis has done exactly this at 1920x1080: opens, reports
 * frames, sends black. Kyro already steps down to a smaller size when a camera
 * sends NO picture; a black picture is the same fault wearing a disguise, and
 * is now treated the same way.
 */

/** Below this average brightness (0–255) there is nothing in the picture. */
export const BLACK_BELOW = 12;
/** Frames this alike are the same frame. 0–1, where 1 is identical. */
export const SAME_FRAME = 0.999;
/** This many identical frames in a row means the camera has stopped. */
export const FROZEN_AFTER = 8;

/**
 * How sharp a picture has to be before Kyro says it has gone soft.
 *
 * ── Why this is worth measuring ────────────────────────────────────────────
 *
 * "HD Pro Webcam C920 — always loses focus."
 *
 * A webcam is built for a face at arm's length and refocuses whenever the
 * picture changes. A hall's picture changes constantly, so it hunts — and a
 * blurred frame is, to the counting AI, a frame with fewer people in it.
 * Nobody is "not counted"; they were never in focus to be found.
 *
 * Kyro can be asked to hold a camera's focus still (see holdFocus), and some
 * cameras and browsers simply refuse. So this is the other half: NOTICE it.
 * A camera quietly handing over soft pictures looks exactly like a quiet
 * morning, which is the worst thing a fault can look like.
 *
 * The number is the average difference between neighbouring pixels. A sharp
 * picture of a room full of people has edges everywhere — faces, chair backs,
 * door frames. A blurred one has the same brightness and the same colours and
 * almost no edges, which is precisely what separates the two.
 *
 * Judged against the camera's OWN best, never against a fixed number: a dim
 * hall on a winter evening has less detail in it than a sunlit one, and
 * neither is a fault. What is a fault is a camera that was sharp ten minutes
 * ago and is not now.
 */
export const SOFT_BELOW = 0.45;
/** Sharp readings to learn from before judging anything. */
export const SHARP_SAMPLES = 20;

export interface PictureLook {
  /** Average brightness, 0–255. */
  brightness: number;
  /** A cheap summary of the picture, for telling it from the next one. */
  signature: number[];
  /** How much detail there is: the average difference between neighbouring
   *  pixels. Edges, in a word. See SOFT_BELOW. */
  detail: number;
}

/**
 * Look at a picture: how bright it is, and a signature for comparing it with
 * the next one.
 *
 * The signature is the average brightness of a 4×4 grid of the picture. Two
 * frames of a room with people in it differ somewhere in that grid; two copies
 * of one frozen frame do not. It is sixteen numbers, so comparing them costs
 * nothing, and it cannot be turned back into a picture of anybody.
 */
export function lookAt(px: ImageData, step = 16): PictureLook {
  const { data, width, height } = px;
  const cells = new Float64Array(16), counts = new Float64Array(16);
  let total = 0, n = 0;
  for (let y = 0; y < height; y += step) {
    const row = Math.min(3, Math.floor((y / height) * 4));
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      // Rough brightness. The exact formula doesn't matter; "is there anything
      // here at all" is not a subtle question.
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const col = Math.min(3, Math.floor((x / width) * 4));
      cells[row * 4 + col] += v; counts[row * 4 + col]++;
      total += v; n++;
    }
  }
  /**
   * How much detail there is, as the average difference between pixels a
   * short way apart.
   *
   * Walked along the middle rows only, at the same stride as everything else
   * here, so it costs about what the brightness already costs. A sharp
   * picture of a hall has edges all through it; a blurred one has the same
   * brightness, the same colours, and almost no edges.
   *
   * Divided by the brightness, so a dim room is not mistaken for a soft
   * picture — the question is how much CONTRAST there is for the light
   * available, not how much light there is.
   */
  let edges = 0, pairs = 0;
  for (let y = Math.floor(height / 4); y < Math.floor((height * 3) / 4); y += step) {
    for (let x = step; x < width - step; x += step) {
      const a2 = (y * width + x) * 4, b2 = (y * width + (x - step)) * 4;
      edges += Math.abs((data[a2] + data[a2 + 1] + data[a2 + 2]) - (data[b2] + data[b2 + 1] + data[b2 + 2])) / 3;
      pairs++;
    }
  }
  const brightness = n ? total / n : 0;
  return {
    brightness,
    signature: Array.from(cells, (sum, i) => (counts[i] ? sum / counts[i] : 0)),
    detail: pairs && brightness > 1 ? edges / pairs / brightness : 0,
  };
}

/** How alike two pictures are, 0–1. Identical frames give 1. */
export function alike(a: PictureLook | null, b: PictureLook | null): number {
  if (!a || !b) return 0;
  let diff = 0;
  for (let i = 0; i < 16; i++) diff += Math.abs(a.signature[i] - b.signature[i]);
  // Sixteen cells, each 0–255: a different scene moves this a long way.
  return Math.max(0, 1 - diff / (16 * 4));
}

/**
 * Watches one camera's pictures and says when they stop being any use.
 *
 * Deliberately slow to complain and quick to forgive: one dark frame while
 * somebody walks past the lens is not a black camera, and a still room is not
 * a frozen camera — which is why the signature is a grid rather than one
 * number, and why it takes several identical frames in a row.
 */
export class PictureWatch {
  private last: PictureLook | null = null;
  private same = 0;
  /** The picture has nothing in it. */
  black = false;
  /** The same picture over and over: the camera has stopped. */
  frozen = false;
  /**
   * The picture has gone soft — the camera is hunting for focus.
   *
   * Judged against this camera's own best, not a fixed number: a dim hall has
   * less detail in it than a sunlit one and neither is a fault. See
   * SOFT_BELOW.
   */
  soft = false;
  private sharpest = 0;
  private sharpSeen = 0;
  /** The camera's best detail reading so far, for saying how far it has
   *  fallen. */
  get bestDetail(): number { return this.sharpest; }
  /** How many identical frames in a row, for saying how long it has been. */
  get stuckFor(): number { return this.same; }

  /** Returns true when the camera's state has just changed, so it is worth saying. */
  saw(px: ImageData): boolean {
    const look = lookAt(px);
    const wasBlack = this.black, wasFrozen = this.frozen;
    this.black = look.brightness < BLACK_BELOW;
    if (alike(this.last, look) >= SAME_FRAME) this.same++;
    else this.same = 0;
    this.last = look;
    this.frozen = this.same >= FROZEN_AFTER;
    // Learn what sharp looks like on THIS camera, in THIS room, before
    // judging anything — and only from pictures worth learning from.
    const wasSoft = this.soft;
    if (!this.black && !this.frozen) {
      if (look.detail > this.sharpest) this.sharpest = look.detail;
      this.sharpSeen++;
      this.soft = this.sharpSeen >= SHARP_SAMPLES && this.sharpest > 0
        && look.detail < this.sharpest * SOFT_BELOW;
    }
    return this.black !== wasBlack || this.frozen !== wasFrozen || this.soft !== wasSoft;
  }

  /**
   * The camera has been told to focus again, so what "sharp" means here has
   * to be learned again: the old best was measured through a lens focused
   * somewhere else, and judging the new picture against it would call a
   * freshly focused camera soft for ever.
   */
  forgetSharpness(): void { this.soft = false; this.sharpest = 0; this.sharpSeen = 0; }

  /** The camera was reopened: start again rather than carry a stale complaint. */
  reset(): void {
    this.last = null; this.same = 0; this.black = false; this.frozen = false;
    // What sharp looks like is a fact about this camera pointed at this room.
    // Reopened, it may be pointed somewhere else entirely.
    this.soft = false; this.sharpest = 0; this.sharpSeen = 0;
  }
}
