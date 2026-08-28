export const MIN_NOTES_SEARCH_CHARS = 2

const SEARCH_TOKEN_CACHE_LIMIT = 2048
const searchTokenCache = new Map()

/**
 * Compile a notes query into a matcher. Queries shorter than the minimum are
 * inactive. Terms match at token starts so "style" finds both "this-style"
 * and "ThatStyle", without also finding "lifestyle".
 *
 * @param {string} query
 * @returns {((notes: string) => boolean) | null}
 */
export function createNotesMatcher(query) {
  const value = String(query || '').trim()
  if ([...value].length < MIN_NOTES_SEARCH_CHARS) return null

  const queryTokens = tokenizeSearchText(value)
  if (!queryTokens.length) return null

  return (notes) => {
    const noteTokens = tokenizeSearchText(notes)
    return queryTokens.every(queryToken => (
      noteTokens.some(noteToken => noteToken.startsWith(queryToken))
    ))
  }
}

/**
 * Match literal mentions of one canonical package name. Longer known package
 * names take precedence, so LSP does not match LSP-pyright and Scheme does not
 * match Color Scheme.
 *
 * @param {string} packageName
 * @param {Iterable<string>} [knownPackageNames]
 * @returns {((notes: string) => boolean) | null}
 */
export function createPackageNotesMatcher(packageName, knownPackageNames = []) {
  const canonicalName = normalizeLiteralText(packageName).trim()
  if (!canonicalName) return null

  const namePattern = new RegExp(escapeRegExp(canonicalName), 'giu')
  const longerNameExtensions = packageNameExtensions(canonicalName, knownPackageNames)
  const matchCache = new Map()
  return (notes) => {
    const rawNotes = String(notes || '')
    if (matchCache.has(rawNotes)) return matchCache.get(rawNotes)

    const canonicalSource = normalizeLiteralText(rawNotes)
    namePattern.lastIndex = 0
    let match = namePattern.exec(canonicalSource)
    while (match) {
      const start = match.index
      const end = start + match[0].length
      if (
        hasPackageNameBoundaries(canonicalSource, start, end)
        && !isInsideLongerPackageName(
          canonicalSource,
          start,
          end,
          longerNameExtensions,
        )
      ) {
        matchCache.set(rawNotes, true)
        return true
      }
      match = namePattern.exec(canonicalSource)
    }
    matchCache.set(rawNotes, false)
    return false
  }
}

/**
 * Find the next entry matching an active notes search. Returns -1 when there
 * is no match in the requested direction.
 *
 * @param {{ notes?: string }[]} entries
 * @param {number} currentIndex
 * @param {number} direction
 * @param {(notes: string) => boolean} matcher
 * @returns {number}
 */
export function findNextNotesMatchIndex(entries, currentIndex, direction, matcher) {
  if (!Array.isArray(entries) || typeof matcher !== 'function' || direction === 0) {
    return -1
  }

  const step = direction < 0 ? -1 : 1
  for (let i = currentIndex + step; i >= 0 && i < entries.length; i += step) {
    if (matcher(entries[i]?.notes || '')) return i
  }
  return -1
}

/**
 * Find the nearest forward point inside a fixed corridor. At the movement
 * edge, wrap to the point nearest the opposite edge without widening the
 * corridor.
 *
 * @template {{ x: number, y: number }} T
 * @param {T[]} points
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number }} direction
 * @param {number} corridorRadius
 * @returns {{ point: T, warped: boolean } | null}
 */
export function findDirectionalCorridorTarget(points, origin, direction, corridorRadius) {
  const movement = cardinalDirection(direction)
  if (!Array.isArray(points) || !origin || !movement || !(corridorRadius > 0)) {
    return null
  }

  const candidates = points
    .map(point => directionalCandidate(point, origin, movement))
    .filter(candidate => (
      candidate.along !== 0
      && insideCorridor(candidate.across, corridorRadius)
    ))
  if (!candidates.length) return null

  const forward = candidates.filter(candidate => candidate.along > 0)
  const pool = forward.length ? forward : candidates
  const warped = forward.length === 0
  pool.sort((left, right) => (
    left.along - right.along || left.across - right.across
  ))

  return { point: pool[0].point, warped }
}

