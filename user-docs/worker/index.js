/**
 * Serves the user guide's static files, adding byte-range support for
 * /videos/* — Safari on iPhone/iPad won't play an MP4 unless the server
 * answers "Range" requests with 206 Partial Content, which plain static
 * assets don't do. Everything else goes straight to the assets.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);
    if (!url.pathname.startsWith("/videos/") || request.method !== "GET" || !res.ok) return res;

    const range = request.headers.get("Range");
    const body = new Uint8Array(await res.arrayBuffer());
    const size = body.byteLength;
    const headers = new Headers(res.headers);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=86400");

    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      headers.set("Content-Length", String(size));
      return new Response(body, { status: 200, headers });
    }
    let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
    if (m[1] === "" && m[2] === "") start = 0;
    if (start < 0) start = 0;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  },
};
