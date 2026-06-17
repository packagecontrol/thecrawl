(() => {
  const api = window.__packageReadmeAnchors ??= {
    install,
    scroll,
    scrollOnInitialLoad,
  }

  function install() {
    if (api.installed) {
      return
    }

    api.installed = true
    window.addEventListener('hashchange', scroll)
  }

  function scrollOnInitialLoad() {
    if (!isScrollRestoredNavigation()) {
      scroll()
    }
  }

  function scroll() {
    const slug = readmeHashSlug()
    if (!slug) {
      return
    }

    document.getElementById(`readme-${slug}`)?.scrollIntoView({ block: 'start' })
  }

  function isScrollRestoredNavigation() {
    const navigation = performance.getEntriesByType('navigation')[0]
    return navigation?.type === 'reload' || navigation?.type === 'back_forward'
  }

  function readmeHashSlug() {
    try {
      return decodeURIComponent(window.location.hash.replace(/^#/, ''))
    } catch {
      return window.location.hash.replace(/^#/, '')
    }
  }
})()
