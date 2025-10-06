import { Search } from './search.js'

export class SimpleSearch {
  search = null
  input = null
  heading = document.querySelector('[data-list-target="heading"]')
  cards = []

  constructor(minisearch, cards, input) {
    this.search = new Search(minisearch)
    this.input = input
    this.cards = cards
  }

  handleInput() {
    const query = this.input.value.toLowerCase().trim()

    if (query === '') {
      this.cards.forEach((card) => {
        card.closest('li').style.display = null
      })
      this.heading.innerText = 'List'
    }
    else {
      const results = this.search.search(query).map(result => result.name)

      if (results.length === 1) {
        this.heading.innerText = '1 Result'
      }
      else {
        this.heading.innerText = results.length + ' Results'
      }

      this.cards.forEach((card) => {
        if (results.indexOf(card.dataset.name) < 0) {
          card.closest('li').style.display = 'none'
        }
        else {
          card.closest('li').style.display = null
        }
      })
    }

    // Always mark the fist visible card as start of the main content
    document.getElementById('main-content')?.removeAttribute('id')
    const firstVisibleCard = Array.from(this.cards)
      .map(card => card.closest('li'))
      .find((container) => {
        if (!container) {
          return false
        }
        return container.style.display !== 'none'
      })
    const mainAnchor = firstVisibleCard?.querySelector('a')
    if (mainAnchor) {
      mainAnchor.setAttribute('id', 'main-content')
    }
  }

  init() {
    let debounceTimeout

    // Handle form submission
    this.input.form.onsubmit = (event) => {
      event.preventDefault()
      event.stopPropagation()
      clearTimeout(debounceTimeout)

      this.handleInput()
    }

    // Handle input changes (search as you type)
    this.input.addEventListener('input', () => {
      clearTimeout(debounceTimeout)
      if (this.input.value.trim() == '') {
        this.handleInput()
      } else {
        debounceTimeout = setTimeout(() => {
          this.handleInput()
        }, 300) // .3 seconds
      }
    })
  }
}
