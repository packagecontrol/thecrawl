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
 *   label-icons.json         - { "<label>": "<tintName>|null", ... }
 *
 * Usage (from repo root):
 *   node util/build-label-icons.mjs
 */

const cwd = process.cwd()
const iconsDir = path.resolve(cwd, '.AFileIcon-icons')
const spritePath = path.resolve(cwd, 'static', 'label-icons.svg')
const jsonPath = path.resolve(cwd, 'label-icons.json')
const workspacePath = path.resolve(cwd, 'workspace.json')
const configPath = path.resolve(cwd, 'label-icons-config.json')

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

  /** @type {Set<string>} */
  const usedLabels = new Set()

  /** @type {Record<string, string>} */
  let aliases = {}

  // Load config (aliases)
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8')
      const cfg = JSON.parse(raw)
      if (cfg && typeof cfg === 'object') {
        if (cfg.aliases && typeof cfg.aliases === 'object') {
          aliases = cfg.aliases
        }
      }
    } catch {
      aliases = {}
    }
  }

  // Collect labels actually used in the workspace
  if (fs.existsSync(workspacePath)) {
    const raw = fs.readFileSync(workspacePath, 'utf8')
    const workspace = JSON.parse(raw)
    const packages = Object.values(workspace.packages)
    for (const pkg of packages) {
      const labels = pkg.labels ?? []
      for (const label of labels) {
        const key = label.trim().toLowerCase()
        if (!key) continue
        const canonical = (aliases[key] && aliases[key].trim().toLowerCase()) || key
        usedLabels.add(canonical)
      }
    }
  }

  // Optional metadata for per-icon tint names (color *names*, not hex)
  const iconsMetaPath = path.join(iconsDir, 'icons.json')
  /** @type {Record<string,{color?:string}>} */
  let iconMeta = {}

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

    const typeKey = type.trim().toLowerCase()
    // If we have a set of used labels, restrict icons to those labels (or alias targets)
    if (usedLabels.size > 0 && !usedLabels.has(typeKey)) {
      continue
    }

    const id = `label-icon-${type}`
    const filePath = path.join(iconsDir, fileName)
    const raw = fs.readFileSync(filePath, 'utf8')
    const symbol = extractSymbolFromSvg(raw, id)

    symbols.push(symbol)

    // Determine tint name from icons metadata, if available
    let tint = null
    const meta = iconMeta[base]
    if (meta && typeof meta.color === 'string') {
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

  console.log(`Wrote ${symbols.length} label icons to ${spritePath}`)
  console.log(`Wrote ${sortedKeys.length} canonical label entries with tints to ${jsonPath}`)
}

main()
