/**
 * While initializing search from the url parameter,
 * immediately hide package listings,
 * and change the page title to indicate this state.
 */

(function () {
  const q = new URLSearchParams(location.search).get('q')
  if (!q) {
    return
  };

  document.title = `Search — ${q}`

  const setContent = () => {
    // set temporary content that will be replaced after search completes
    document.querySelector('[name=q]').value = q
    document.querySelector('h1').innerText = 'Searching…'
  }

  const timer = window.setTimeout(() => {
    // if loading takes long reveal h1 to explain the state to the user
    document.querySelector('h1').style.visibility = 'revert'
  }, 600)

  window.addEventListener('DOMContentLoaded', setContent)

  const root = document.documentElement
  root.classList.add('initializing')
  root.addEventListener('search-is-ready', () => {
    // we're done initializing, return back to normal
    root.classList.remove('initializing')
    window.removeEventListener('DOMContentLoaded', setContent)
    window.clearTimeout(timer)
  })
})()
