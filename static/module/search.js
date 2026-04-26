import { parseQueryParts } from './search-query.js'

export class Search {
  minisearch = null
  options = {
    filters: {
      author: true,
      label: true,
      platform: true,
    },
  }

  stringSearch = false // is there a string search, not just filtering?

  // pass this a prepared minisearch instance: https://github.com/lucaong/minisearch
  constructor(minisearch, options = {}, processor = processQueryString) {
    this.minisearch = minisearch
    this.process = processor
    this.options = { ...this.options, ...options }
  }

  // process the search query string and return results
  search(value) {
    const query = this.process(value, this.options.filters)
    this.stringSearch = query.hasFreeText

    // search and then map results so we can easily use them for output
    const results = this.minisearch.search({
      queries: query.queries,
      combineWith: 'AND',
    }).filter(query.filter)

    return normalizeResults(results)
  }

  // return all indexed packages using minisearch's wildcard query
  all() {
    this.stringSearch = false
    const wildcard = this.minisearch.constructor?.wildcard
    if (!wildcard) {
      throw new Error('minisearch wildcard symbol is unavailable')
    }
    return normalizeResults(this.minisearch.search(wildcard))
  }
}

export function processQueryString(rawValue = '', filterFlags = {}) {
  /** @type {Array<Object>} */
  const queries = []
  /** @type {{ field: string, value: string }[]} */
  const exactMatches = []
  const value = rewriteSyntheticLabelAliases(String(rawValue ?? ''))
  const parts = parseQueryParts(value)
  const filters = {
    author: true,
    label: true,
    platform: true,
    ...filterFlags,
  }

  for (const type of ['author', 'label', 'platform']) {
    if (!filters[type]) {
      continue
    }

    for (const part of parts) {
      if (part.kind !== 'filter' || part.type !== type) {
        continue
      }

      queries.push(buildFilterQuery(part))
      if (part.quoted) {
        exactMatches.push({ field: searchFieldForFilterType(part.type), value: part.value })
      }
    }
  }

  const freeText = extractSearchableText(parts, filters)
  if (freeText.length > 0) {
    queries.push({
      queries: freeText.split(/\s+/),
      fields: ['name', 'description', 'author', 'labels'],
    })
  }

  const filter = result => exactMatches.every(({ field, value: expected }) => {
    let value = result[field]
    // All the fields we support are actually ","-joined in the index.
    // See index.json.njk
    if (Array.isArray(value)) {
      value = value.join(',')
    }
    const expectedL = expected.toLowerCase()
    return value.toLowerCase().split(',').map(x => x.trim()).includes(expectedL)
  })

  return { queries, hasFreeText: freeText.length > 0, filter }
}

function buildFilterQuery(part) {
  const field = searchFieldForFilterType(part.type)
  if (part.type !== 'platform') {
    return { fields: [field], queries: [part.value] }
  }

  return {
    fields: [field],
    combineWith: 'OR',
    queries: [buildPlatformQuery(part.value), 'any'],
  }
}

function buildPlatformQuery(value) {
  // The lexer splits at "-" but we want "windows-x32" to *not* match
  // "linux-x32".
  const parts = value.split(/[-\s]+/).filter(Boolean)
  if (parts.length <= 1) {
    return value
  }

  return {
    fields: ['platforms'],
    combineWith: 'AND',
    queries: parts,
  }
}

function extractSearchableText(parts, filters) {
  return parts
    .flatMap((part) => {
      if (part.kind === 'text') {
        return [part.value]
      }
      if (!filters[part.type]) {
        return [part.token]
      }
      return []
    })
    .join(' ')
    .trim()
}

function searchFieldForFilterType(type) {
  if (type === 'label') {
    return 'labels'
  }
  if (type === 'platform') {
    return 'platforms'
  }
  return 'author'
}

const SYNTHETIC_LABEL_ALIASES = {
  fail: 'FAILING',
  failing: 'FAILING',
  mia: 'MIA',
  rip: 'RIP',
}

function rewriteSyntheticLabelAliases(value) {
  return value.replace(/(^|\s):([a-z][\w-]*)\b/gi, (match, prefix, rawAlias) => {
    const canonicalLabel = SYNTHETIC_LABEL_ALIASES[rawAlias.toLowerCase()]
    if (!canonicalLabel) {
      return match
    }
    return `${prefix}label:"${canonicalLabel}"`
  })
}

function normalizeResults(entries = []) {
  // eslint-disable-next-line no-unused-vars
  return entries.map(({ score, /**/id, queryTerms, terms, match, /**/ ...rest }) => ({
    ...rest,
    score,
  }))
}
