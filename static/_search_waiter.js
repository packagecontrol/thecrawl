const form = document.currentScript.previousElementSibling
const input = form.elements.q
const status = form.querySelector('.search-status')
let state = 'loading'

input.addEventListener('input', updateWaitingStatus)
form.addEventListener('submit', (event) => {
  if (state === 'ready') return
  event.preventDefault()
  updateWaitingStatus()
})
window.addEventListener('search:ready', () => {
  state = 'ready'
  status.hidden = true
  status.textContent = ''
}, { once: true })
window.addEventListener('search:error', () => {
  state = 'error'
  showStatus('Search is unavailable. Try reloading.')
}, { once: true })

function updateWaitingStatus() {
  if (state !== 'loading') return
  if (input.value.trim()) {
    showStatus('Search is still loading. Your search will start when ready.')
  } else {
    status.hidden = true
    status.textContent = ''
  }
}

function showStatus(message) {
  if (status.textContent !== message) status.textContent = message
  status.hidden = false
}
