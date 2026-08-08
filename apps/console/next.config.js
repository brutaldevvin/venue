/** @type {import('next').NextConfig} */
module.exports = {
  transpilePackages: ['@venue/core', '@venue/cleanverse'],
  // Standalone traces only the files actually imported, so the runtime image does not need
  // the pnpm store or the workspace's dev dependencies.
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: require('node:path').join(__dirname, '../../'),
  },
}
