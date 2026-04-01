import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // pdfjs-dist tries to require('canvas') in Node — stub it out
    if (isServer) {
      config.resolve = config.resolve || {}
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      }
    }
    return config
  },
  // Turbopack equivalent for dev mode
  turbopack: {
    resolveAlias: {
      canvas: { browser: '' },
    },
  },
}

export default nextConfig
