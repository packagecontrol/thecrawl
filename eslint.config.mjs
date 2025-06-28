import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}", ".eleventy.js"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: {
    globals: globals.browser,
    ecmaVersion: "latest",
    sourceType: "module",
  } },
  { files: [".eleventy.js"], languageOptions: { globals: globals.node } },
  globalIgnores([
    "!.eleventy.js",
    "_site"
  ])
]);
