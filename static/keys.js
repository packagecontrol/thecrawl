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

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return
  }

  const active = document.activeElement
  const currentCard = active?.closest('.card')
  if (!currentCard) {
    return
  }

  const visibleCards = Array.from(document.querySelectorAll('.card')).filter(isVisibleCard)
  const index = visibleCards.indexOf(currentCard)
  if (index === -1) {
    return
  }

  const direction = event.key === 'ArrowDown' ? 1 : -1
  const nextCard = visibleCards[index + direction]
  if (!nextCard) {
    return
  }

  const didFocus = focusCardHeading(nextCard)
  if (didFocus) {
    event.preventDefault()
  }
})

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

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
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

  const control = event.key === 'ArrowRight' ? 'next' : 'prev'
  if (clickPagerControl(pagerSection, control, index)) {
    event.preventDefault()
  }
})

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
