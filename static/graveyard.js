import './compact-search.js'

const graveyard = document.querySelector('.graveyard')
const deadPackageList = graveyard?.querySelector('[aria-label="Dead packages"] .graveyard-list')
const sortButtons = graveyard?.querySelectorAll('[data-graveyard-sort]') ?? []

for (const button of sortButtons) {
  button.addEventListener('click', () => sortDeadPackages(button.dataset.graveyardSort))
}

function sortDeadPackages(sortBy) {
  const byName = (a, b) => a.dataset.name.localeCompare(b.dataset.name)
  const byDate = (a, b) => {
    const dateDifference = Date.parse(b.dataset.removed) - Date.parse(a.dataset.removed)
    return dateDifference || byName(a, b)
  }
  const comparator = sortBy === 'date' ? byDate : byName
  const cards = [...deadPackageList.children].sort(comparator)
  for (const card of cards) {
    deadPackageList.appendChild(card)
  }

  for (const button of sortButtons) {
    const isActive = button.dataset.graveyardSort === sortBy
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  }
}
