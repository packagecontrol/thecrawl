export const MIN_NOTES_SEARCH_CHARS = 2
export const NOTES_SEARCH_QUERY_PARAM = 'q'

const SEARCH_TEXT_CACHE_LIMIT = 2048
const normalizedSearchTextCache = new Map()
const normalizedLiteralNotesCache = new Map()
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
  const parsed = parseNotesQuery(query)
  if ([...parsed.searchableText].length < MIN_NOTES_SEARCH_CHARS) return null

  const queryTokens = tokenizeSearchText(parsed.unquotedText)
  if (!queryTokens.length && !parsed.literalPhrases.length) return null

  return (notes) => {
    const noteTokens = tokenizeSearchText(notes)
    const tokensMatch = queryTokens.every(queryToken => (
      noteTokens.some(noteToken => noteToken.startsWith(queryToken))
    ))
    if (!tokensMatch || !parsed.literalPhrases.length) return tokensMatch

    const literalNotes = normalizeLiteralNotes(notes).toLocaleLowerCase()
    return parsed.literalPhrases.every(phrase => literalNotes.includes(phrase))
  }
}

/**
 * Compile a query into a finder for visible match ranges within one text node.
 * Package locks pass their canonical name as literalText so only complete
 * package-name mentions are highlighted.
 *
 * @param {string} query
 * @param {string} [literalText]
 * @param {Iterable<string>} [knownPackageNames]
 * @returns {((text: string) => { start: number, end: number }[]) | null}
 */
export function createNotesHighlightFinder(
  query,
  literalText = '',
  knownPackageNames = [],
) {
  const literal = normalizeLiteralText(literalText).trim()
  if (literal) {
    const extensions = packageNameExtensions(literal, knownPackageNames)
    return (text) => mergeMatchRanges(
      findLiteralMatchRanges(text, literal).filter(({ start, end }) => (
        hasPackageNameBoundaries(text, start, end)
        && !isInsideLongerPackageName(text, start, end, extensions)
      )),
    )
  }

  const parsed = parseNotesQuery(query)
  if ([...parsed.searchableText].length < MIN_NOTES_SEARCH_CHARS) return null

  const queryTokens = tokenizeSearchText(parsed.unquotedText)
  if (!queryTokens.length && !parsed.literalPhrases.length) return null

  return (text) => {
    const ranges = findTokenMatchRanges(text, queryTokens)
    for (const phrase of parsed.literalPhrases) {
      ranges.push(...findLiteralMatchRanges(text, phrase))
    }
    return mergeMatchRanges(ranges)
  }
}

/**
 * Apply quote-pair editing for a search field. Returns null when the browser
 * should handle the key normally.
 *
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @param {string} key
 * @param {number | null} autoPairedQuoteIndex
 * @returns {{
 *   value: string,
 *   caret: number,
 *   selectionEnd?: number,
 *   autoPairedQuoteIndex: number | null,
 * } | null}
 */
export function editAutoPairedSearchQuotes(
  value,
  selectionStart,
  selectionEnd,
  key,
  autoPairedQuoteIndex = null,
) {
  const source = String(value || '')
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) {
    return null
  }

  if (key === '"' && selectionStart !== selectionEnd) {
    return {
      value: source.slice(0, selectionStart)
        + '"'
        + source.slice(selectionStart, selectionEnd)
        + '"'
        + source.slice(selectionEnd),
      caret: selectionStart + 1,
      selectionEnd: selectionEnd + 1,
      autoPairedQuoteIndex: selectionEnd + 1,
    }
  }
  if (selectionStart !== selectionEnd) return null

  if (key === '"' && !source) {
    return { value: '""', caret: 1, autoPairedQuoteIndex: 1 }
  }
  if (
    key === '"'
    && selectionStart === autoPairedQuoteIndex
    && source[selectionStart] === '"'
  ) {
    return {
      value: source,
      caret: selectionStart + 1,
      autoPairedQuoteIndex: null,
    }
  }
  if (
    key === 'Backspace'
    && selectionStart === autoPairedQuoteIndex
    && selectionStart > 0
    && source.slice(selectionStart - 1, selectionStart + 1) === '""'
  ) {
    return {
      value: source.slice(0, selectionStart - 1) + source.slice(selectionStart + 1),
      caret: selectionStart - 1,
      autoPairedQuoteIndex: null,
    }
  }
  return null
}

/**
 * Read a notes search query from a page URL.
 *
 * @param {string | URL} value
 * @returns {string}
 */
export function notesSearchQueryFromUrl(value) {
  try {
    return new URL(String(value)).searchParams.get(NOTES_SEARCH_QUERY_PARAM) || ''
  }
  catch {
    return ''
  }
}

