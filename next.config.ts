import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: 'export', // 'export' for github pages, but we use API route now.
  images: {
    unoptimized: true,
  },
  // Disable static optimization for proper client-side rendering
  reactStrictMode: true,
  
  // Webpack config for Buffer polyfills (used in dev mode with --webpack flag)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Provide polyfills for Node.js built-in modules in browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer/'),
        crypto: false,
        stream: false,
        fs: false,
        path: false,
      };
    }
    return config;
  },
  
  // Turbopack config (for future when we migrate away from webpack)
  turbopack: {
    resolveAlias: {
      // Buffer polyfill for Turbopack
      buffer: 'buffer/',
    },
  },
};

export default nextConfig;
