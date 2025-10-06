const VARIANT_REPLACEMENTS = [
  [/colou/g, 'colo'], // colour => color
  [/localis/g, 'localiz'], // localisation => localization
  [/internationalis/g, 'internationaliz'], // internationalisation => internationalization
]

let SPLIT_TOKEN_REGEX
try {
  SPLIT_TOKEN_REGEX = new RegExp('[^\\p{L}\\p{N}]+', 'u')
} catch {
  // Fallback to ASCII-only splitting when Unicode property escapes are unavailable.
  SPLIT_TOKEN_REGEX = /[^a-z0-9]+/i
}

function normalizeToken(token) {
  for (const [pattern, replacement] of VARIANT_REPLACEMENTS) {
    token = token.replace(pattern, replacement)
  }
  return token
}

export function customTokenizer(str) {
  return str
    .split(SPLIT_TOKEN_REGEX)
    .flatMap((token) => {
      if (!token) {
        return []
      }
      return token
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(SPLIT_TOKEN_REGEX)
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
