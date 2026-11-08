/**
 * Counting a picture must not destroy it.
 *
 * The thing being guarded against: the engine handed the picture's memory to
 * the background worker instead of copying it — one copy faster, but the
 * caller's picture is emptied the instant it is transferred. Kyro looks at the
 * same picture more than once (every tenth count it checks whether splitting
 * into tiles is worth it, and face codes are read from it afterwards), so the
 * second look found nothing there:
 *
 *   Counting problem: Failed to execute 'postMessage' on 'Worker':
 *   An ArrayBuffer is detached and could not be cloned.
 *
 *   node tests/test_picture_survives.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");

// 1. The source itself: no transfer list on the counting message.
{
  const line = src.split("\n").find((l) => l.includes('worker.postMessage({ type: "count"'));
  ok("a picture is sent to the worker", !!line);
  ok("and it is not handed over", !!line && !/\]\s*\)\s*;?\s*$/.test(line.trim()) && !line.includes("buffer"),
     `line: ${line?.trim()}`);
}

// 2. What the two ways actually do, with the real postMessage rules.
const picture = () => ({ data: new Uint8ClampedArray(4 * 8 * 8).fill(200), width: 8, height: 8 });

// The old way: transfer the buffer.
{
  const px = picture();
  const { port1, port2 } = new MessageChannel();
  port2.onmessage = () => {};
  port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } }, [px.data.buffer]);
  ok("the old way empties the caller's picture", px.data.byteLength === 0,
     `still ${px.data.byteLength} bytes`);

  let threw = null;
  try {
    port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } }, [px.data.buffer]);
  } catch (e) { threw = e; }
  ok("so looking at it a second time fails", !!threw);
  // Chrome words it "An ArrayBuffer is detached and could not be cloned";
  // Node says "Cannot transfer object of unsupported type". Same detached
  // buffer, same refusal to send it.
  ok("because the buffer is gone, not because of anything in the picture",
     /detached|unsupported type/i.test(String(threw?.message)), String(threw?.message));
  port1.close(); port2.close();
}

// The new way: copy it.
{
  const px = picture();
  const { port1, port2 } = new MessageChannel();
  port2.onmessage = () => {};
  port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } });
  ok("the new way leaves the picture whole", px.data.byteLength === 4 * 8 * 8);
  ok("the pixels are untouched", px.data[0] === 200 && px.data[px.data.length - 1] === 200);

  let threw = null;
  try {
    // Twice more: the tile check, then the face codes.
    port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } });
    port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } });
  } catch (e) { threw = e; }
  ok("the same picture can be counted again", threw === null, String(threw?.message));
  ok("and again, for the face codes", px.data.byteLength === 4 * 8 * 8);
  port1.close(); port2.close();
}

// 3. The worker still receives the pixels — a copy is a copy, not nothing.
{
  const px = picture();
  const { port1, port2 } = new MessageChannel();
  const got = await new Promise((resolve) => {
    port2.onmessage = (e) => resolve(e.data.px);
    port1.postMessage({ px: { data: px.data, width: px.width, height: px.height } });
  });
  ok("the worker gets every pixel", got.data.length === px.data.length && got.data[0] === 200);
  ok("and the right size with it", got.width === 8 && got.height === 8);
  port1.close(); port2.close();
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Kyro can look at the same picture twice.");
process.exit(fails ? 1 : 0);
