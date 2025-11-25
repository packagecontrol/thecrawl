import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Fetch the AFileIcon repository and copy its SVG icons into
 * a local cache directory `.AFileIcon-icons` in the project root.
 *
 * Usage (from repo root):
 *   node util/fetch-file-icons.mjs
 *
 * This script:
 *   - clones https://github.com/SublimeText/AFileIcon.git into a temp folder
 *   - copies the contents of icons/svg into .AFileIcon-icons
 */

const repoUrl = 'https://github.com/SublimeText/AFileIcon.git'
const cwd = process.cwd()
const tempDir = path.resolve(cwd, '.AFileIcon-tmp')
const srcIconsDir = path.join(tempDir, 'icons', 'svg')
const destIconsDir = path.resolve(cwd, '.AFileIcon-icons')

function rimraf(targetPath) {
  if (!fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function ensureDir(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true })
  }
}

function main() {
  console.log(`Fetching AFileIcon icons from ${repoUrl}`)

  rimraf(tempDir)
  ensureDir(path.dirname(tempDir))

  try {
    execSync(`git clone --depth 1 ${repoUrl} "${tempDir}"`, {
      stdio: 'inherit',
    })
  } catch (err) {
    console.error('Failed to clone AFileIcon:', err.message)
    process.exitCode = 1
    return
  }

  if (!fs.existsSync(srcIconsDir)) {
    console.error(`Source icons directory not found: ${srcIconsDir}`)
    process.exitCode = 1
    return
  }

  rimraf(destIconsDir)
  ensureDir(destIconsDir)

  const entries = fs.readdirSync(srcIconsDir, { withFileTypes: true })
  const svgFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.svg'))

  for (const entry of svgFiles) {
    const src = path.join(srcIconsDir, entry.name)
    const dest = path.join(destIconsDir, entry.name)
    fs.copyFileSync(src, dest)
  }

  console.log(`Copied ${svgFiles.length} SVG icons into ${destIconsDir}`)

  // Clean up the temporary clone
  rimraf(tempDir)
}

main()
