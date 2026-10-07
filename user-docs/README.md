# Kyro user guide

The help guide for Kyro's users: church staff, ushers and admins. Built with [VitePress](https://vitepress.dev).

```bash
npm install
npm run dev        # preview at http://localhost:5173
npm run build      # static site in .vitepress/dist
npx wrangler deploy  # publish to https://kyro-help.kharischurch.com
```

## Updating screenshots

Every screenshot has a light (`name.png`) and dark (`name-dark.png`) version in
`public/screenshots/`, captured from Demo mode by `scripts/capture-screenshots.mjs`.
After changing the dashboard, rebuild it and recapture:

```bash
cd ../dashboard && CF_PAGES=1 npm run build      # builds dashboard/out
# serve it with the Worker so /api works (notifications), e.g. `npx wrangler dev` from the repo root
cd ../user-docs
BASE_URL=http://localhost:8787 FIREFOX_PATH=/path/to/firefox npm run screenshots
```

Use `<Shot name="…" alt="…" />` in any page to show a framed screenshot that follows
the reader's light/dark theme (`phone` for phone shots, `size="card"` / `size="wide-card"`
for cropped cards).

## Re-recording the video tour

`public/videos/kyro-tour.mp4` is recorded from the live test site in Demo mode by
`scripts/record-tour.mjs` (Playwright, with an on-screen cursor and captions):

```bash
npm i -D playwright ffmpeg-static && npx playwright install chromium
node scripts/record-tour.mjs ./recording        # writes a .webm
npx ffmpeg-static -i recording/*.webm -c:v libx264 -crf 24 -pix_fmt yuv420p -movflags +faststart -an public/videos/kyro-tour.mp4
```

`worker/index.js` serves `/videos/*` with byte ranges so the video plays on iPhone/iPad.

### Voice-over

The narration is generated on this computer with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx)
(open-source, offline; voice `af_heart`) by `scripts/narrate-tour.py`, which times each line to the
captions. Re-run it after re-recording, then add the audio:

```bash
python scripts/narrate-tour.py ./kokoro-models narration.wav 143.4 af_heart
ffmpeg -i public/videos/kyro-tour.mp4 -i narration.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -movflags +faststart -shortest out.mp4
```
