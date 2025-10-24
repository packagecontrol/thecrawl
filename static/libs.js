import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'

/**
 * Simplified search features on the library listing page.
 */

const data = []
const cards = document.querySelectorAll('[data-name]')
cards.forEach((card) => {
  data.push({
    name: card.dataset.name,
    author: card.dataset.author,
    description: card.dataset.description,
  })
})

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name', 'author', 'description'],
  storeFields: ['name'],
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
  { titlePrefix: 'Libraries' },
)
search.init()
