import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)', // keep normal tests
      // run colocated tests in source
      'eleventy.filters.mjs',
      'eleventy.util.mjs',
    ],
  },
})
