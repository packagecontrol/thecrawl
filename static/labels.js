import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'

/**
 * Simplified search features on the labels listing page.
 */

const data = []
const cards = document.querySelectorAll('section ul .label')
cards.forEach((card) => {
  data.push({
    name: card.dataset.name,
  })
})

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name'],
  storeFields: ['name'],
  searchOptions: {
    prefix: true,
  },
})
minisrch.addAll(data)

const search = new SimpleSearch(minisrch, cards, document.getElementById('search-field'))
search.init()
