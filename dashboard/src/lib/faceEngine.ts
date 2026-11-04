/**
 * Face codes, in the browser.
 *
 * Turns each person Kyro has counted into a list of 128 numbers describing
 * their face. Two uses, both from the same code:
 *
 *   - someone who went out of sight and came back isn't counted as arriving
 *     again (the main gain with one camera);
 *   - the same person seen by two cameras at once is only counted once (the
 *     website compares the codes it is sent).
 *
 * No photograph of anyone's face is kept or sent — only the numbers, and only
 * while a service is being recorded. Kyro never matches them against any list
 * of known people: it has no idea who anyone is.
 *
 * Models: OpenCV Zoo YuNet (finds faces) and SFace (turns one into numbers),
 * the same two the installed counter uses. On 600 standard face pairs, two
 * codes 0.40 or more alike were the same person 95.7% of the time, and never
 * once a different person.
 */

import { decodeFaces } from "@/lib/faceDetect";
import { modelBytes } from "@/lib/modelCache";
import { alignedFaceTensor, FACE_SIZE } from "@/lib/faceAlign";

/** Two codes this alike (or more) are the same person. Chosen on those 600 pairs. */
export const SAME_FACE = 0.4;
/** The face finder's input is fixed at this size. */
const FIND_SIZE = 640;
/** A face smaller than this in the picture gives an unreliable code. */
const MIN_FACE_PX = 24;

type Ort = any;   // onnxruntime-web, loaded at runtime

export interface FaceEngine {
  /** One code per person whose face is clear enough; same order, with gaps as null. */
  codesFor(px: ImageData, boxes: [number, number, number, number][]): Promise<(Float32Array | null)[]>;
}

function bgrPlanar(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const plane = w * h, t = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    t[i] = data[p + 2]; t[plane + i] = data[p + 1]; t[2 * plane + i] = data[p];
  }
  return t;
}

/** Scales a person's box into a square the face finder can take, keeping it in the picture. */
function headArea(box: [number, number, number, number], w: number, h: number) {
  const bw = box[2] - box[0], bh = box[3] - box[1];
  // The head is in the top third of a standing person, with room either side.
  const cx = (box[0] + box[2]) / 2, cy = box[1] + bh * 0.18;
  const side = Math.max(bw * 1.1, bh * 0.45, 64);
  const x = Math.max(0, Math.min(w - 1, cx - side / 2));
  const y = Math.max(0, Math.min(h - 1, cy - side / 2));
  return { x: Math.round(x), y: Math.round(y), side: Math.round(Math.min(side, w - x, h - y)) };
}

export async function loadFaceEngine(ort: Ort, onProgress?: (step: string) => void): Promise<FaceEngine> {
  onProgress?.("Downloading the face models (first time only)…");
  // Kept in the browser's store like the counting AI, so this is a one-off
  // download and not 10 MB on every page load.
  const get = (name: string) => modelBytes(`/models/${name}`);
  const [findBytes, codeBytes] = await Promise.all([get("face-find-v1.bin"), get("face-code-v1.bin")]);
  onProgress?.("Starting face matching…");
  const find = await ort.InferenceSession.create(findBytes, { executionProviders: ["wasm"] });
  const code = await ort.InferenceSession.create(codeBytes, { executionProviders: ["wasm"] });

  // One scratch canvas, reused — making one per face would thrash memory.
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(FIND_SIZE, FIND_SIZE)
    : Object.assign(document.createElement("canvas"), { width: FIND_SIZE, height: FIND_SIZE });
  const ctx = (canvas as OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;

  return {
    async codesFor(px, boxes) {
      const out: (Float32Array | null)[] = [];
      const src = new ImageData(px.data, px.width, px.height);
      for (const box of boxes) {
        const { x, y, side } = headArea(box, px.width, px.height);
        if (side < MIN_FACE_PX) { out.push(null); continue; }
        try {
          // The head area, stretched to the size the face finder wants.
          const bmp = await createImageBitmap(src, x, y, side, side);
          ctx.drawImage(bmp, 0, 0, FIND_SIZE, FIND_SIZE);
          bmp.close();
          const area = ctx.getImageData(0, 0, FIND_SIZE, FIND_SIZE);
          const found = decodeFaces(
            await find.run({ input: new ort.Tensor("float32", bgrPlanar(area.data, FIND_SIZE, FIND_SIZE), [1, 3, FIND_SIZE, FIND_SIZE]) }),
            FIND_SIZE, FIND_SIZE, 0.6,
          );
          if (!found.length) { out.push(null); continue; }
          const t = alignedFaceTensor({ data: area.data, width: FIND_SIZE, height: FIND_SIZE }, found[0].points);
          const r = await code.run({ data: new ort.Tensor("float32", t, [1, 3, FACE_SIZE, FACE_SIZE]) });
          const v = Float32Array.from(r[code.outputNames[0]].data as Float32Array);
          let n = 0; for (const z of v) n += z * z;
          n = Math.sqrt(n) || 1;
          for (let i = 0; i < v.length; i++) v[i] /= n;
          out.push(v);
        } catch {
          out.push(null);     // one awkward crop must never stop counting
        }
      }
      return out;
    },
  };
}

/** How alike two face codes are, 0–1. */
export function alike(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}
