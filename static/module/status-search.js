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
 * Find the nearest forward point in the first stepped corridor containing a
 * candidate. The corridor expands across the movement axis one fixed step at
 * a time; within that width, the nearest point along the movement axis wins.
 *
 * @template {{ x: number, y: number }} T
 * @param {T[]} points
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number }} direction
 * @param {number} corridorStep
 * @returns {{ point: T, corridorRadius: number } | null}
 */
export function findDirectionalCorridorTarget(points, origin, direction, corridorStep) {
  const movement = cardinalDirection(direction)
  if (!Array.isArray(points) || !origin || !movement || !(corridorStep > 0)) {
    return null
  }

  let nearest = null
  let nearestLevel = Number.POSITIVE_INFINITY
  let nearestAlong = Number.POSITIVE_INFINITY
  let nearestAcross = Number.POSITIVE_INFINITY

  for (const point of points) {
    const offsetX = point.x - origin.x
    const offsetY = point.y - origin.y
    const along = offsetX * movement.x + offsetY * movement.y
    if (!(along > 0)) continue

    const across = Math.abs(offsetX * movement.y - offsetY * movement.x)
    const level = corridorLevel(across, corridorStep)
    const isBetter = level < nearestLevel
      || (level === nearestLevel && along < nearestAlong)
      || (level === nearestLevel && along === nearestAlong && across < nearestAcross)
    if (!isBetter) continue

    nearest = point
    nearestLevel = level
    nearestAlong = along
    nearestAcross = across
  }

  return nearest
    ? { point: nearest, corridorRadius: nearestLevel * corridorStep }
    : null
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

/**
 * Find the stepped corridor radius required to include one point.
 *
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number }} target
 * @param {{ x: number, y: number }} direction
 * @param {number} corridorStep
 * @returns {number}
 */
export function directionalCorridorRadius(origin, target, direction, corridorStep) {
  const movement = cardinalDirection(direction)
  if (!origin || !target || !movement || !(corridorStep > 0)) return 0

  const offsetX = target.x - origin.x
  const offsetY = target.y - origin.y
  const across = Math.abs(offsetX * movement.y - offsetY * movement.x)
  return corridorLevel(across, corridorStep) * corridorStep
}

function cardinalDirection(direction) {
  const x = Math.sign(Number(direction?.x) || 0)
  const y = Math.sign(Number(direction?.y) || 0)
  if ((x === 0) === (y === 0)) return null
  return { x, y }
}

function corridorLevel(across, corridorStep) {
  const CORRIDOR_BOUNDARY_EPSILON = 1e-9
  const steps = across / corridorStep
  return Math.max(1, Math.ceil(steps - CORRIDOR_BOUNDARY_EPSILON))
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
