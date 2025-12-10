// Compatible selector for the labels sub page
const CARD_SELECTOR = '.card, section[name="labels"] ul li'

// Enable each skip link to focus its target without scrolling.
document.querySelectorAll('.skip-link').forEach((skipLink) => {
  skipLink.addEventListener('click', (event) => {
    const targetSelector = event.currentTarget.getAttribute('href')
    if (!targetSelector) {
      return
    }

    const target = document.querySelector(targetSelector)
    if (!target) {
      return
    }

    event.preventDefault()
    // If skipping to the compact search field, expand it first.
    if (targetSelector === '#search-field') {
      expandIfCompact(target)
    }

    const rect = target.getBoundingClientRect()
    const withinViewport = rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
      && rect.right <= (window.innerWidth || document.documentElement.clientWidth)

    target.focus(withinViewport ? { preventScroll: true } : undefined)
  })
})

// Handle sequential card navigation via j/k keys.
document.addEventListener('keydown', (event) => {
  if (hasModifier(event)) {
    return
  }

  const lower = event.key.toLowerCase()
  if (lower !== 'j' && lower !== 'k') {
    return
  }

  const active = document.activeElement
  const currentCard = findNavigableCard(active)
  if (!currentCard) {
    return
  }

  const direction = lower === 'j' ? 1 : -1
  if (handleSequentialNavigation(currentCard, direction)) {
    event.preventDefault()
  }
})

// Allow n/p shortcuts to trigger the pager controls within a section.
document.addEventListener('keydown', (event) => {
  if (hasModifier(event)) {
    return
  }

  const key = event.key
  const lower = key.toLowerCase()
  const isNext = lower === 'n'
  const isPrev = lower === 'p'
  if (!isNext && !isPrev) {
    return
  }

  const active = document.activeElement
  const pagerSection = findPagerSection(active)
  if (!pagerSection) {
    return
  }

  const currentCard = findNavigableCard(active)
  const cards = visibleCardsInSection(pagerSection)
  const index = Math.max(0, cards.indexOf(currentCard))

  const control = isNext ? 'next' : 'prev'
  if (clickPagerControl(pagerSection, control, index)) {
    event.preventDefault()
  }
})

let lastGridColumnPreference = 0

// Handle card navigation via arrow keys, paging horizontally when needed.
document.addEventListener('keydown', (event) => {
  if (hasModifier(event)) {
    return
  }

  const key = event.key
  const isArrowRight = key === 'ArrowRight'
  const isArrowLeft = key === 'ArrowLeft'
  const isArrowDown = key === 'ArrowDown'
  const isArrowUp = key === 'ArrowUp'
  if (!isArrowRight && !isArrowLeft && !isArrowDown && !isArrowUp) {
    return
  }

  const active = document.activeElement
  const currentCard = findNavigableCard(active)

  if (!currentCard) {
    return
  }

  const grid = buildGridForCard(currentCard)
  if (!grid) {
    return
  }

  const handled = handleGridNavigation(grid, currentCard, {
    isArrowDown,
    isArrowUp,
    isArrowRight,
    isArrowLeft,
  })

  if (handled) {
    event.preventDefault()
  } else if (isArrowUp) {
    const position = grid.positions.get(currentCard)
    lastGridColumnPreference = position?.column ?? 0
    focusSearchField(event)
  }
})

// Focus the search field when s or / is pressed outside editable inputs.
document.addEventListener('keydown', (event) => {
  const lower = event.key.toLowerCase()
  if (lower !== 's' && lower !== '/') {
    return
  }
  if (lower === 's' && hasModifier(event)) {
    return
  }

  if (lower === '/' && hasNonShiftModifier(event)) {
    return
  }

  const active = document.activeElement
  const isTyping = active && (
    active.tagName === 'INPUT'
    || active.tagName === 'TEXTAREA'
    || active.isContentEditable
  )
  if (isTyping) {
    return
  }

  focusSearchField(event)
})

// On enter or arrow down, submit and move focus to the first visible card for browsing.
document.addEventListener('keydown', (event) => {
  if (hasModifier(event)) {
    return
  }

  if (event.key !== 'Enter' && event.key !== 'ArrowDown') {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.id !== 'search-field') {
    return
  }

  event.preventDefault()
  ensureNoPendingSearch(target.form)
  const preferredColumn = event.key === 'ArrowDown' ? lastGridColumnPreference : 0
  focusFirstVisibleCard(preferredColumn)
})

