const copyButton = document.querySelector('[data-copy-install]')

if (copyButton) {
  const packageName = copyButton.dataset.packageName
  const packagesArgument = JSON.stringify([packageName])
  const command = `sublime.run_command("install_packages", {"packages": ${packagesArgument}})`

  let hideTimer = null
  const feedback = document.createElement('div')
  feedback.className = 'copy-feedback'
  feedback.setAttribute('role', 'status')
  feedback.setAttribute('aria-live', 'polite')
  feedback.setAttribute('aria-hidden', 'true')
  copyButton.parentElement.appendChild(feedback)

  const showFeedback = (message) => {
    window.clearTimeout(hideTimer)
    feedback.textContent = message
    feedback.classList.add('is-visible')
    feedback.setAttribute('aria-hidden', 'false')
    hideTimer = window.setTimeout(() => {
      feedback.classList.remove('is-visible')
      feedback.setAttribute('aria-hidden', 'true')
    }, 2400)
  }

  async function handleCopy() {
    copyButton.disabled = true
    try {
      await navigator.clipboard.writeText(command)
      showFeedback('Copied! Paste into the Sublime Text console to install.')
    } catch (error) {
      console.error('Failed to copy install command', error)
      showFeedback('Copy failed! 😒')
    } finally {
      copyButton.disabled = false
    }
  }

  copyButton.addEventListener('click', handleCopy)
}
