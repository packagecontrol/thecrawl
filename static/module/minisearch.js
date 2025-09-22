const VARIANT_REPLACEMENTS = [
  [/colou/g, 'colo'], // colour => color
]

function normalizeToken(token) {
  for (const [pattern, replacement] of VARIANT_REPLACEMENTS) {
    token = token.replace(pattern, replacement)
  }
  return token
}

export function customTokenizer(str) {
  return str
    .split(/[^a-z0-9]+/i)
    .flatMap((token) => {
      return token
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-z0-9]+/i)
        .concat(token)
    })
    .map(normalizeToken)
}

function createMinisearchInstance(MiniSearch) {
  return new MiniSearch({
    idField: 'name',
    fields: ['name', 'description', 'author', 'platforms', 'labels'],
    tokenize: customTokenizer,
    storeFields: [
      'name',
      'description',
      'author',
      'stars',
      'installed',
      'created_at',
      'last_modified',
      'archived_at',
      'removed',
      'doa',
      'platforms',
      'labels',
      'permalink',
    ],
    searchOptions: {
      boost: { author: 2 },
      prefix: true,
    },
  })
}

export function createMinisearch(MiniSearch, data) {
  const instance = createMinisearchInstance(MiniSearch)
  instance.addAll(data)
  return instance
}