//
// Helpers
//

/**
 * Check if any modifier key is pressed for the event.
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function hasModifier(event) {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

/**
 * Check for modifier keys except Shift. Slash shortcuts need to allow Shift.
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function hasNonShiftModifier(event) {
  return event.altKey || event.ctrlKey || event.metaKey
}

/**
 * Ensure any pending debounced search gets flushed before moving focus.
 * @param {HTMLFormElement|null} form
 * @returns {boolean} True if a submission was requested.
 */
function ensureNoPendingSearch(form) {
  if (!form) {
    return false
  }

  if (form.dataset.searchPending === 'true') {
    form.requestSubmit()
    return true
  }

  return false
}

/**
 * Check if a card is actually visible.
 * This is esp. needed for `SimpleSearch` which just hides (and not removes)
 * cards during search.
 *
 * @param {Element|null} card - Candidate card element.
 * @returns {boolean} True when the card is visible for navigation.
 */
function isVisibleCard(card) {
  if (!card || card.closest('template')) {
    return false
  }

  const rects = card.getClientRects()
  if (rects.length === 0) {
    return false
  }

  const style = window.getComputedStyle(card)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

/**
 * Focus the card heading anchor if available.
 * In practice that is the package name that links to the details page.
 *
 * @param {Element|null} card - Card whose heading should receive focus.
 * @returns {boolean} True when the heading anchor was focused.
 */
function focusCardHeading(card) {
  if (!card) {
    return false
  }

  const anchor = card.querySelector('a')
  if (!anchor) {
    return false
  }

  anchor.focus()
  return document.activeElement === anchor
}

/**
 * Resolve the element representing a navigable card for keyboard handlers.
 *
 * @param {Element|null} element - Starting point for the lookup.
 * @returns {Element|null} Matching card container or null.
 */
function findNavigableCard(element) {
  if (!(element instanceof Element)) {
    return null
  }

  return element.closest(CARD_SELECTOR)
}

/**
 * Step through cards in document order.
 *
 * @param {Element|null} currentCard - The card currently focused.
 * @param {number} direction - Positive or negative step count.
 * @returns {boolean} True when focus moved to another card.
 */
function handleSequentialNavigation(currentCard, direction) {
  const visibleCards = getAllVisibleCards()
  const index = visibleCards.indexOf(currentCard)
  if (index === -1) {
    return false
  }

  const nextCard = visibleCards[index + direction]
  if (!nextCard) {
    return false
  }

  return focusCardHeading(nextCard)
}

/**
 * Navigate within the visual card grid using arrow keys.
 *
 * @param {GridMetadata} grid - Context for the card's grid.
 * @param {Element} currentCard - Currently focused card element.
 * @param {{
 *   isArrowDown: boolean,
 *   isArrowUp: boolean,
 *   isArrowRight: boolean,
 *   isArrowLeft: boolean,
 * }} directions - Flags describing which arrow was pressed.
 * @returns {boolean} True when focus was moved or paging occurred.
 */
function handleGridNavigation(grid, currentCard, directions) {
  const position = grid.positions.get(currentCard)
  if (!position) {
    if (directions.isArrowDown || directions.isArrowUp) {
      const direction = directions.isArrowDown ? 1 : -1
      if (handleSequentialNavigation(currentCard, direction)) {
        return true
      }
    }
  }

  else if (directions.isArrowRight) {
    const rowCards = grid.rows[position.row] ?? []
    // Move right within this row when another card is available...
    if (position.column < rowCards.length - 1) {
      const nextCard = rowCards[position.column + 1]
      if (nextCard && focusCardHeading(nextCard)) {
        return true
      }
    // ... or flip to the next page.
    } else if (grid.pagerSection) {
      const desiredIndex = position.row * grid.maxColumns
      if (clickPagerControl(grid.pagerSection, 'next', desiredIndex)) {
        return true
      }
    }
  }

  else if (directions.isArrowLeft) {
    const rowCards = grid.rows[position.row] ?? []
    // Move left within this row when a previous card exists...
    if (position.column > 0) {
      const prevCard = rowCards[position.column - 1]
      if (prevCard && focusCardHeading(prevCard)) {
        return true
      }
    // ... or flip to the previous page.
    } else if (grid.pagerSection) {
      const desiredIndex = position.row * grid.maxColumns + Math.max(grid.maxColumns - 1, 0)
      if (clickPagerControl(grid.pagerSection, 'prev', desiredIndex)) {
        return true
      }
    }
  }

  else if (directions.isArrowDown) {
    const nextRow = grid.rows[position.row + 1]
    // If another row exists in the same section, move down within that row.
    if (nextRow?.length) {
      return focusCardInRow(nextRow, position.column)
    }

    // No lower row in this section; bail if the card was outside a pager section.
    if (!grid.pagerSection) {
      return false
    }

    // Try to enter the first row of the next section (newest → recent).
    const siblingSection = findSiblingSection(grid.pagerSection, 'next')
    if (!siblingSection) {
      return false
    }

    // Target the first available row in that section.
    const siblingCards = visibleCardsInSection(siblingSection)
    if (!siblingCards.length) {
      return false
    }

    const siblingGrid = buildCardGrid(siblingCards)
    const targetRow = siblingGrid.rows[0]
    if (targetRow?.length) {
      // Align with the same column index if possible.
      return focusCardInRow(targetRow, position.column)
    }
  }

  else if (directions.isArrowUp) {
    const previousRow = grid.rows[position.row - 1]
    // If a row exists above in the same section, move up there.
    if (previousRow?.length) {
      return focusCardInRow(previousRow, position.column)
    }

    // No higher row in this section; stop if outside a pager section.
    if (!grid.pagerSection) {
      return false
    }

    // Move into the last row of the previous section (recent → newest).
    const siblingSection = findSiblingSection(grid.pagerSection, 'prev')
    if (!siblingSection) {
      return false
    }

    // Target the last available row in that section.
    const siblingCards = visibleCardsInSection(siblingSection)
    if (!siblingCards.length) {
      return false
    }

    const siblingGrid = buildCardGrid(siblingCards)
    const targetRow = siblingGrid.rows[siblingGrid.rows.length - 1]
    if (targetRow?.length) {
      // Align with the same column index if possible.
      return focusCardInRow(targetRow, position.column)
    }
  }

  return false
}

const HOMEPAGE_SECTIONS = ['newest', 'recent']

/**
 * @typedef {HTMLElement} Card - Card element within grids.
 * @typedef {{ row: number, column: number }} GridPosition
 *   - Visual card coordinates.
 * @typedef {Map<Card, GridPosition>} CardPositions
 *   - Card-to-position lookup map.
 * @typedef {{
 *   rows: Card[][],
 *   positions: CardPositions,
 *   maxColumns: number,
 *   pagerSection?: Element|null,
 * }} GridMetadata - Snapshot of the grid layout.
 */

/**
 * @param {Card[]} row - Ordered cards for a single visual row.
 * @param {number} preferredColumn - Column index to align with when possible.
 * @returns {boolean} Whether focus was moved to a card in the row.
 */
function focusCardInRow(row, preferredColumn) {
  const columnIndex = Math.min(preferredColumn, row.length - 1)
  const target = row[columnIndex]
  if (target && focusCardHeading(target)) {
    return true
  }
  return false
}

/**
 * @param {Card[]} cards - Visible cards in order of appearance.
 * @returns {GridMetadata} Grid metadata for navigating cards.
 */
function buildCardGrid(cards) {
  /** @type {Card[][]} */
  const rows = []
  /** @type {CardPositions} */
  const positions = new Map()
  let previousLeft = null

  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    if (!rect) {
      continue
    }

    // A new visual row starts once the layout wraps back toward the left edge.
    if (previousLeft === null || rect.left <= previousLeft) {
      rows.push([])
    }

    const rowIndex = rows.length - 1
    const row = rows[rowIndex]
    const columnIndex = row.length

    row.push(card)
    positions.set(card, { row: rowIndex, column: columnIndex })
    previousLeft = rect.left
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return { rows, positions, maxColumns }
}

function getAllVisibleCards() {
  return Array.from(document.querySelectorAll(CARD_SELECTOR)).filter(isVisibleCard)
}

/**
 * Build grid metadata for the card's current context.
 * @param {Element} card
 * @returns {GridMetadata|null}
 */
function buildGridForCard(card) {
  const pagerSection = findPagerSection(card)
  const cards = pagerSection ? visibleCardsInSection(pagerSection) : getAllVisibleCards()
  if (!cards.length) {
    return null
  }

  const grid = buildCardGrid(cards)
  return {
    ...grid,
    pagerSection,
  }
}

/**
 * Focus the first row's card that aligns with `preferredColumn` when possible.
 * @param {number} preferredColumn
 * @returns {boolean}
 */
function focusFirstVisibleCard(preferredColumn = 0) {
  const cards = getAllVisibleCards()
  if (!cards.length) {
    return false
  }

  const grid = buildCardGrid(cards)
  const firstRow = grid.rows[0]
  if (!firstRow?.length) {
    return false
  }

  return focusCardInRow(firstRow, preferredColumn)
}

/**
 * Focus the main search field and expand it if needed.
 * @param {KeyboardEvent} [event]
 * @returns {boolean}
 */
function focusSearchField(event) {
  const searchField = document.querySelector('#search-field')
  if (!searchField) {
    return false
  }

  event?.preventDefault()
  expandIfCompact(searchField)
  searchField.focus({ preventScroll: false })
  if (typeof searchField.select === 'function') {
    searchField.select()
  }

  return document.activeElement === searchField
}

/**
 * @param {Element|null} section - Current pager section, if any.
 * @param {'next'|'prev'} direction - Which neighbor to look for.
 * @param {string[]} [sections=['newest', 'recent']] - Pager sections, ordered.
 * @returns {Element|null} Matching sibling section or null when absent.
 */
function findSiblingSection(section, direction, sections = HOMEPAGE_SECTIONS) {
  if (!section) {
    return null
  }

  const currentName = section.getAttribute('name')
  const currentIndex = sections.indexOf(currentName)
  if (currentIndex === -1) {
    return null
  }

  const offset = direction === 'next' ? 1 : -1
  const siblingName = sections[currentIndex + offset]
  if (!siblingName) {
    return null
  }

  return document.querySelector(`section[name="${siblingName}"]`)
}

/**
 * Find the pager section, the `element` is part of
 *
 * @param {Element|null} element - Starting element for lookup.
 * @param {string[]} [sectionNames=['newest', 'recent']] - Acceptable sections.
 * @returns {Element|null} Enclosing pager section, if found.
 */
function findPagerSection(element, sectionNames = HOMEPAGE_SECTIONS) {
  const selector = sectionNames
    .map(name => `section[name="${name}"]`)
    .join(', ')

  return element?.closest(selector)
}

/**
 * Click a section pager control and restore focus to the matching card.
 *
 * @param {Element|null} section - Pager container where controls live.
 * @param {'next'|'prev'} control - Which control button to activate.
 * @param {number} desiredIndex - Target card index to restore focus.
 * @returns {boolean} True when the control was clicked.
 */
function clickPagerControl(section, control, desiredIndex) {
  if (!section) {
    return false
  }

  const button = section.querySelector(`.pager-pagination [data-control="${control}"]`)
  if (!button || button.disabled) {
    return false
  }

  button.click()
  focusStoredCardInSection(section, desiredIndex)
  return true
}

/**
 * Focus the nth card, given by `desiredIndex`, within a section.
 *
 * @param {Element|null} section - Section with cards to restore focus in.
 * @param {number} desiredIndex - Desired card index to receive focus.
 */
function focusStoredCardInSection(section, desiredIndex) {
  if (!section) {
    return
  }

  const cards = visibleCardsInSection(section)
  if (!cards.length) {
    return
  }

  const index = Math.min(desiredIndex, cards.length - 1)
  focusCardHeading(cards[index])
}

/**
 * Collect all visible cards within a section.
 *
 * @param {Element|null} section - Section to gather visible cards from.
 * @returns {Card[]} Visible cards inside the section.
 */
function visibleCardsInSection(section) {
  if (!section) {
    return []
  }

  return Array.from(section.querySelectorAll(CARD_SELECTOR)).filter(isVisibleCard)
}
/**
 * Dispatch a compact search expansion event when applicable.
 * @param {HTMLElement} element
 */
function expandIfCompact(element) {
  const compactForm = element?.closest('form.compact')
  if (!compactForm) {
    return
  }

  compactForm.dispatchEvent(new CustomEvent('search:expand', { bubbles: true }))
}
