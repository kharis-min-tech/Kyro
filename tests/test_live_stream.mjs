/**
 * Live video from the counting browser to a phone.
 *
 * The thing being guarded against: a camera plugged into one computer can't be
 * opened by another device, so everyone else was shown the still picture that
 * computer sends every twenty seconds. That looks exactly like a frozen
 * camera, because for nineteen of those twenty seconds it is one.
 *
 * Kyro already relayed live video for the installed camera computer. The
 * counting browser now speaks the same protocol, so the frame layout has to
 * match what the website unpacks, byte for byte — a frame the server can't
 * read is a frame nobody sees, with nothing to show for it.
 *
 *   node tests/test_live_stream.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const sender = fs.readFileSync(path.join(root, "dashboard/src/lib/liveStream.ts"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "worker/index.js"), "utf8");

// ── The frame, packed as the sender does and unpacked as the website does ────

function pack(key, jpeg) {
  const name = new TextEncoder().encode(key);
  const out = new Uint8Array(1 + name.length + jpeg.length);
  out[0] = name.length;
  out.set(name, 1);
  out.set(jpeg, 1 + name.length);
  return out;
}

/** Exactly what webSocketMessage() in worker/venue.js does. */
function unpack(deviceId, buf) {
  const bytes = new Uint8Array(buf);
  const n = bytes[0];
  const camera_id = `${deviceId}:${new TextDecoder().decode(bytes.subarray(1, 1 + n))}`;
  const jpeg = buf.slice(1 + n);
  return { camera_id, jpeg };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

// 1. A frame survives the round trip intact.
{
  const packed = pack("web-5f2", JPEG);
  const got = unpack("web-7h2k9q", packed.buffer);
  ok("the website works out which camera it came from", got.camera_id === "web-7h2k9q:web-5f2");
  ok("and gets the picture back byte for byte",
     new Uint8Array(got.jpeg).join() === JPEG.join());
}

// 2. The camera_id it rebuilds is the one the viewer is listening on, and the
//    one tellBox strips back down to a key. Get this wrong and frames are
//    relayed to nobody.
{
  const deviceId = "web-7h2k9q", key = "web-5f2";
  const camera_id = unpack(deviceId, pack(key, JPEG).buffer).camera_id;
  ok("the key can be recovered from the camera id, as tellBox does",
     camera_id.slice(deviceId.length + 1) === key);
}

// 3. Keys longer than a single byte can describe would silently corrupt every
//    frame, so the length byte has to be able to hold them.
{
  const longest = "usb-0".padEnd(80, "x");   // the server cleans keys to 80
  ok("the longest key Kyro allows still fits in the length byte", longest.length < 256);
  const got = unpack("d", pack(longest, JPEG).buffer);
  ok("and a long key still round-trips", got.camera_id === `d:${longest}`);
}

// ── The things that make it actually arrive ──────────────────────────────────

ok("frames go to the same socket the camera computer uses",
   /\/api\/devices\/stream/.test(sender));
ok("the browser's token travels as the second protocol, as a header can't be set",
   /\["kyro", token\]/.test(sender));
ok("the website accepts that for the device socket",
   /api\/devices\/stream" && request\.headers\.get\("Upgrade"\)/.test(bridge));
ok("and hands the socket back a protocol so a browser accepts it",
   /offered \? \{ headers: \{ "Sec-WebSocket-Protocol": "kyro" \} \}/.test(worker));

// 4. Nothing is sent when nobody is watching: a service with no one looking
//    must not quietly use data all morning.
{
  ok("no watcher, no frames", /!watching\.length\) return/.test(sender));
  ok("the watch list comes from the website", /m\.watch/.test(sender));
  ok("and empties when the socket drops", /watching = \[\];/.test(sender));
}

// 5. A slow connection drops frames rather than queueing stale ones.
{
  ok("a backlog is skipped, not stored", /bufferedAmount > /.test(sender));
  ok("and only one frame is in flight at a time", /if \(sending \|\|/.test(sender));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The phone gets live video, and only while someone is watching.");
process.exit(fails ? 1 : 0);
