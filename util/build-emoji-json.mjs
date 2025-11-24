import fs from 'fs'
import path from 'path'

// Usage:
//   node util/build-emoji-json.mjs [inputPath] [outputPath]
//
// - inputPath:  path to a gemoji-style JSON file
//               (defaults to "emoji-source.json" in repo root)
// - outputPath: path to write emoji.json map
//               (defaults to "emoji.json" in repo root)
//
// The input format is expected to be an array of objects like:
//   { emoji: "😀", aliases: ["grinning"], ... }
// as maintained by https://github.com/github/gemoji
//
// E.g.
// ```
// curl -L https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json -o emoji-source.json
// npm run build:emoji
// ```

function main() {
  const cwd = process.cwd()
  const inputPath = path.resolve(cwd, process.argv[2] || 'emoji-source.json')
  const outputPath = path.resolve(cwd, process.argv[3] || 'emoji.json')

  const raw = fs.readFileSync(inputPath, 'utf8')
  const data = JSON.parse(raw)

  if (!Array.isArray(data)) {
    throw new Error(`Expected array in ${inputPath}`)
  }

  /** @type {Record<string, string>} */
  const map = {}

  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const emoji = item.emoji
    const aliases = Array.isArray(item.aliases) ? item.aliases : []
    if (!emoji || !aliases.length) continue

    for (const alias of aliases) {
      const key = String(alias || '').trim()
      if (!key) continue
      if (!map[key]) {
        map[key] = emoji
      }
    }
  }

  const sortedEntries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  const sortedMap = Object.fromEntries(sortedEntries)

  fs.writeFileSync(outputPath, JSON.stringify(sortedMap, null, 2) + '\n', 'utf8')

  console.log(`Wrote ${sortedEntries.length} emoji shortcodes to ${outputPath}`)
}

main()
