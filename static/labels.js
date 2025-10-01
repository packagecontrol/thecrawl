import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { Search } from './module/search.js'

/**
 * Simplified search features on the labels listing page.
 */

const data = []
const cards = document.querySelectorAll('section ul .label')
cards.forEach((card) => {
  data.push({
    name: card.dataset.labelName,
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

const search = new Search(minisrch)
const form = document.forms.search
const input = form.elements['lib']
const handleInput = () => {
  const query = input.value.toLowerCase().trim()
  const heading = document.querySelector('[data-list-target="heading"]')

  if (query === '') {
    cards.forEach((card) => {
      card.closest('li').style.display = null
    })
    heading.innerText = 'List'
    return
  }

  const names = search.search(query).map(result => result.name)
  cards.forEach((card) => {
    if (names.indexOf(card.dataset.labelName) < 0) {
      card.closest('li').style.display = 'none'
    }
    else {
      card.closest('li').style.display = null
    }
    if (names.length === 1) {
      heading.innerText = '1 Result'
    }
    else {
      heading.innerText = names.length + ' Results'
    }
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
