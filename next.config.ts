import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // Development previews are served from a per-port subdomain
  // (e.g. https://3101-<sandbox>.e2b.app) while `next dev` listens on
  // localhost. Next.js blocks cross-origin /_next/* requests in development by
  // default, which leaves such a preview without JavaScript or CSS (403 on
  // every chunk). Development-only setting; it has no effect on production.
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev', '*.e2b.ai'],
  serverExternalPackages: ['@prisma/client', 'better-auth'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
