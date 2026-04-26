/**
 * @typedef {'label' | 'platform' | 'author'} FilterType
 */

/** @type {FilterType[]} */
const SUPPORTED_FILTER_TYPES = ['label', 'platform', 'author']

/**
 * @typedef {Object} SearchIndexPackage
 * @property {string} labels Comma-joined labels from search/index.json.njk.
 */

/**
 * @typedef {Object} LabelRecord
 * @property {string} label Display label as provided by the search index.
 * @property {string} normalizedLabel Case-insensitive form used for matching.
 */

/**
 * @typedef {Object} QueryFilterPart
 * @property {'filter'} kind
 * @property {FilterType} type Filter field name.
 * @property {string} token Complete filter token from the query.
 * @property {string} value Filter value without the field prefix/quotes.
 * @property {boolean} quoted Whether the filter used a closed quoted value.
 * @property {number} start Start offset in the original query.
 * @property {number} end End offset in the original query.
 */

/**
 * @typedef {Object} QueryTextPart
 * @property {'text'} kind
 * @property {string} value Raw free-text fragment between filters.
 * @property {number} start Start offset in the original query.
 * @property {number} end End offset in the original query.
 */

/**
 * @typedef {QueryFilterPart | QueryTextPart} QueryPart
 */

/**
 * @typedef {Object} SingleFilterQuery
 * @property {FilterType} type Filter field name.
 * @property {string} token Complete filter token from the query.
 * @property {string} value Filter value without the field prefix/quotes.
 */

export function buildFeaturedLabels(
  rawQuery,
  labelRecords,
  {
    defaults = [],
    maxTotal = 6,
    excludedLabels = [],
  } = {},
) {
  const activeLabels = extractActiveLabelValues(rawQuery)
  const hasQuery = normalizeQueryWhitespace(rawQuery).length > 0

  if (!hasQuery && activeLabels.length === 0) {
    return {
      labels: [...defaults].slice(0, maxTotal),
      activeLabels,
    }
  }

  const excludedQueryTerms = hasQuery ? extractFreeTextTerms(rawQuery) : []
  const suggestionLimit = Math.max(0, maxTotal - activeLabels.length)
  const suggested = suggestionLimit > 0
    ? suggestLabels(activeLabels, labelRecords, excludedLabels, excludedQueryTerms)
    : []

  const labels = [...activeLabels, ...suggested.slice(0, suggestionLimit)]

  if (labels.length === 0 && activeLabels.length === 0) {
    return {
      labels: [...defaults].slice(0, maxTotal),
      activeLabels,
    }
  }

  return {
    labels,
    activeLabels,
  }
}

/**
 * Build per-package label records from search-index package objects.
 *
 * The index template emits `labels` as an always-present, comma-joined
 * string. We keep the original label for display, and store a normalized
 * copy next to it for case-insensitive de-duping, matching, and counting.
 *
 * @param {SearchIndexPackage[]} packages
 * @returns {LabelRecord[][]}
 */
export function buildLabelRecords(packages) {
  return packages.map((pkg) => {
    const labels = parsePackageLabels(pkg.labels)
    /** @type {Set<string>} */
    const seenNormalizedLabels = new Set()
    /** @type {LabelRecord[]} */
    const entries = []

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase()
      if (seenNormalizedLabels.has(normalizedLabel)) {
        continue
      }
      seenNormalizedLabels.add(normalizedLabel)
      entries.push({ label, normalizedLabel })
    }

    return entries
  })
}

/**
 * Parse a raw query into filter tokens and remaining free-text spans.
 *
 * The parser only recognizes the shared filter syntax. It preserves source
 * spans so callers can remove tokens without rendering the full query and
 * accidentally overwriting the user's formatting.
 *
 * @param {string | null | undefined} rawQuery
 * @returns {QueryPart[]}
 */
export function parseQueryParts(rawQuery) {
  const query = String(rawQuery ?? '')
  const filters = parseFilterParts(query)
  const text = parseTextParts(query, filters)

  return [...filters, ...text].sort((a, b) => a.start - b.start)
}

/**
 * Parse queries that contain exactly one supported filter token.
 *
 * Used for shortcut links whose `q` value should map to one toggleable
 * filter. Queries with extra free text or multiple filters return null.
 *
 * @param {string | null | undefined} rawQuery
 * @returns {SingleFilterQuery | null}
 */
export function parseSingleFilterQuery(rawQuery) {
  const parts = parseQueryParts(rawQuery)
  if (parts.length !== 1 || parts[0].kind !== 'filter') {
    return null
  }

  const [part] = parts
  return {
    type: part.type,
    token: part.token,
    value: part.value,
  }
}

/**
 * Extract label filter values from a query in first-seen order.
 *
 * Values are de-duped case-insensitively, but returned with their original
 * query casing so active shortcut labels can preserve what the user typed.
 *
 * @param {string | null | undefined} rawQuery
 * @returns {string[]}
 */
export function extractActiveLabelValues(rawQuery) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const active = []

  for (const part of parseQueryParts(rawQuery)) {
    if (part.kind !== 'filter' || part.type !== 'label') {
      continue
    }

    const normalized = part.value.toLowerCase()
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    active.push(part.value)
  }

  return active
}

export function hasFilterValue(rawQuery, field, value) {
  const expected = normalizeValue(value)
  if (!expected) {
    return false
  }

  return parseFilterMatches(rawQuery, field).some(
    ({ value: current }) => normalizeValue(current) === expected,
  )
}

