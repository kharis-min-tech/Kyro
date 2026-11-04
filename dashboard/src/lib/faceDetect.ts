/**
 * Reading YuNet's output: where the faces are, and the five points on each one.
 *
 * The model doesn't hand back a tidy list. It reports on a grid at three
 * scales — every 8, 16 and 32 pixels — and for each square says how likely a
 * face is centred there, plus where its edges and its five points sit relative
 * to that square. This turns all that into faces in picture coordinates.
 *
 * The same thing OpenCV's FaceDetectorYN does for the installed counter; the
 * browser has no OpenCV, so it is written out here.
 */

export interface Face {
  score: number;
  box: [number, number, number, number];
  /** Right eye, left eye, nose, right mouth corner, left mouth corner. */
  points: [number, number][];
}

const STRIDES = [8, 16, 32];

/** Model output tensors, by name (cls_8, obj_8, bbox_8, kps_8, cls_16 …). */
export type YuNetOutputs = Record<string, { data: Float32Array | number[] }>;

function overlap(a: Face, b: Face): number {
  const ix = Math.max(0, Math.min(a.box[2], b.box[2]) - Math.max(a.box[0], b.box[0]));
  const iy = Math.max(0, Math.min(a.box[3], b.box[3]) - Math.max(a.box[1], b.box[1]));
  const i = ix * iy;
  const u = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) + (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - i;
  return u > 0 ? i / u : 0;
}

/**
 * @param out    what the model returned
 * @param width  the width the picture was given to the model at
 * @param height the height likewise
 * @param minScore how sure it must be (0–1)
 */
export function decodeFaces(out: YuNetOutputs, width: number, height: number, minScore = 0.6): Face[] {
  const faces: Face[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`]?.data, obj = out[`obj_${s}`]?.data;
    const bbox = out[`bbox_${s}`]?.data, kps = out[`kps_${s}`]?.data;
    if (!cls || !obj || !bbox || !kps) continue;
    const cols = Math.ceil(width / s), rows = Math.ceil(height / s);
    for (let i = 0; i < rows * cols; i++) {
      // Both heads are already probabilities; multiplying them is what the
      // reference implementation does, then it takes the square root.
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
      if (score < minScore) continue;
      const col = i % cols, row = Math.floor(i / cols);
      const cx = (col + bbox[i * 4]) * s;
      const cy = (row + bbox[i * 4 + 1]) * s;
      const w = Math.exp(bbox[i * 4 + 2]) * s;
      const h = Math.exp(bbox[i * 4 + 3]) * s;
      const points: [number, number][] = [];
      for (let k = 0; k < 5; k++) {
        points.push([(col + kps[i * 10 + k * 2]) * s, (row + kps[i * 10 + k * 2 + 1]) * s]);
      }
      faces.push({ score, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], points });
    }
  }
  // One face can be reported by several squares: keep the surest of each group.
  faces.sort((a, b) => b.score - a.score);
  const kept: Face[] = [];
  for (const f of faces) {
    if (kept.some((k) => overlap(k, f) > 0.3)) continue;
    kept.push(f);
    if (kept.length >= 64) break;
  }
  return kept;
}
