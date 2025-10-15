export class Message {
  constructor(text) {
    const toast_temp = document.querySelector('template#inline-message')
    const instance = toast_temp.content.cloneNode(true)
    this.element = instance.querySelector('.message')
    this.element.innerText = text
    document.body.appendChild(this.element)

    this.timer = null
  }

  showNear(target, preference = 'auto') {
    if (!target) {
      return
    }

    const target_rect = target.getBoundingClientRect()
    const margin = parseFloat(getComputedStyle(document.documentElement).fontSize) / 2
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight

    const msgRect = this.element.getBoundingClientRect()
    const availableRight = viewportWidth - target_rect.right - margin * 2
    const fitsEast = availableRight >= msgRect.width
    const preferNorth = preference === 'N'

    let left
    let top
    let placedNorth = false

    if (!preferNorth && fitsEast) {
      left = target_rect.right + margin
      const maxLeft = viewportWidth - margin - msgRect.width
      if (left > maxLeft) left = maxLeft

      top = target_rect.top + (target_rect.height - msgRect.height) / 2
      const maxTop = viewportHeight - margin - msgRect.height
      if (top < margin) top = margin
      if (top > maxTop) top = maxTop
    } else {
      left = target_rect.left + (target_rect.width - msgRect.width) / 2
      const maxLeft = viewportWidth - margin - msgRect.width
      if (left < margin) left = margin
      if (left > maxLeft) left = maxLeft

      top = target_rect.top - msgRect.height - margin + 4
      placedNorth = true
      if (top < margin) {
        top = Math.min(target_rect.bottom + margin, viewportHeight - margin - msgRect.height)
        placedNorth = false
      }
    }

    if (placedNorth) {
      this.element.classList.add('placed-north')
    } else {
      this.element.classList.remove('placed-north')
    }

    this.element.style.left = left + window.scrollX + 'px'
    this.element.style.top = top + window.scrollY + 'px'
    this.element.setAttribute('aria-hidden', 'false')

    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.element.setAttribute('aria-hidden', 'true')
    }, 2400)
  }
}