/**
 * Return a copy of a page URL containing the notes search query. Empty queries
 * remove the parameter while preserving unrelated URL state.
 *
 * @param {string | URL} value
 * @param {string} query
 * @returns {URL}
 */
export function urlWithNotesSearchQuery(value, query) {
  const url = new URL(String(value))
  const searchQuery = String(query || '')
  if (searchQuery) {
    url.searchParams.set(NOTES_SEARCH_QUERY_PARAM, searchQuery)
  }
  else {
    url.searchParams.delete(NOTES_SEARCH_QUERY_PARAM)
  }
  return url
}

/**
 * Suggest a canonical package name when every query term matches a complete
 * package-name token and exactly one known package is the best match. One typo
 * is allowed in tokens of at least five characters, while exact matches always
 * take precedence over typo matches.
 *
 * @param {string} query
 * @param {Iterable<string>} [knownPackageNames]
 * @returns {string | null}
 */
export function findPackageNameSuggestion(query, knownPackageNames = []) {
  const parsed = parseNotesQuery(query)
  if (parsed.literalPhrases.length || !createNotesMatcher(query)) return null

  const queryTokens = tokenizeSearchText(query)
  const queryLength = queryTokens.join('').length
  let bestRank = null
  let suggestions = []
  for (const value of knownPackageNames) {
    const name = String(value || '').trim()
    if (!name) continue

    const nameTokens = tokenizeSearchText(name)
    const editCount = packageSuggestionEditCount(
      queryTokens,
      packageSuggestionTokens(nameTokens),
    )
    if (editCount === null) continue

    const rank = {
      editCount,
      extraCharacters: Math.abs(nameTokens.join('').length - queryLength),
    }
    const comparison = comparePackageSuggestionRanks(rank, bestRank)
    if (comparison > 0) continue
    if (comparison < 0) {
      bestRank = rank
      suggestions = []
    }
    suggestions.push(name)
  }
  return suggestions.length === 1 ? suggestions[0] : null
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

    const canonicalSource = normalizeLiteralNotes(rawNotes)
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
 * Find a directional navigation target, preferring the fixed corridor. When
 * both the horizontal and vertical corridors are empty, a horizontal move
 * falls back to the next or previous occupied day.
 *
 * @template {{ x: number, y: number }} T
 * @param {T[]} points
 * @param {T} current
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number }} direction
 * @param {number} corridorRadius
 * @param {number} verticalCorridorRadius
 * @returns {{ point: T, warped: boolean } | null}
 */
