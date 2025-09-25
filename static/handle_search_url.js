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

  const root = document.documentElement
  root.classList.add('initializing')
  const resolveHeading = () => {
    return document.querySelector('[data-list-target="heading"]')
  }

  const onDOMContentLoaded = () => {
    // set temporary content that will be replaced after search completes
    document.querySelector('[name=q]').value = q
  }

  const timer = window.setTimeout(() => {
    // we're waiting too long
    const heading = resolveHeading()
    if (heading) {
      heading.style.visibility = 'revert'
    }
  }, 600)

  const onSearchReady = () => {
    // we're done initializing, return back to normal
    root.classList.remove('initializing')
    const heading = resolveHeading()
    if (heading) {
      heading.style.visibility = ''
    }

    window.removeEventListener('DOMContentLoaded', onDOMContentLoaded)
    window.clearTimeout(timer)
    root.removeEventListener('search-is-ready', onSearchReady)
  }

  window.addEventListener('DOMContentLoaded', onDOMContentLoaded)
  root.addEventListener('search-is-ready', onSearchReady)
})()
