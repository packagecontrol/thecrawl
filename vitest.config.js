import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['_site/**', 'node_modules/**'],
  },
})
