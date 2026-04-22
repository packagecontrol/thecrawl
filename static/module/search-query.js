const SUPPORTED_FILTER_TYPES = ['label', 'platform', 'author']

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

export function buildLabelRecords(packages) {
  return (packages ?? []).map((pkg) => {
    const labels = parsePackageLabels(pkg?.labels)
    const normalized = new Set()
    const entries = []

    for (const label of labels) {
      const normalizedLabel = normalizeValue(label)
      if (!normalizedLabel || normalized.has(normalizedLabel)) {
        continue
      }
      normalized.add(normalizedLabel)
      entries.push({ label, normalizedLabel })
    }

    return {
      entries,
      normalized,
    }
  })
}

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

export function extractActiveLabelValues(rawQuery) {
  const seen = new Set()
  const active = []

  for (const { value } of parseFilterMatches(rawQuery, 'label')) {
    const normalized = normalizeValue(value)
    if (!normalized || seen.has(normalized)) {
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

function suggestLabels(activeLabels, labelRecords, excludedLabels, excludedQueryTerms) {
  const activeSet = new Set(activeLabels.map(normalizeValue))
  const excludedSet = new Set((excludedLabels ?? []).map(normalizeValue))
  const queryTermSet = new Set((excludedQueryTerms ?? []).map(normalizeValue))
  const counts = new Map()

  for (const record of labelRecords ?? []) {
    if (!record || !record.entries) {
      continue
    }

    for (const { label, normalizedLabel } of record.entries) {
      if (
        !normalizedLabel
        || activeSet.has(normalizedLabel)
        || excludedSet.has(normalizedLabel)
        || queryTermSet.has(normalizedLabel)
      ) {
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

function tokenizeTerms(value) {
  const terms = []
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

function parsePackageLabels(value) {
  if (Array.isArray(value)) {
    return value
      .map(label => String(label ?? '').trim())
      .filter(Boolean)
  }
  if (typeof value !== 'string') {
    return []
  }
  return value
    .split(',')
    .map(label => label.trim())
    .filter(Boolean)
}

function normalizeValue(value) {
  return String(value ?? '').trim().toLowerCase()
}
