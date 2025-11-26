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
const cssPath = path.resolve(cwd, 'static', 'style', 'label-icons.css')

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
  ensureDir(path.dirname(cssPath))

  // Optional metadata for colors
  const colorsPath = path.join(iconsDir, 'colors.json')
  const iconsMetaPath = path.join(iconsDir, 'icons.json')
  /** @type {Record<string,string>} */
  let colorMap = {}
  /** @type {Record<string,{color?:string}>} */
  let iconMeta = {}

  if (fs.existsSync(colorsPath)) {
    try {
      colorMap = JSON.parse(fs.readFileSync(colorsPath, 'utf8'))
    } catch {
      colorMap = {}
    }
  }
  if (fs.existsSync(iconsMetaPath)) {
    try {
      iconMeta = JSON.parse(fs.readFileSync(iconsMetaPath, 'utf8'))
    } catch {
      iconMeta = {}
    }
  }

  const entries = fs.readdirSync(iconsDir, { withFileTypes: true })
  const svgFiles = entries.filter(
    e => e.isFile() && e.name.toLowerCase().startsWith('file_type_') && e.name.toLowerCase().endsWith('.svg'),
  )

  const symbols = []
  /** @type {Record<string, string|null>} */
  const labelTints = {}

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

    // Determine tint name from icons metadata, if available
    let tint = null
    const meta = iconMeta[base]
    if (meta && typeof meta.color === 'string' && colorMap[meta.color]) {
      tint = meta.color
    }
    labelTints[type] = tint
  }

  const sprite = [
    '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">',
    ...symbols,
    '</svg>',
    '',
  ].join('\n')

  fs.writeFileSync(spritePath, sprite, 'utf8')

  // Persist label → tint mapping (tint may be null)
  const sortedKeys = Object.keys(labelTints).sort()
  const sortedMapping = {}
  for (const key of sortedKeys) {
    sortedMapping[key] = labelTints[key]
  }
  fs.writeFileSync(jsonPath, JSON.stringify(sortedMapping, null, 2) + '\n', 'utf8')

  // Generate CSS variables for all colors and per-label tint rules
  const cssLines = []
  if (Object.keys(colorMap).length > 0) {
    cssLines.push(':root {')
    for (const [name, value] of Object.entries(colorMap)) {
      cssLines.push(`  --label-icon-color-${name}: ${value};`)
    }
    cssLines.push('}')
    cssLines.push('')
  }

  cssLines.push('.label-icon {')
  cssLines.push('  fill: currentColor;')
  cssLines.push('}')
  cssLines.push('')

  for (const [label, tint] of Object.entries(sortedMapping)) {
    if (!tint || !colorMap[tint]) continue
    cssLines.push(`.label-icon--${label} {`)
    cssLines.push(`  color: var(--label-icon-color-${tint});`)
    cssLines.push('}')
  }
  cssLines.push('')

  fs.writeFileSync(cssPath, cssLines.join('\n'), 'utf8')

  console.log(`Wrote ${symbols.length} label icons to ${spritePath}`)
  console.log(`Wrote ${sortedKeys.length} canonical label entries with tints to ${jsonPath}`)
  console.log(`Wrote label icon styles to ${cssPath}`)
}

main()
