document.querySelectorAll('pre').forEach((codeblock) => {
  const wrapper = document.createElement('div')
  wrapper.classList.add('clipboard-wrapper')

  const toast_temp = document.querySelector('template#toast')
  const toast = toast_temp.content.cloneNode(true)
  const toast_el = toast.querySelector('.toast')
  toast_el.innerText = 'Copied!'
  document.body.appendChild(toast)

  const template = document.querySelector('template#clipboard-button')
  const button = template.content.cloneNode(true)

  button.querySelector('button').onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    navigator.clipboard.writeText(codeblock.innerText.trim())
    wrapper.classList.add('copied')

    const target = event.target.closest('button')

    toast_el.style.left = target.getBoundingClientRect().left
      + target.getBoundingClientRect().width
      - toast_el.getBoundingClientRect().width
      + 'px'
    toast_el.style.top = target.getBoundingClientRect().top
      - toast_el.getBoundingClientRect().height
      + 'px'

    toast_el.setAttribute('aria-hidden', 'false')

    window.setTimeout(() => {
      wrapper.classList.remove('copied')
    }, 500)
    window.setTimeout(() => {
      toast_el.setAttribute('aria-hidden', 'true')
    }, 1500)
  }

  codeblock.insertAdjacentElement('beforebegin', wrapper)
  wrapper.appendChild(codeblock)
  wrapper.appendChild(button)
})
