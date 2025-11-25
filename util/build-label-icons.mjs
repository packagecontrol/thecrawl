import fs from 'fs'
import path from 'path'

/**
 * Build an SVG sprite and JSON mapping for label icons based on
 * SVGs from `.AFileIcon-icons`.
 *
 * Input:
 *   .AFileIcon-icons/file_type_<label>.svg
 *
 * Outputs:
 *   static/label-icons.svg   - <symbol> sprite sheet
 *   label-icons.json         - ["python", "js", "vercel", ...] (canonical labels)
 *
 * Usage (from repo root):
 *   node util/build-label-icons.mjs
 */

const cwd = process.cwd()
const iconsDir = path.resolve(cwd, '.AFileIcon-icons')
const spritePath = path.resolve(cwd, 'static', 'label-icons.svg')
const jsonPath = path.resolve(cwd, 'label-icons.json')

function ensureDir(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true })
  }
}

function extractSymbolFromSvg(content, id) {
  const viewBoxMatch = content.match(/viewBox="([^"]+)"/i)
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 16 16'

  // Strip outer <svg ...>...</svg>
  const svgOpenIndex = content.indexOf('<svg')
  const svgCloseIndex = content.lastIndexOf('</svg>')
  let inner = content
  if (svgOpenIndex !== -1 && svgCloseIndex !== -1) {
    const afterOpen = content.indexOf('>', svgOpenIndex)
    if (afterOpen !== -1 && afterOpen + 1 <= svgCloseIndex) {
      inner = content.slice(afterOpen + 1, svgCloseIndex)
    }
  }

  return `<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`
}

function main() {
  if (!fs.existsSync(iconsDir)) {
    console.error(`Icons directory not found: ${iconsDir}`)
    console.error('Run `node util/fetch-file-icons.mjs` first.')
    process.exitCode = 1
    return
  }

  ensureDir(path.dirname(spritePath))

  const entries = fs.readdirSync(iconsDir, { withFileTypes: true })
  const svgFiles = entries.filter(
    e => e.isFile() && e.name.toLowerCase().startsWith('file_type_') && e.name.toLowerCase().endsWith('.svg'),
  )

  const symbols = []
  /** @type {string[]} */
  const labels = []

  for (const entry of svgFiles) {
    const fileName = entry.name
    const base = fileName.replace(/\.svg$/i, '')
    const type = base.replace(/^file_type_/, '')
    if (!type) continue

    const id = `label-icon-${type}`
    const filePath = path.join(iconsDir, fileName)
    const raw = fs.readFileSync(filePath, 'utf8')
    const symbol = extractSymbolFromSvg(raw, id)

    symbols.push(symbol)
    labels.push(type)
  }

  const sprite = [
    '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">',
    ...symbols,
    '</svg>',
    '',
  ].join('\n')

  fs.writeFileSync(spritePath, sprite, 'utf8')
  labels.sort()
  fs.writeFileSync(jsonPath, JSON.stringify(labels, null, 2) + '\n', 'utf8')

  console.log(`Wrote ${symbols.length} label icons to ${spritePath}`)
  console.log(`Wrote ${labels.length} canonical label names to ${jsonPath}`)
}

main()
