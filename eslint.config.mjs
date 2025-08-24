import js from '@eslint/js'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'
import stylistic from '@stylistic/eslint-plugin'

export default defineConfig([
  stylistic.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}', '.eleventy.js'],
    plugins: { js, '@stylistic': stylistic },
    extends: ['js/recommended'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    files: ['.eleventy.js', '_data/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      '@stylistic/brace-style': 'off',
      '@stylistic/quote-props': 'off',
    },
  },
  globalIgnores([
    '!.eleventy.js',
    '_site',
  ]),
])
