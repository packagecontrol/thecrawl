import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'
import { customTokenizer } from './module/minisearch.js'

/**
 * Simplified search features on the library listing page.
 */

const cards = document.querySelectorAll('[data-name]')
const data = Array.from(cards, (card) => {
  const platforms = card.dataset.platforms
    ? card.dataset.platforms.split(',').filter(Boolean)
    : ['any']

  return {
    name: card.dataset.name,
    author: card.dataset.author,
    description: card.dataset.description,
    platforms,
  }
})

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name', 'author', 'description', 'platforms'],
  tokenize: customTokenizer,
  storeFields: ['name', 'author', 'platforms'],
  searchOptions: {
    boost: { author: 2 },
    prefix: true,
  },
})
minisrch.addAll(data)

const search = new SimpleSearch(
  minisrch,
  cards,
  document.getElementById('search-field'),
  {
    titlePrefix: 'Libraries',
    filters: { label: false },
  },
)
search.init()