/**
 * Anchor a navigation search to the original cross-axis corridor while moves
 * continue on the same axis.
 *
 * @template {{ x: number, y: number }} T
 * @param {T} current
 * @param {{ x: number, y: number }} direction
 * @param {{ axis?: string, corridor?: number } | null} previous
 * @returns {{ axis: string, corridor: number, movement: { x: number, y: number }, point: T } | null}
 */
export function createDirectionalNavigationOrigin(current, direction, previous = null) {
  const movement = cardinalDirection(direction)
  if (!current || !movement) return null

  const axis = movement.x === 0 ? 'vertical' : 'horizontal'
  const currentCorridor = axis === 'horizontal' ? current.y : current.x
  const corridor = previous?.axis === axis && Number.isFinite(previous.corridor)
    ? previous.corridor
    : currentCorridor

  return {
    axis,
    corridor,
    movement,
    point: {
      ...current,
      x: axis === 'vertical' ? corridor : current.x,
      y: axis === 'horizontal' ? corridor : current.y,
    },
  }
}

function cardinalDirection(direction) {
  const x = Math.sign(Number(direction?.x) || 0)
  const y = Math.sign(Number(direction?.y) || 0)
  if ((x === 0) === (y === 0)) return null
  return { x, y }
}

function directionalCandidate(point, origin, movement) {
  const offsetX = point.x - origin.x
  const offsetY = point.y - origin.y
  return {
    point,
    along: offsetX * movement.x + offsetY * movement.y,
    across: Math.abs(offsetX * movement.y - offsetY * movement.x),
  }
}

function insideCorridor(across, corridorRadius) {
  const CORRIDOR_BOUNDARY_EPSILON = 1e-9
  return across / corridorRadius <= 1 + CORRIDOR_BOUNDARY_EPSILON
}

/**
 * Tokenize prose and common code identifiers, including kebab-case,
 * snake_case, and camelCase/PascalCase names.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function tokenizeSearchText(value) {
  const source = String(value || '')
  const cached = searchTokenCache.get(source)
  if (cached) return cached

  const tokens = source
    .normalize('NFKC')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+(?:[+#]+)?/gu) || []

  if (searchTokenCache.size >= SEARCH_TOKEN_CACHE_LIMIT) {
    searchTokenCache.clear()
  }
  searchTokenCache.set(source, tokens)
  return tokens
}

function packageNameExtensions(packageName, knownPackageNames) {
  const extensions = new Map()
  for (const candidate of knownPackageNames) {
    const longerName = normalizeLiteralText(candidate).trim()
    if (longerName === packageName || longerName.length <= packageName.length) continue

    let start = longerName.indexOf(packageName)
    while (start >= 0) {
      const prefix = longerName.slice(0, start)
      const suffix = longerName.slice(start + packageName.length)
      extensions.set(`${prefix}\0${suffix}`, { prefix, suffix })
      start = longerName.indexOf(packageName, start + 1)
    }
  }
  return [...extensions.values()]
}

function hasPackageNameBoundaries(source, start, end) {
  return !continuesPackageName(source, start - 1, -1)
    && !continuesPackageName(source, end, 1)
}

function continuesPackageName(source, index, direction) {
  const character = source[index]
  if (!character) return false
  if (/[\p{L}\p{N}_+#@-]/u.test(character)) return true
  return character === '.' && /[\p{L}\p{N}]/u.test(source[index + direction] || '')
}

function isInsideLongerPackageName(source, start, end, extensions) {
  return extensions.some(({ prefix, suffix }) => {
    const extendedStart = start - prefix.length
    return extendedStart >= 0
      && source.startsWith(prefix, extendedStart)
      && source.startsWith(suffix, end)
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeLiteralText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
}
