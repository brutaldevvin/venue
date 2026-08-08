import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // live sandbox + on-chain reads hit the network - give them room
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['packages/**/test/**/*.test.ts'],
    // workspace packages export raw .ts source
    server: { deps: { inline: [/@venue\//] } },
  },
})
