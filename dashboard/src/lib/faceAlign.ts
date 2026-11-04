/**
 * Lining a face up before it is turned into a face code.
 *
 * SFace expects a 112×112 picture with the eyes, nose and mouth in fixed
 * places. Handing it a plain square crop barely tells people apart (on a quick
 * check, the same person scored 0.61 and different people 0.55 — useless).
 * Rotating and scaling the face onto those fixed points is what makes the codes
 * meaningful, and it's what OpenCV's alignCrop does for the installed counter.
 *
 * The five points YuNet gives us (right eye, left eye, nose, right mouth
 * corner, left mouth corner) are matched to the template below with a
 * similarity transform — one rotation, one scale, one shift, worked out by
 * least squares (Umeyama), so no single point can throw the whole face off.
 */

/** Where SFace expects the five points to land in a 112×112 picture. */
const TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],   // right eye
  [73.5318, 51.5014],   // left eye
  [56.0252, 71.7366],   // nose
  [41.5493, 92.3655],   // right mouth corner
  [70.7299, 92.2041],   // left mouth corner
];

export const FACE_SIZE = 112;

/** 2×3 affine matrix [[a,b,tx],[c,d,ty]] taking the face onto the template. */
export function alignTransform(points: [number, number][]): number[][] {
  const n = TEMPLATE.length;
  const mean = (pts: [number, number][]) => pts.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  const [sx, sy] = mean(points);
  const [dx, dy] = mean(TEMPLATE);

  // Covariance of the two point sets, and the spread of the source.
  let a = 0, b = 0, varSrc = 0;
  for (let i = 0; i < n; i++) {
    const px = points[i][0] - sx, py = points[i][1] - sy;
    const qx = TEMPLATE[i][0] - dx, qy = TEMPLATE[i][1] - dy;
    a += px * qx + py * qy;     // aligned part
    b += px * qy - py * qx;     // rotated part
    varSrc += px * px + py * py;
  }
  if (varSrc < 1e-6) return [[1, 0, 0], [0, 1, 0]];
  const scale = Math.hypot(a, b) / varSrc;
  const angle = Math.atan2(b, a);
  const cos = Math.cos(angle) * scale, sin = Math.sin(angle) * scale;
  return [
    [cos, -sin, dx - (cos * sx - sin * sy)],
    [sin, cos, dy - (sin * sx + cos * sy)],
  ];
}

/**
 * The aligned 112×112 face as SFace wants it: BGR, one colour plane after
 * another, values 0–255. Samples the source picture through the inverse of the
 * transform, so no separate warp step is needed.
 */
export function alignedFaceTensor(
  src: { data: Uint8ClampedArray; width: number; height: number },
  points: [number, number][],
): Float32Array {
  const m = alignTransform(points);
  // Invert the 2×3 affine so we can ask "which source pixel is this one?".
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0] || 1e-6;
  const i00 = m[1][1] / det, i01 = -m[0][1] / det, i10 = -m[1][0] / det, i11 = m[0][0] / det;
  const itx = -(i00 * m[0][2] + i01 * m[1][2]);
  const ity = -(i10 * m[0][2] + i11 * m[1][2]);

  const S = FACE_SIZE, plane = S * S;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sxf = i00 * x + i01 * y + itx;
      const syf = i10 * x + i11 * y + ity;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.round(sxf)));
      const y0 = Math.max(0, Math.min(src.height - 1, Math.round(syf)));
      const p = (y0 * src.width + x0) * 4;
      const i = y * S + x;
      out[i] = src.data[p + 2];              // blue
      out[plane + i] = src.data[p + 1];      // green
      out[2 * plane + i] = src.data[p];      // red
    }
  }
  return out;
}
