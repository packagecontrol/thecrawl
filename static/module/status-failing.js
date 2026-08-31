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
 * Annotate entries with failuresChanged + glitchStartIndex metadata.
 *
 * Entries must be sorted newest-first. The lookback walk advances forward in
 * the array (towards older entries).
 *
 * @template {{ notes?: string, conclusion?: string }} T
 * @param {T[]} entries
 * @param {{ lookback?: number, maxSkippedHardFailures?: number }} [options]
 * @returns {(T & {
 *   failuresChanged: boolean,
 *   failureChangeNames: Set<string>,
 *   glitchStartIndex: number | null,
 * })[]}
 */
export function annotateChanges(entries, {
  lookback = 10,
  maxSkippedHardFailures = 4,
} = {}) {
  const sections = entries.map(entry => extractCurrentlyFailing(entry.notes || ''))

  return entries.map((entry, idx) => {
    /** @type {false | string} */
    const rawSection = sections[idx]
    /** @type {string} */
    const section = rawSection || ''

    const previous = findComparablePreviousSection(
      entries,
      sections,
      idx + 1,
      maxSkippedHardFailures,
    )
    const previousSection = previous.section
    const hasPrevious = typeof previousSection !== 'undefined' && previousSection !== false
    // Keep previousSection un-normalized so false (no notes) differs from ''
    // (notes, no failing section).
    const failuresChanged = hasPrevious && section !== previousSection
    const failureChangeNames = failuresChanged
      ? failureChangeNamesBetween(entry, entries[previous.index])
      : new Set()
    let glitchStartIndex = null

    if (failuresChanged && rawSection !== false) {
      const maxIdx = Math.min(sections.length - 1, idx + lookback)
      let matchIndex = null

      for (let i = idx + 1; i <= maxIdx; i += 1) {
        const candidate = sections[i]
        if (candidate === false) continue
        if ((candidate || '') === section) {
          matchIndex = i
          break
        }
      }

      if (matchIndex !== null) {
        const startIndex = findGlitchStartIndex(
          entries,
          sections,
          matchIndex - 1,
          idx,
          maxSkippedHardFailures,
        )
        if (startIndex !== null) {
          glitchStartIndex = startIndex
        }
      }
    }

    return { ...entry, failuresChanged, failureChangeNames, glitchStartIndex }
  })
}

/**
 * @template {{ notes?: string, conclusion?: string }} T
 * @param {T[]} entries
 * @param {(false | string)[]} sections
 * @param {number} startIndex
 * @param {number} maxSkippedHardFailures
 * @returns {{ index: number, section: false | string | undefined }}
 */
export function findComparablePreviousSection(entries, sections, startIndex, maxSkippedHardFailures) {
  let skippedHardFailures = 0

  for (let i = startIndex; i < sections.length; i += 1) {
    const section = sections[i]
    if (section === false && isHardFailureWithoutNotes(entries[i])) {
      skippedHardFailures += 1
      if (skippedHardFailures > maxSkippedHardFailures) {
        return { index: -1, section: undefined }
      }
      continue
    }

    return { index: i, section }
  }

  return { index: -1, section: undefined }
}

/**
 * @template {{ notes?: string, conclusion?: string }} T
 * @param {T[]} entries
 * @param {(false | string)[]} sections
 * @param {number} startIndex
 * @param {number} minIndex
 * @param {number} maxSkippedHardFailures
 * @returns {number | null}
 */
export function findGlitchStartIndex(entries, sections, startIndex, minIndex, maxSkippedHardFailures) {
  let skippedHardFailures = 0

  for (let i = startIndex; i >= minIndex; i -= 1) {
    const section = sections[i]
    if (section === false && isHardFailureWithoutNotes(entries[i])) {
      skippedHardFailures += 1
      if (skippedHardFailures > maxSkippedHardFailures) {
        return null
      }
      continue
    }
    if (section === false) {
      return null
    }

    return i
  }

  return null
}

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
 * Extract number of crawled packages from status notes.
 *
 * @param {string | undefined} notes
 * @returns {number | null}
 */
export function extractPackagesCrawled(notes) {
  if (!notes) return null
  const match = /found\s+([\d,]+)\s+packages?\s+to\s+crawl/i.exec(notes)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
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
 * Map a workflow conclusion to a status-dot class.
 *
 * @param {string | undefined} conclusion
 * @returns {'' | 'error' | 'warn' | 'muted'}
 */
export function classForConclusion(conclusion) {
  const normalized = (conclusion || '').toLowerCase()
  if (normalized === 'success') return ''
  if (['failure', 'failed', 'cancelled', 'timed_out'].includes(normalized)) return 'error'
  if (['action_required', 'neutral', 'stale'].includes(normalized)) return 'warn'
  return 'muted'
}

/**
 * Map an entry to its status-dot class. When a package is locked, only paint a
 * changed dot when that package's failing state caused the change.
 *
 * @param {{
 *   conclusion?: string,
 *   failuresChanged?: boolean,
 *   failureChangeNames?: Set<string>,
 * } | undefined} entry
 * @param {string} [lockedPackageName]
 * @returns {'' | 'error' | 'warn' | 'muted' | 'changed'}
 */
export function classForEntry(entry, lockedPackageName = '') {
  const base = classForConclusion(entry?.conclusion)
  if (!entry?.failuresChanged || base === 'error') return base

  const packageNameKey = normalizePackageNameKey(lockedPackageName)
  if (packageNameKey && !entry.failureChangeNames?.has(packageNameKey)) {
    return base
  }
  return 'changed'
}

/**
 * @param {{ notes?: string } | undefined} currentEntry
 * @param {{ notes?: string } | undefined} previousEntry
 * @returns {Set<string>}
 */
function failureChangeNamesBetween(currentEntry, previousEntry) {
  const diff = diffFailingPackages(
    currentEntry?.notes || '',
    previousEntry?.notes || '',
  )
  const names = new Set(diff.changedNames)
  for (const block of diff.removedBlocks) {
    names.add(block.nameKey)
  }
  return names
}

/**
 * @param {{ notes?: string, conclusion?: string } | undefined} entry
 * @returns {boolean}
 */
export function isHardFailureWithoutNotes(entry) {
  return !entry?.notes && classForConclusion(entry?.conclusion) === 'error'
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
