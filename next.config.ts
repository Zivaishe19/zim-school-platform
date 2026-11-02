import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Self-hosted in Docker as long-running containers (tenant connection caches need them).
  output: "standalone",
  poweredByHeader: false,
  // Off deliberately: almost every page here is per-user, per-school data. We prefer explicit
  // dynamic rendering over any risk of one user's render being cached for another.
  // Revisit per-route for public pages (e.g. admissions landing pages) later.
  cacheComponents: false,
  // Uploads (proof of payment, documents) are capped at 5 MB in storage.ts; allow multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
