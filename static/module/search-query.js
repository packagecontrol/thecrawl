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

  if (activeLabels.length === 0) {
    return {
      labels: [...defaults].slice(0, maxTotal),
      activeLabels,
    }
  }

  const suggestionLimit = Math.max(0, maxTotal - activeLabels.length)
  const suggested = suggestionLimit > 0
    ? suggestLabelsForActive(activeLabels, labelRecords, excludedLabels)
    : []

  return {
    labels: [...activeLabels, ...suggested.slice(0, suggestionLimit)],
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

function suggestLabelsForActive(activeLabels, labelRecords, excludedLabels) {
  const activeSet = new Set(activeLabels.map(normalizeValue))
  const excludedSet = new Set((excludedLabels ?? []).map(normalizeValue))
  const counts = new Map()

  for (const record of labelRecords ?? []) {
    if (!record || !record.normalized || !record.entries) {
      continue
    }

    const matchesAll = [...activeSet].every(label => record.normalized.has(label))
    if (!matchesAll) {
      continue
    }

    for (const { label, normalizedLabel } of record.entries) {
      if (!normalizedLabel || activeSet.has(normalizedLabel) || excludedSet.has(normalizedLabel)) {
        continue
      }
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1]
      }
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
    })
    .map(([label]) => label)
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
