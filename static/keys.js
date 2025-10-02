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

const isVisibleCard = (card) => {
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

const focusCardHeading = (card) => {
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
