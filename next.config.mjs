/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['sharp'],
  // The live preview is proxied through the sandbox host; allow it for dev HMR.
  allowedDevOrigins: ['*.e2b.app', '*.arena.dev', 'localhost:3000'],
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), { 'node:sqlite': 'commonjs node:sqlite' }];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The app is shown inside the sandbox preview iframe (cross-origin),
          // so framing is restricted by CSP instead of the legacy header.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://*.e2b.app https://*.arena.dev" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
