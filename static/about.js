import { Message } from './module/message.js'

document.querySelectorAll('pre').forEach((codeblock) => {
  const wrapper = document.createElement('div')
  wrapper.classList.add('clipboard-wrapper')

  const template = document.querySelector('template#clipboard-button')
  const button = template.content.cloneNode(true)
  const button_el = button.querySelector('button')
  const description = 'Copy the channel URL'
  button_el.setAttribute('aria-label', description)
  button_el.setAttribute('title', description)

  const good_news = new Message('Copied!')
  const bad_news = new Message('Copy failed! 😒')

  let waiting = false

  async function handleCopy(target) {
    waiting = true
    try {
      await navigator.clipboard.writeText(codeblock.innerText.trim())
      good_news.showNear(target)
    } catch (error) {
      console.error('Failed to copy install command', error)
      bad_news.showNear(target)
    } finally {
      waiting = false
    }
  }

  button_el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (waiting) {
      return
    }

    wrapper.classList.add('copied')
    button_el.classList.add('copied')
    window.setTimeout(() => {
      wrapper.classList.remove('copied')
      button_el.classList.remove('copied')
    }, 500)

    handleCopy(event.target.closest('button'))
  })

  codeblock.insertAdjacentElement('beforebegin', wrapper)
  wrapper.appendChild(codeblock)
  wrapper.appendChild(button)
})
