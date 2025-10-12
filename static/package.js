import { Toast } from './module/toast.js'

const button = document.querySelector('.clipboard-button')

if (button) {
  const packageName = button.dataset.packageName
  const packagesArgument = JSON.stringify([packageName])
  const command = `sublime.run_command("install_packages", {"packages": ${packagesArgument}})`

  const toast = new Toast('Copied! Paste into the Sublime Text console to install.')
  const bad_toast = new Toast('Copy failed! 😒')

  let waiting = false

  async function handleCopy() {
    waiting = true

    try {
      await navigator.clipboard.writeText(command)
      toast.pop(button)
    } catch (error) {
      console.error('Failed to copy install command', error)
      bad_toast.pop(button)
    } finally {
      waiting = false
    }
  }

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (waiting) {
      return
    }

    button.classList.add('copied')
    window.setTimeout(() => {
      button.classList.remove('copied')
    }, 500)

    handleCopy()
  })
}
