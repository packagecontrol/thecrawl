import fs from 'fs'
import { createHash } from 'crypto'

export const RENDERED_READMES_ENVIRONMENT_KEY = '__environment'

export function createReadmeRendererEnvironmentHash() {
  const hash = createHash('sha256')
  const files = [
    ['util/render-readmes.mjs', new URL('./render-readmes.mjs', import.meta.url)],
    ['static/readme-renderer.mjs', new URL('../static/readme-renderer.mjs', import.meta.url)],
    ['util/readme-render-cache.mjs', new URL(import.meta.url)],
    ['package-lock.json', new URL('../package-lock.json', import.meta.url)],
  ]

  for (const [name, url] of files) {
    hash.update(`${name}\0`)
    hash.update(fs.readFileSync(url))
    hash.update('\0')
  }

  return hash.digest('base64')
}

export function createReadmeSourceHash(text) {
  return createHash('sha256').update(text).digest('base64')
}
