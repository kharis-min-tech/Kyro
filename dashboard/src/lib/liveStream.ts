/**
 * Live video from the browser that is counting, to anyone watching.
 *
 * A camera plugged into one computer can't be opened by another device — the
 * video genuinely cannot leave the computer it is plugged into on its own. So
 * everyone else was shown the still picture that computer sends every twenty
 * seconds, which looks exactly like a frozen camera, because for nineteen of
 * those twenty seconds it is one.
 *
 * Kyro already had the answer for the installed camera computer: while someone
 * is watching, it sends that camera's newest picture over and over down a
 * WebSocket, and the website passes each one straight on to whoever is
 * watching. Nobody watching, nothing sent, so no data is used for video. The
 * counting browser now speaks the same protocol:
 *
 *   website → us    {"watch": ["key", …]}   who is being watched right now
 *   us → website    [key length][key][JPEG] one frame
 *
 * Only cameras someone is actually looking at are sent, so a service with
 * nobody watching costs nothing.
 */

/** Pictures a second, per camera being watched. */
const FPS = 5;
/** Wider than this is wasted on a phone and costs real data. */
const WIDTH = 640;
const QUALITY = 0.5;

export interface LiveStreamOptions {
  /** The device token this browser registered with. */
  token: string;
  /** The newest picture from one camera, or null if it isn't counting. */
  frameFor: (key: string) => HTMLVideoElement | null;
}

export function startLiveStream({ token, frameFor }: LiveStreamOptions): () => void {
  if (typeof WebSocket === "undefined") return () => {};

  let ws: WebSocket | null = null;
  let stopped = false;
  let watching: string[] = [];
  let retry: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sending = false;
  const canvas = document.createElement("canvas");

  const send = async () => {
    // One frame at a time: a slow connection must not queue up a backlog of
    // stale pictures, which is worse than a lower frame rate.
    if (sending || !ws || ws.readyState !== WebSocket.OPEN || !watching.length) return;
    if (ws.bufferedAmount > 512 * 1024) return;
    sending = true;
    try {
      for (const key of watching) {
        const video = frameFor(key);
        if (!video || !video.videoWidth) continue;
        const scale = Math.min(1, WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
        if (!blob || !ws || ws.readyState !== WebSocket.OPEN) continue;
        const name = new TextEncoder().encode(key);
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        const out = new Uint8Array(1 + name.length + jpeg.length);
        out[0] = name.length;
        out.set(name, 1);
        out.set(jpeg, 1 + name.length);
        ws.send(out);
      }
    } catch { /* a dropped frame is not worth stopping for */ }
    sending = false;
  };

  const connect = () => {
    if (stopped) return;
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/api/devices/stream`, ["kyro", token]);
    } catch { return; }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const m = JSON.parse(ev.data);
        watching = Array.isArray(m.watch) ? m.watch.filter((k: unknown) => typeof k === "string") : [];
      } catch { /* not for us */ }
    };
    ws.onclose = () => {
      ws = null;
      watching = [];
      if (!stopped) retry = setTimeout(connect, 3000);
    };
    ws.onerror = () => { try { ws?.close(); } catch {} };
  };

  connect();
  timer = setInterval(send, Math.round(1000 / FPS));

  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(retry);
    try { ws?.close(); } catch {}
    ws = null;
  };
}