export function removeFilterValue(rawQuery, field, value) {
  const expected = normalizeValue(value)
  const matches = parseFilterMatches(rawQuery, field)
    .filter(({ value: current }) => normalizeValue(current) === expected)

  if (matches.length === 0) {
    return normalizeQueryWhitespace(rawQuery)
  }

  let next = String(rawQuery ?? '')
  for (const match of [...matches].reverse()) {
    next = `${next.slice(0, match.start)} ${next.slice(match.end)}`
  }

  return normalizeQueryWhitespace(next)
}

export function appendFilterToken(rawQuery, token) {
  const normalizedToken = String(token ?? '').trim()
  if (!normalizedToken) {
    return normalizeQueryWhitespace(rawQuery)
  }
  return normalizeQueryWhitespace(`${String(rawQuery ?? '')} ${normalizedToken}`)
}

export function normalizeQueryWhitespace(rawQuery) {
  return String(rawQuery ?? '').replace(/\s+/g, ' ').trim()
}

export function parseFilterMatches(rawQuery, field) {
  return parseQueryParts(rawQuery)
    .filter(part => part.kind === 'filter' && part.type === field)
    .map(({ token, value, start, end }) => ({ token, value, start, end }))
}

/**
 * Suggest labels by counting their package frequency across label records.
 *
 * Active labels, configured exclusions, and free-text query terms are omitted.
 * The returned string list is sorted by descending frequency, then label name.
 *
 * @param {string[]} activeLabels
 * @param {LabelRecord[][]} labelRecords
 * @param {string[]} excludedLabels
 * @param {string[]} excludedQueryTerms
 * @returns {string[]}
 */
function suggestLabels(activeLabels, labelRecords, excludedLabels, excludedQueryTerms) {
  const omittedLabels = new Set([
    ...activeLabels.map(normalizeValue),
    ...excludedLabels.map(normalizeValue),
    ...excludedQueryTerms.map(normalizeValue),
  ])
  /** @type {Map<string, { label: string, count: number }>} */
  const counts = new Map()

  for (const record of labelRecords ?? []) {
    for (const { label, normalizedLabel } of record) {
      if (omittedLabels.has(normalizedLabel)) {
        continue
      }

      const existing = counts.get(normalizedLabel)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(normalizedLabel, { label, count: 1 })
      }
    }
  }

  return [...counts.values()]
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })
    .map(({ label }) => label)
}

function extractFreeTextTerms(rawQuery) {
  return tokenizeTerms(
    parseQueryParts(rawQuery)
      .filter(part => part.kind === 'text')
      .map(part => part.value)
      .join(' '),
  )
}

/**
 * Split free-text query fragments into normalized, unique terms.
 *
 * Quoted phrases are kept as one term. Unquoted text is split on whitespace.
 * Returned terms are lower-cased for comparison with normalized labels.
 *
 * @param {string} value
 * @returns {string[]}
 */
function tokenizeTerms(value) {
  /** @type {string[]} */
  const terms = []
  /** @type {Set<string>} */
  const seen = new Set()
  const pattern = /"([^"]+)"|(\S+)/g

  let match
  while ((match = pattern.exec(value)) !== null) {
    const term = normalizeValue(match[1] ?? match[2] ?? '')
    if (!term || seen.has(term)) {
      continue
    }
    seen.add(term)
    terms.push(term)
  }

  return terms
}

function parseFilterParts(query) {
  /** @type {QueryFilterPart[]} */
  const parts = []
  const filters = SUPPORTED_FILTER_TYPES.join('|')
  const pattern = new RegExp(
    `(${filters}):"([^"]+)"|(${filters}):"([^"]*)$|(${filters}):([^\\s]+)`,
    'gi',
  )

  let match
  while ((match = pattern.exec(query)) !== null) {
    const rawType = match[1] ?? match[3] ?? match[5]
    const value = (match[2] ?? match[4] ?? match[6] ?? '').trim()
    if (!value) {
      continue
    }

    parts.push({
      kind: 'filter',
      type: normalizeFilterType(rawType),
      token: match[0],
      value,
      quoted: match[1] !== undefined,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return parts
}

function parseTextParts(query, filterParts) {
  /** @type {QueryTextPart[]} */
  const parts = []
  let cursor = 0

  for (const part of filterParts) {
    if (part.start > cursor) {
      pushTextPart(parts, query, cursor, part.start)
    }
    cursor = Math.max(cursor, part.end)
  }

  if (cursor < query.length) {
    pushTextPart(parts, query, cursor, query.length)
  }

  return parts
}

function pushTextPart(parts, query, start, end) {
  const value = query.slice(start, end)
  if (!value.trim()) {
    return
  }

  parts.push({
    kind: 'text',
    value,
    start,
    end,
  })
}

/**
 * @param {string} value Comma-joined labels from search/index.json.njk.
 * @returns {string[]}
 */
function parsePackageLabels(value) {
  return value
    .split(',')
    .map(label => label.trim())
    .filter(Boolean)
}

/**
 * @param {string} value
 * @returns {FilterType}
 */
function normalizeFilterType(value) {
  return /** @type {FilterType} */ (value.toLowerCase())
}

function normalizeValue(value) {
  return String(value ?? '').trim().toLowerCase()
}
