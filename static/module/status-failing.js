/**
 * @typedef {{
 *   name: string,
 *   nameKey: string,
 *   signature: string,
 * }} FailingBlock
 */

/**
 * @typedef {{
 *   name: string,
 *   nameKey: string,
 *   anchorNameKey: string | null,
 * }} RemovedFailingBlock
 */

/**
 * Normalize notes to make markdown sections stable for parsing.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeStatusNotes(text) {
  return text
    .replace(/\r\n?/g, '\n')
    // Added 2026-01-11; delete after 2026-02-12
    .replace(/\*\*currently failing\*\*:\s*\n/gi, '#### Currently failing\n')
}

/**
 * Extract the "currently failing" section as newline-joined lines.
 *
 * Return values intentionally preserve legacy semantics:
 * - false: no notes available
 * - '': notes exist but no "currently failing" section
 * - string: normalized section body
 *
 * @param {string} notes
 * @returns {false | string}
 */
export function extractCurrentlyFailing(notes) {
  if (!notes) return false

  const normalized = normalizeStatusNotes(notes)
  const marker = '#### currently failing\n'
  const lower = normalized.toLowerCase()
  const idx = lower.indexOf(marker)
  if (idx === -1) return ''

  const slice = normalized.slice(idx + marker.length)
  return slice
    .split('\n')
    .map(line => line.trim())
    // Ignore trailing relative-date annotations like "[since 3 months]".
    .map(line => line.replace(/\s*\[[^\]]+\]\s*$/, ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * Parse currently failing notes into package blocks with signatures.
 *
 * @param {string} notes
 * @returns {FailingBlock[]}
 */
export function extractCurrentlyFailingBlocks(notes) {
  const section = extractCurrentlyFailing(notes)
  if (!section || section === false) return []

  const lines = section.split('\n')
  const blocks = []
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const packageMatch = /^-\s+\*\*(.+?)\*\*(?:\s+.*)?$/.exec(line)
    if (packageMatch) {
      if (current) {
        blocks.push(toFailingBlock(current))
      }
      current = {
        name: packageMatch[1].trim(),
        nameKey: normalizePackageNameKey(packageMatch[1]),
        details: [],
      }
      continue
    }

    if (current) {
      current.details.push(line)
    }
  }

  if (current) {
    blocks.push(toFailingBlock(current))
  }

  return blocks
}

/**
 * Compute changed and removed failing packages between two notes payloads.
 *
 * @param {string} currentNotes
 * @param {string} previousNotes
 * @returns {{ changedNames: Set<string>, removedBlocks: RemovedFailingBlock[] }}
 */
export function diffFailingPackages(currentNotes, previousNotes) {
  const currentBlocks = extractCurrentlyFailingBlocks(currentNotes)
  const previousBlocks = extractCurrentlyFailingBlocks(previousNotes)
  const currentByKey = new Map()
  const previousByKey = new Map()

  for (const block of currentBlocks) {
    currentByKey.set(block.nameKey, block)
  }
  for (const block of previousBlocks) {
    previousByKey.set(block.nameKey, block)
  }

  const changedNames = new Set()
  for (const block of currentBlocks) {
    const previous = previousByKey.get(block.nameKey)
    if (!previous || previous.signature !== block.signature) {
      changedNames.add(block.nameKey)
    }
  }

  const removedBlocks = []
  for (let i = 0; i < previousBlocks.length; i += 1) {
    const block = previousBlocks[i]
    if (currentByKey.has(block.nameKey)) continue

    let anchorNameKey = null
    for (let j = i + 1; j < previousBlocks.length; j += 1) {
      const anchor = previousBlocks[j]
      if (currentByKey.has(anchor.nameKey)) {
        anchorNameKey = anchor.nameKey
        break
      }
    }

    removedBlocks.push({
      name: block.name,
      nameKey: block.nameKey,
      anchorNameKey,
    })
  }

  return { changedNames, removedBlocks }
}

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizePackageNameKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function toFailingBlock(entry) {
  return {
    name: entry.name,
    nameKey: entry.nameKey,
    signature: [entry.name, ...entry.details].join('\n'),
  }
}
