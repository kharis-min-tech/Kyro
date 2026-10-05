/** @type {import('next').NextConfig} */

// Cloudflare Pages sets CF_PAGES=1 automatically during its build.
// When it does, emit a pure static HTML export to `out/` so Pages can
// serve the dashboard as static assets (no Node server needed).
// Everywhere else — the NAS, local dev — keep `standalone`, which is
// what the self-hosted `docker compose` deployment needs.
const isCloudflarePages = process.env.CF_PAGES === "1" || process.env.CF_PAGES === "true";

const nextConfig = {
  output: isCloudflarePages ? "export" : "standalone",

  // Static export cannot run the Next.js image optimiser (no Node server
  // to resize images on the fly) — so pass images through unmodified
  // when exporting. On the NAS the optimiser still runs normally.
  images: {
    unoptimized: isCloudflarePages,
  },

  // Keep trailing slashes consistent — Cloudflare Pages's static router
  // is happier with directory-style URLs than extensionless files.
  trailingSlash: isCloudflarePages,

  // Harmless on standalone; required by some static-export edge cases.
  reactStrictMode: true,
};

export default nextConfig;
