import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { Search } from './module/search.js'

/**
 * Simplified search features on the library listing page.
 */

const data = []
const cards = document.querySelectorAll('[data-lib-name]')
cards.forEach((card) => {
  data.push({
    name: card.dataset.libName,
    author: card.dataset.libAuthor,
    description: card.dataset.libDescription,
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

const search = new Search(minisrch)
const form = document.forms.search
const input = form.elements['lib']
const handleInput = () => {
  const query = input.value.toLowerCase().trim()
  const counter = document.querySelector('h1')
  const heading = document.querySelector('section h2')

  if (query === '') {
    cards.forEach((card) => {
      card.closest('li').style.display = null
    })
    counter.innerText = counter.dataset.all + ' Libraries'
    heading.innerText = 'List'
    return
  }

  const names = search.search(query).map(result => result.name)
  cards.forEach((card) => {
    if (names.indexOf(card.dataset.libName) < 0) {
      card.closest('li').style.display = 'none'
    }
    else {
      card.closest('li').style.display = null
    }
    if (names.length === 1) {
      counter.innerText = '1 Library'
    }
    else {
      counter.innerText = names.length + ' Libraries'
    }
    heading.innerText = 'Results'
  })
}

let debounceTimeout

// Handle form submission
input.form.onsubmit = (event) => {
  event.preventDefault()
  event.stopPropagation()
  clearTimeout(debounceTimeout)

  handleInput()
}

// Handle input changes (search as you type)
input.addEventListener('input', () => {
  clearTimeout(debounceTimeout)

  debounceTimeout = setTimeout(() => {
    handleInput()
  }, 300) // .3 seconds
})
