export class Message {
  constructor(text) {
    const toast_temp = document.querySelector('template#message')
    const instance = toast_temp.content.cloneNode(true)
    this.element = instance.querySelector('div')
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

    const maxWidth = Math.max(0, viewportWidth - margin * 2)
    this.element.style.maxWidth = maxWidth + 'px'
    this.element.style.visibility = 'hidden'
    this.element.style.left = '0px'
    this.element.style.top = '0px'
    this.element.setAttribute('aria-hidden', 'false')

    const toast_rect = this.element.getBoundingClientRect()
    const availableRight = viewportWidth - margin - target_rect.right
    const fitsEast = availableRight >= toast_rect.width
    const preferNorth = preference === 'N'

    let left
    let top
    let placedNorth = false

    if (!preferNorth && fitsEast) {
      left = target_rect.right + margin
      const maxLeft = viewportWidth - margin - toast_rect.width
      if (left > maxLeft) left = maxLeft

      top = target_rect.top + (target_rect.height - toast_rect.height) / 2
      const maxTop = viewportHeight - margin - toast_rect.height
      if (top < margin) top = margin
      if (top > maxTop) top = maxTop
    } else {
      left = target_rect.left + (target_rect.width - toast_rect.width) / 2
      const maxLeft = viewportWidth - margin - toast_rect.width
      if (left < margin) left = margin
      if (left > maxLeft) left = maxLeft

      top = target_rect.top - toast_rect.height - margin + 4
      placedNorth = true
      if (top < margin) {
        top = Math.min(target_rect.bottom + margin, viewportHeight - margin - toast_rect.height)
        placedNorth = false
      }
    }

    this.element.style.left = left + window.scrollX + 'px'
    this.element.style.top = top + window.scrollY + 'px'
    this.element.style.visibility = ''

    if (placedNorth) {
      this.element.classList.add('placed-north')
    } else {
      this.element.classList.remove('placed-north')
    }

    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.element.setAttribute('aria-hidden', 'true')
    }, 2400)
  }
}
