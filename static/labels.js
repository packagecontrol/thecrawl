import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { SimpleSearch } from './module/simplesearch.js'
import { customTokenizer } from './module/minisearch.js'

/**
 * Simplified search features on the labels listing page.
 */

const list = document.querySelector('section[name="labels"] ul')
const data = []
const cards = document.querySelectorAll('section ul .label')
const form = document.forms.search
const searchInput = form.elements['q']
const usageToggle = form.querySelector('.usage-toggle')

const hasActiveQuery = () => Boolean(searchInput?.value.trim())
const omitSingles = () => usageToggle?.getAttribute('aria-pressed') === 'true'

function initState() {
  usageToggle?.setAttribute('aria-pressed', 'true')
  usageToggle?.toggleAttribute('disabled', hasActiveQuery())
}

const cardFilter = (card) => {
  if (hasActiveQuery() || !omitSingles()) {
    return false // == show *all* entries
  }
  const usage = Number(card.dataset.usage ?? 0)
  return usage <= 1
}

cards.forEach((card) => {
  data.push({
    name: card.dataset.name,
  })
})

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name'],
  tokenize: customTokenizer,
  storeFields: ['name'],
  searchOptions: {
    prefix: true,
  },
})
minisrch.addAll(data)

const search = new SimpleSearch(
  minisrch,
  cards,
  searchInput,
  {
    titlePrefix: 'Labels',
    filters: {
      author: false,
      label: false,
      platform: false,
    },
    cardFilter,
  },
)

initState()

addAttributeListener(usageToggle, 'aria-pressed', () => {
  search.applySearch(searchInput?.value ?? '', { updateHistory: false, updateInput: false })
})

window.addEventListener('search:done', () => {
  usageToggle?.toggleAttribute('disabled', hasActiveQuery())
})

usageToggle?.addEventListener('click', (event) => {
  event.preventDefault()
  usageToggle?.setAttribute('aria-pressed', String(!omitSingles()))
})

const sortControls = document.querySelector('[data-sort-controls]')
const sortButtons = sortControls ? Array.from(sortControls.querySelectorAll('[data-sort-option]')) : []
let currentSort = 'name'

const setActiveSortButton = (value) => {
  sortButtons.forEach((button) => {
    const isActive = button.dataset.sortOption === value
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
}

const sortListItems = (value) => {
  if (!list) {
    return
  }
  const items = Array.from(list.querySelectorAll('li'))
  const byName = (a, b) => {
    const nameA = a.querySelector('.label')?.dataset.name ?? ''
    const nameB = b.querySelector('.label')?.dataset.name ?? ''
    return nameA.localeCompare(nameB)
  }
  const byUsage = (a, b) => {
    const usageA = Number(a.querySelector('.label')?.dataset.usage ?? 0)
    const usageB = Number(b.querySelector('.label')?.dataset.usage ?? 0)
    if (usageA === usageB) {
      return byName(a, b)
    }
    return usageB - usageA
  }

  const comparator = value === 'usage' ? byUsage : byName
  items.sort(comparator).forEach((item) => {
    list.appendChild(item)
  })
}

const updateSortParam = (value) => {
  const params = new URLSearchParams(window.location.search)
  if (value === 'usage') {
    params.set('sort', 'usage')
  } else {
    params.delete('sort')
  }

  const queryString = params.toString()
  const target = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname
  const current = `${window.location.pathname}${window.location.search}`

  if (current === target) {
    return
  }

  history.pushState({ sort: value }, '', target)
}

const applySort = (value, { updateHistory = true } = {}) => {
  if (!list) {
    return
  }
  const normalized = value === 'usage' ? 'usage' : 'name'
  currentSort = normalized

  setActiveSortButton(normalized)
  sortListItems(normalized)

  const updatedCards = Array.from(list.querySelectorAll('.label'))
  search.cards = updatedCards
  search.applySearch(search.input?.value ?? '', { updateHistory: false, updateInput: false })

  if (updateHistory) {
    updateSortParam(normalized)
  }
}

const syncSortFromUrl = () => {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('sort')
  const normalized = raw === 'usage' ? 'usage' : 'name'
  applySort(normalized, { updateHistory: false })
}

sortButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    const value = button.dataset.sortOption ?? 'name'
    if (value === currentSort) {
      return
    }
    applySort(value)
  })
})

window.addEventListener('popstate', () => {
  syncSortFromUrl()
})

syncSortFromUrl()
search.init()

function addAttributeListener(element, attrName, callback) {
  const observer = new MutationObserver((mutations) => {
    mutations
      .filter(mut => (
        mut.type === 'attributes'
        && mut.attributeName === attrName
        && mut.oldValue !== element.getAttribute(attrName)
      ))
      .forEach(callback)
  })
  observer.observe(element, { attributes: true, attributeOldValue: true })
  return observer
}
