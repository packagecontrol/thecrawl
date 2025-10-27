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

    // omit minisearch result internals
    // eslint-disable-next-line no-unused-vars
    return results.map(({ score, /**/id, queryTerms, terms, match, /**/ ...rest }) => ({
      ...rest,
      score,
    }))
  }

  // return all indexed packages using minisearch's wildcard query
  all() {
    this.stringSearch = false
    const wildcard = this.minisearch.constructor?.wildcard
    if (!wildcard) {
      throw new Error('minisearch wildcard symbol is unavailable')
    }
    return this.minisearch.search(wildcard)
  }
}

export function processQueryString(rawValue = '', filterFlags = {}) {
  const queries = []
  const exactMatches = []
  let hasFreeText = false

  let value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '')

  const extractFilter = (field, regex, buildQuery = () => {}) => {
    const matches = []
    let match
    while ((match = regex.exec(value)) !== null) {
      matches.push(match)
    }
    regex.lastIndex = 0

    matches.forEach((currentMatch) => {
      const [, quoted, prefixQuoted, unquoted] = currentMatch
      const filterValue = (quoted ?? prefixQuoted ?? unquoted)?.trim()
      if (!filterValue) {
        return
      }

      queries.push({ fields: [field], queries: [filterValue], ...buildQuery(filterValue) })
      if (quoted) {
        exactMatches.push({ field, value: filterValue })
      }

      value = value.replace(currentMatch[0], ' ')
    })
  }

  const filters = {
    author: true,
    label: true,
    platform: true,
    ...filterFlags,
  }

  const regexFor = field =>
    new RegExp(`${field}:"([^"]+)"|${field}:"([^"]*)$|${field}:([^\\s]+)`, 'gi')

  if (filters.author) {
    extractFilter('author', regexFor('author'))
  }

  if (filters.label) {
    extractFilter('labels', regexFor('label'))
  }

  if (filters.platform) {
    extractFilter('platforms', regexFor('platform'), (platformValue) => {
      // The lexer splits at "-" but we want "windows-x32" to *not* match
      // "linux-x32".
      const parts = platformValue.split(/[-\s]+/).filter(Boolean)
      const query
        = parts.length > 1
          ? {
              fields: ['platforms'],
              combineWith: 'AND',
              queries: parts,
            }
          : platformValue

      return {
        fields: ['platforms'],
        combineWith: 'OR',
        queries: [query, 'any'],
      }
    })
  }

  const trimmed = value.trim()
  if (trimmed.length > 0) {
    queries.push({
      queries: trimmed.split(/\s+/),
      fields: ['name', 'description', 'author'],
    })
    hasFreeText = true
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

  return { queries, hasFreeText, filter }
}
