import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'
import { customTokenizer } from './module/minisearch.js'

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

  // In Libraries, infer 'any' for untagged libs or those that collapsed
  // to all three base OS (windows, linux, osx) so platform searches include them.
  if (
    platforms.size == 0
    || ['windows', 'linux', 'osx'].every(x => platforms.has(x))
  ) {
    platforms = ['any']
  }

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

// Intercept clicks on platform buttons to run in-page search
document.addEventListener('click', (event) => {
  const target = event.target.closest('a')
  if (!target) {
    return
  }
  if (!target.classList.contains('platform')) {
    return
  }
  const url = new URL(target.href, window.location.origin)
  const q = url.searchParams.get('q')
  if (!q) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  // Apply the platform query immediately without full navigation
  scrollUp()
  search.applySearch(q, { updateHistory: true, updateInput: true })
})

function scrollUp(all_the_way = true) {
  const target = all_the_way
    ? document.forms.search
    : document.querySelector('[data-list-target="counter"]')
  if (!target) {
    return
  }
  const rect = target.getBoundingClientRect()
  const completelyAbove = rect.bottom < 0
  const completelyBelow = rect.top > window.innerHeight
  if (completelyAbove || completelyBelow) {
    target.scrollIntoView()
  }
}
