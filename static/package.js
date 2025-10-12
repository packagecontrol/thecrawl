import { Toast } from './module/toast.js'

const button = document.querySelector('.clipboard-button')

if (button) {
  const packageName = button.dataset.packageName
  const packagesArgument = JSON.stringify([packageName])
  const command = `sublime.run_command("install_packages", {"packages": ${packagesArgument}})`

  const toast = new Toast('Copied! Paste into the Sublime Text console to install.')
  const bad_toast = new Toast('Copy failed! 😒')

  async function handleCopy() {
    button.disabled = true

    button.classList.add('copied')
    window.setTimeout(() => {
      button.classList.remove('copied')
    }, 500)

    try {
      await navigator.clipboard.writeText(command)
      toast.pop(button)
    } catch (error) {
      console.error('Failed to copy install command', error)
      bad_toast.pop(button)
    } finally {
      button.disabled = false
    }
  }

  button.addEventListener('click', handleCopy)
}
