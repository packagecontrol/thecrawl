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
    if (target) {
      const target_rect = target.getBoundingClientRect()
      const toast_rect = this.element.getBoundingClientRect()
      const margin = parseFloat(getComputedStyle(document.documentElement).fontSize) / 2

      this.element.style.left = Math.max(margin,
        target_rect.left
        + target_rect.width
        - toast_rect.width,
      ) + 'px'
      this.element.style.top = Math.max(margin,
        target_rect.top
        - toast_rect.height,
      ) + 'px'
    }

    this.element.setAttribute('aria-hidden', 'false')

    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.element.setAttribute('aria-hidden', 'true')
    }, 2000)
  }
}
