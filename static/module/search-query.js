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
 * Parse queries that contain exactly one supported filter token.
 *
 * Used for shortcut links whose `q` value should map to one toggleable
 * filter. Queries with extra free text or multiple filters return null.
 *
 * @param {string | null | undefined} rawQuery
 * @returns {SingleFilterQuery | null}
 */
export function parseSingleFilterQuery(rawQuery) {
  const query = normalizeQueryWhitespace(rawQuery)
  if (!query) {
    return null
  }

  for (const type of SUPPORTED_FILTER_TYPES) {
    const matches = parseFilterMatches(query, type)
    if (matches.length !== 1) {
      continue
    }
    const [match] = matches
    if (match.start === 0 && match.end === query.length) {
      return {
        type,
        token: match.token,
        value: match.value,
      }
    }
  }

  return null
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

  for (const { value } of parseFilterMatches(rawQuery, 'label')) {
    const normalized = value.toLowerCase()
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    active.push(value)
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
  const query = String(rawQuery ?? '')
  const pattern = new RegExp(`${field}:"([^"]+)"|${field}:"([^"]*)$|${field}:([^\\s]+)`, 'gi')
  const matches = []

  let match
  while ((match = pattern.exec(query)) !== null) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!value) {
      continue
    }
    matches.push({
      token: match[0],
      value,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return matches
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
  const query = String(rawQuery ?? '')
  if (!query.trim()) {
    return []
  }

  const filterSpans = []
  for (const type of SUPPORTED_FILTER_TYPES) {
    for (const match of parseFilterMatches(query, type)) {
      filterSpans.push({ start: match.start, end: match.end })
    }
  }

  if (filterSpans.length === 0) {
    return tokenizeTerms(query)
  }

  filterSpans.sort((a, b) => a.start - b.start)

  const remainder = []
  let cursor = 0

  for (const span of filterSpans) {
    if (span.start > cursor) {
      remainder.push(query.slice(cursor, span.start))
    }
    cursor = Math.max(cursor, span.end)
  }

  if (cursor < query.length) {
    remainder.push(query.slice(cursor))
  }

  return tokenizeTerms(remainder.join(' '))
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

function normalizeValue(value) {
  return String(value ?? '').trim().toLowerCase()
}
