export class Search {
  minisearch = null
  stringSearch = false // is there a string search, not just filtering?

  // pass this a prepared minisearch instance: https://github.com/lucaong/minisearch
  constructor(minisearch = []) {
    this.minisearch = minisearch
  }

  // process the search query string and return results
  search(value) {
    const query = processQueryString(value)
    this.stringSearch = query.hasFreeText

    // search and then map results so we can easily use them for output
    const results = this.minisearch.search({
      queries: query.queries,
      combineWith: 'AND',
    })

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

export function processQueryString(rawValue = '') {
  const queries = []
  let hasFreeText = false

  let value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '')

  const extractFilter = (regex, buildQuery) => {
    const matches = []
    let match
    while ((match = regex.exec(value)) !== null) {
      matches.push(match)
    }
    regex.lastIndex = 0

    matches.forEach((currentMatch) => {
      const [, quoted, unquoted] = currentMatch
      const filterValue = quoted || unquoted
      if (!filterValue) {
        return
      }

      queries.push(buildQuery(filterValue))
      value = value.replace(currentMatch[0], ' ')
    })
  }

  const regexFor = field =>
    new RegExp(`${field}:"([^"]+)"|${field}:([^\\s]+)`, 'gi')

  extractFilter(regexFor('author'), authorValue => ({
    queries: [authorValue],
    fields: ['author'],
  }))

  extractFilter(regexFor('label'), labelValue => ({
    queries: [labelValue],
    fields: ['labels'],
  }))

  extractFilter(regexFor('platform'), platformValue => ({
    combineWith: 'OR',
    queries: [platformValue, 'any'],
    fields: ['platforms'],
  }))

  const trimmed = value.trim()
  if (trimmed.length > 0) {
    queries.push({
      queries: trimmed.split(/\s+/),
      fields: ['name', 'description', 'author'],
    })
    hasFreeText = true
  }

  return { queries, hasFreeText }
}
