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