export function findDirectionalNavigationTarget(
  points,
  current,
  origin,
  direction,
  corridorRadius,
  verticalCorridorRadius,
) {
  const movement = cardinalDirection(direction)
  if (!Array.isArray(points) || !current || !origin || !movement || !(corridorRadius > 0)) {
    return null
  }

  const corridorTarget = findDirectionalCorridorTarget(
    points,
    origin,
    movement,
    corridorRadius,
  )
  if (corridorTarget || movement.x === 0) return corridorTarget
  if (!(verticalCorridorRadius > 0)) return null

  const verticalCorridorTarget = findDirectionalCorridorTarget(
    points,
    current,
    { x: 0, y: 1 },
    verticalCorridorRadius,
  )
  if (verticalCorridorTarget) return null

  return findDirectionalAxisTarget(points, origin, movement)
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

  return nearestDirectionalTarget(candidates)
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

function findDirectionalAxisTarget(points, origin, movement) {
  const candidates = points
    .map(point => directionalCandidate(point, origin, movement))
    .filter(candidate => candidate.along !== 0)
  return nearestDirectionalTarget(candidates)
}

function nearestDirectionalTarget(candidates) {
  if (!candidates.length) return null

  const forward = candidates.filter(candidate => candidate.along > 0)
  const pool = forward.length ? forward : candidates
  const warped = forward.length === 0
  pool.sort((left, right) => (
    left.along - right.along || left.across - right.across
  ))

  return { point: pool[0].point, warped }
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

  const tokens = normalizeSearchText(source)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+(?:[+#]+)?/gu) || []

  if (searchTokenCache.size >= SEARCH_TEXT_CACHE_LIMIT) {
    searchTokenCache.clear()
  }
  searchTokenCache.set(source, tokens)
  return tokens
}

function findTokenMatchRanges(value, queryTokens) {
  if (!queryTokens.length) return []

  const source = String(value || '')
  const ranges = []
  const wordPattern = /[\p{L}\p{N}]+(?:[+#]+)?/gu
  let word = wordPattern.exec(source)
  while (word) {
    const wordStart = word.index
    const boundaries = identifierBoundaries(word[0])
    for (let index = 0; index < boundaries.length; index += 1) {
      const segmentStart = boundaries[index]
      const segmentEnd = boundaries[index + 1] ?? word[0].length
      const segment = word[0].slice(segmentStart, segmentEnd)
      const normalizedSegment = normalizeSearchText(segment).toLocaleLowerCase()
      for (const queryToken of queryTokens) {
        if (!normalizedSegment.startsWith(queryToken)) continue
        const matchedText = [...segment].slice(0, [...queryToken].length).join('')
        ranges.push({
          start: wordStart + segmentStart,
          end: wordStart + segmentStart + matchedText.length,
        })
      }
    }
    word = wordPattern.exec(source)
  }
  return ranges
}

function identifierBoundaries(value) {
  const boundaries = [0]
  for (let index = 1; index < value.length; index += 1) {
    const previous = value[index - 1]
    const current = value[index]
    const next = value[index + 1] || ''
    if (
      /[a-z\d]/.test(previous) && /[A-Z]/.test(current)
      || /[A-Z]/.test(previous) && /[A-Z]/.test(current) && /[a-z]/.test(next)
    ) {
      boundaries.push(index)
    }
  }
  return boundaries
}

function findLiteralMatchRanges(value, literalText) {
  const source = String(value || '')
  const words = normalizeLiteralText(literalText).trim().split(' ').filter(Boolean)
  if (!words.length) return []

  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'giu')
  return [...source.matchAll(pattern)].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function mergeMatchRanges(ranges) {
  const sorted = ranges
    .filter(range => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    }
    else {
      merged.push({ ...range })
    }
  }
  return merged
}

function parseNotesQuery(query) {
  const literalPhrases = []
  const unquotedText = String(query || '').replace(/"([^"]*)"/gu, (_, phrase) => {
    const normalizedPhrase = normalizeLiteralText(phrase).trim()
    if (normalizedPhrase) {
      literalPhrases.push(normalizedPhrase.toLocaleLowerCase())
    }
    return ' '
  })
  const searchableText = `${unquotedText} ${literalPhrases.join(' ')}`.trim()
  return { literalPhrases, searchableText, unquotedText }
}

function comparePackageSuggestionRanks(left, right) {
  if (!right) return -1
  return left.editCount - right.editCount
    || left.extraCharacters - right.extraCharacters
}

function packageSuggestionTokens(tokens) {
  if (tokens.length < 2) return tokens
  return [...tokens, tokens.join('')]
}

function packageSuggestionEditCount(queryTokens, nameTokens) {
  let editCount = 0
  for (const queryToken of queryTokens) {
    if (nameTokens.includes(queryToken)) continue
    if (
      [...queryToken].length < 5
      || !nameTokens.some(nameToken => isSingleTypoAway(queryToken, nameToken))
    ) {
      return null
    }
    editCount += 1
    if (editCount > 1) return null
  }
  return editCount
}

function isSingleTypoAway(left, right) {
  const leftCharacters = [...left]
  const rightCharacters = [...right]
  const lengthDifference = leftCharacters.length - rightCharacters.length
  if (Math.abs(lengthDifference) > 1) return false

  if (lengthDifference === 0) {
    const mismatches = []
    for (let index = 0; index < leftCharacters.length; index += 1) {
      if (leftCharacters[index] !== rightCharacters[index]) mismatches.push(index)
      if (mismatches.length > 2) return false
    }
    if (mismatches.length <= 1) return true
    const [first, second] = mismatches
    return second === first + 1
      && leftCharacters[first] === rightCharacters[second]
      && leftCharacters[second] === rightCharacters[first]
  }

  const shorter = lengthDifference < 0 ? leftCharacters : rightCharacters
  const longer = lengthDifference < 0 ? rightCharacters : leftCharacters
  let shorterIndex = 0
  let longerIndex = 0
  let skipped = false
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1
      longerIndex += 1
      continue
    }
    if (skipped) return false
    skipped = true
    longerIndex += 1
  }
  return true
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

function normalizeLiteralNotes(value) {
  const source = String(value || '')
  const cached = normalizedLiteralNotesCache.get(source)
  if (typeof cached === 'string') return cached

  const normalized = normalizeSearchText(source).replace(/\s+/gu, ' ')
  cacheSearchText(normalizedLiteralNotesCache, source, normalized)
  return normalized
}

function normalizeSearchText(value) {
  const source = String(value || '')
  const cached = normalizedSearchTextCache.get(source)
  if (typeof cached === 'string') return cached

  const normalized = source.normalize('NFKC')
  cacheSearchText(normalizedSearchTextCache, source, normalized)
  return normalized
}

function cacheSearchText(cache, source, value) {
  if (cache.size >= SEARCH_TEXT_CACHE_LIMIT) cache.clear()
  cache.set(source, value)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeLiteralText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
}
