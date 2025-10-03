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
    target.focus({ preventScroll: true })
  })
})

// Handle sequential card navigation via j/k keys.
document.addEventListener('keydown', (event) => {
  const lower = event.key.toLowerCase()
  if (lower !== 'j' && lower !== 'k') {
    return
  }

  const active = document.activeElement
  const currentCard = active?.closest('.card')
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

  const currentCard = active?.closest('.card')
  const cards = visibleCardsInSection(pagerSection)
  const index = Math.max(0, cards.indexOf(currentCard))

  const control = isNext ? 'next' : 'prev'
  if (clickPagerControl(pagerSection, control, index)) {
    event.preventDefault()
  }
})

// Handle card navigation via arrow keys, paging horizontally when needed.
document.addEventListener('keydown', (event) => {
  const key = event.key
  const isArrowRight = key === 'ArrowRight'
  const isArrowLeft = key === 'ArrowLeft'
  const isArrowDown = key === 'ArrowDown'
  const isArrowUp = key === 'ArrowUp'
  if (!isArrowRight && !isArrowLeft && !isArrowDown && !isArrowUp) {
    return
  }

  const active = document.activeElement
  const currentCard = active?.closest('.card')

  if (!currentCard) {
    return
  }

  handleGridNavigation(event, currentCard, {
    isArrowDown,
    isArrowUp,
    isArrowRight,
    isArrowLeft,
  })
})

// Focus the search field when s is pressed outside editable inputs.
document.addEventListener('keydown', (event) => {
  const lower = event.key.toLowerCase()
  if (lower !== 's') {
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

  const target = document.querySelector('#search-field')
  if (!target) {
    return
  }

  event.preventDefault()
  target.focus({ preventScroll: false })
  if (typeof target.select === 'function') {
    target.select()
  }
})

// After submitting search, move focus to the first visible card for browsing.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.id !== 'search-field') {
    return
  }

  const card = Array.from(document.querySelectorAll('.card')).find(isVisibleCard)
  if (!card) {
    return
  }

  focusCardHeading(card)
})

//
// Helpers
//

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

function focusCardHeading(card) {
  if (!card) {
    return false
  }

  const anchor = card.querySelector('h3 a')
  if (!anchor) {
    return false
  }

  anchor.focus()
  return document.activeElement === anchor
}

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

function handleGridNavigation(event, currentCard, directions) {
  const pagerSection = findPagerSection(currentCard)
  const cards = pagerSection ? visibleCardsInSection(pagerSection) : getAllVisibleCards()
  if (!cards.length) {
    return
  }

  const grid = buildCardGrid(cards)
  const position = grid.positions.get(currentCard)
  if (!position) {
    if (directions.isArrowDown || directions.isArrowUp) {
      const direction = directions.isArrowDown ? 1 : -1
      if (handleSequentialNavigation(currentCard, direction)) {
        event.preventDefault()
      }
    }
    return
  }

  if (directions.isArrowRight) {
    const rowCards = grid.rows[position.row] ?? []
    if (position.column < rowCards.length - 1) {
      const nextCard = rowCards[position.column + 1]
      if (nextCard && focusCardHeading(nextCard)) {
        event.preventDefault()
      }
    } else if (grid.maxColumns > 1 && pagerSection) {
      const desiredIndex = position.row * grid.maxColumns
      if (clickPagerControl(pagerSection, 'next', desiredIndex)) {
        event.preventDefault()
      }
    }
    return
  }

  if (directions.isArrowLeft) {
    const rowCards = grid.rows[position.row] ?? []
    if (position.column > 0) {
      const prevCard = rowCards[position.column - 1]
      if (prevCard && focusCardHeading(prevCard)) {
        event.preventDefault()
      }
    } else if (grid.maxColumns > 1 && pagerSection) {
      const desiredIndex = position.row * grid.maxColumns + Math.max(grid.maxColumns - 1, 0)
      if (clickPagerControl(pagerSection, 'prev', desiredIndex)) {
        event.preventDefault()
      }
    }
    return
  }

  if (directions.isArrowDown) {
    const nextRow = grid.rows[position.row + 1]
    if (nextRow && nextRow.length) {
      const columnIndex = Math.min(position.column, nextRow.length - 1)
      const target = nextRow[columnIndex]
      if (target && focusCardHeading(target)) {
        event.preventDefault()
      }
      return
    }

    if (!pagerSection) {
      return
    }

    const siblingSection = findSiblingSection(pagerSection, 'next')
    if (!siblingSection) {
      return
    }

    const siblingCards = visibleCardsInSection(siblingSection)
    if (!siblingCards.length) {
      return
    }

    const siblingGrid = buildCardGrid(siblingCards)
    const targetRow = siblingGrid.rows[0]
    if (!targetRow || !targetRow.length) {
      return
    }

    const columnIndex = Math.min(position.column, targetRow.length - 1)
    const target = targetRow[columnIndex]
    if (target && focusCardHeading(target)) {
      event.preventDefault()
    }
    return
  }

  if (directions.isArrowUp) {
    const previousRow = grid.rows[position.row - 1]
    if (previousRow && previousRow.length) {
      const columnIndex = Math.min(position.column, previousRow.length - 1)
      const target = previousRow[columnIndex]
      if (target && focusCardHeading(target)) {
        event.preventDefault()
      }
      return
    }

    if (!pagerSection) {
      return
    }

    const siblingSection = findSiblingSection(pagerSection, 'prev')
    if (!siblingSection) {
      return
    }

    const siblingCards = visibleCardsInSection(siblingSection)
    if (!siblingCards.length) {
      return
    }

    const siblingGrid = buildCardGrid(siblingCards)
    const targetRow = siblingGrid.rows[siblingGrid.rows.length - 1]
    if (!targetRow || !targetRow.length) {
      return
    }

    const columnIndex = Math.min(position.column, targetRow.length - 1)
    const target = targetRow[columnIndex]
    if (target && focusCardHeading(target)) {
      event.preventDefault()
    }
  }
}

function buildCardGrid(cards) {
  const rows = []
  const positions = new Map()
  const rowTolerance = 8
  let currentRowTop = null

  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    if (!rect) {
      continue
    }

    if (currentRowTop === null || Math.abs(rect.top - currentRowTop) > rowTolerance) {
      currentRowTop = rect.top
      rows.push([])
    }

    const rowIndex = rows.length - 1
    const row = rows[rowIndex]
    const columnIndex = row.length

    row.push(card)
    positions.set(card, { row: rowIndex, column: columnIndex })
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return { rows, positions, maxColumns }
}

function getAllVisibleCards() {
  return Array.from(document.querySelectorAll('.card')).filter(isVisibleCard)
}

function findSiblingSection(section, direction) {
  if (!section) {
    return null
  }

  const order = ['newest', 'recent']
  const currentName = section.getAttribute('name')
  const currentIndex = order.indexOf(currentName)
  if (currentIndex === -1) {
    return null
  }

  const offset = direction === 'next' ? 1 : -1
  const siblingName = order[currentIndex + offset]
  if (!siblingName) {
    return null
  }

  return document.querySelector(`section[name="${siblingName}"]`)
}

function findPagerSection(element) {
  return element?.closest('section[name="newest"], section[name="recent"]') ?? null
}

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

function visibleCardsInSection(section) {
  if (!section) {
    return []
  }

  return Array.from(section.querySelectorAll('.card')).filter(isVisibleCard)
}
