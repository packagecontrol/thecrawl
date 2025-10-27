/**
 * While initializing search from the url parameter,
 * immediately hide package listings,
 * and change the page title to indicate this state.
 */

(function () {
  const params = new URLSearchParams(location.search)
  const q = params.get('q')
  const sort = params.get('sort')
  if (!q && !sort) {
    return
  };

  const root = document.documentElement
  const isHome = root.classList.contains('home')
  const titlePrefix = (() => {
    if (isHome) {
      return 'Search'
    }
    if (root.classList.contains('labels-in-package-control-r')) {
      return 'Labels'
    }
    if (root.classList.contains('libraries-in-package-control-r')) {
      return 'Libraries'
    }
    return null
  })()

  root.classList.add('initializing')
  if (titlePrefix && q) {
    document.title = `${titlePrefix} — ${q}`
  }
  else if (isHome) {
    document.title = 'Listing'
  }

  const resolveHeading = () => {
    return document.querySelector('[data-list-target="heading"]')
  }

  const onDOMContentLoaded = () => {
    // set temporary content that will be replaced after search completes
    const form = document.forms.search
    form.style.visibility = 'revert'
    if (q) {
      const input = form.elements['q']
      input.value = q
    }
    if (sort) {
      const select = form.elements['sort']
      select.value = sort
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
    window.removeEventListener('search:done', onSearchReady)
  }

  window.addEventListener('DOMContentLoaded', onDOMContentLoaded)
  window.addEventListener('search:done', onSearchReady)
})()
