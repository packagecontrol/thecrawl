import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'

/**
 * Simplified search features on the library listing page.
 */

const cards = document.querySelectorAll('[data-name]')
const data = Array.from(cards, (card) => {
  // Map class names like "platform-linux" back to plain platform identifiers
  let platforms = new Set((function* () {
    for (const el of card.querySelectorAll('.platform')) {
      for (const cls of el.classList) {
        if (cls.startsWith('platform-')) yield cls.slice('platform-'.length)
      }
    }
  })())

  return {
    name: card.dataset.name,
    author: card.dataset.author,
    description: card.dataset.description,
    platforms: Array.from(platforms),
  }
})

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name', 'author', 'description', 'platforms'],
  storeFields: ['name', 'author', 'platforms'],
  searchOptions: {
    boost: { author: 2 },
    fuzzy: 0.2,
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
