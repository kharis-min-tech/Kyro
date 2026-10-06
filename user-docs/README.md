# Kyro user guide

The help guide for Kyro's users: church staff, ushers and admins. Built with [VitePress](https://vitepress.dev).

```bash
npm install
npm run dev        # preview at http://localhost:5173
npm run build      # static site in .vitepress/dist
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
