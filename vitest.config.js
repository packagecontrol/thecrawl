import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)', // keep normal tests
      'eleventy.filters.mjs', // ALSO run colocated tests in source
    ],
  },
})
