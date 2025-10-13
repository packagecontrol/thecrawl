export class Toast {
  constructor(text) {
    const toast_temp = document.querySelector('template#toast')
    const instance = toast_temp.content.cloneNode(true)
    this.element = instance.querySelector('.toast')
    this.element.innerText = text
    document.body.appendChild(this.element)

    this.timer = null
  }

  pop(target) {
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

    let left
    let top
    let placedNorth = false

    if (fitsEast) {
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

      top = target_rect.top - toast_rect.height - margin
      placedNorth = true
      if (top < margin) {
        top = Math.min(target_rect.bottom + margin, viewportHeight - margin - toast_rect.height)
        placedNorth = false
      }
    }

    this.element.style.left = left + 'px'
    this.element.style.top = top + 'px'
    this.element.style.boxShadow = placedNorth ? '1px 1px 3px rgb(0 0 0 / 0.3)' : ''
    this.element.style.visibility = ''

    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.element.setAttribute('aria-hidden', 'true')
    }, 2400)
  }
}
