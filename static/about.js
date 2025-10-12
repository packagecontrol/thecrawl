import { Toast } from './module/toast.js'

document.querySelectorAll('pre').forEach((codeblock) => {
  const wrapper = document.createElement('div')
  wrapper.classList.add('clipboard-wrapper')

  const template = document.querySelector('template#clipboard-button')
  const button = template.content.cloneNode(true)

  const toast = new Toast('Copied!')

  button.querySelector('button').onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    navigator.clipboard.writeText(codeblock.innerText.trim())
    wrapper.classList.add('copied')

    toast.pop(event.target.closest('button'))

    window.setTimeout(() => {
      wrapper.classList.remove('copied')
    }, 500)
  }

  codeblock.insertAdjacentElement('beforebegin', wrapper)
  wrapper.appendChild(codeblock)
  wrapper.appendChild(button)
})
