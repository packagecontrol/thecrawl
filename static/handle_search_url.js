/**
 * While initializing search from the url parameter,
 * immediately hide package listings,
 * and change the page title to indicate this state.
 */

(function () {
  const params = new URLSearchParams(location.search)
  const q = params.get('q')
  const isListing = !q && params.has('sort')
  if (!q && !isListing) {
    return
  };

  const root = document.documentElement
  root.classList.add('initializing')
  document.title = q ? `Search — ${q}` : 'Listing'

  const resolveHeading = () => {
    return document.querySelector('[data-list-target="heading"]')
  }

  const onDOMContentLoaded = () => {
    // set temporary content that will be replaced after search completes
    if (q) {
      document.querySelector('[name=q]').value = q
    }
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
