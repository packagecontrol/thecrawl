(() => {
  const connection = navigator.connection
  if (connection?.saveData || /2g/.test(connection?.effectiveType || '')) {
    return
  }

  const maxPrefetches = 24
  const prefetched = new Set()

  addEventListener('pointerover', prefetchOnIntent, { capture: true, passive: true })
  addEventListener('focusin', prefetchOnIntent, { capture: true })
  addEventListener('touchstart', prefetchOnIntent, { capture: true, passive: true })

  function prefetchOnIntent(event) {
    const anchor = event.target.closest?.('a[href]')
    if (!anchor) {
      return
    }

    prefetch(anchor)
  }

  function prefetch(anchor) {
    if (prefetched.size >= maxPrefetches || !isNavigable(anchor)) {
      return
    }

    const url = new URL(anchor.href, location.href)
    if (!shouldPrefetch(url)) {
      return
    }

    const href = url.href
    prefetched.add(href)

    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'document'
    link.href = href
    document.head.append(link)
  }

  function isNavigable(anchor) {
    return !anchor.download && (!anchor.target || anchor.target === '_self')
  }

  function shouldPrefetch(url) {
    if (url.origin !== location.origin || prefetched.has(url.href)) {
      return false
    }

    if (url.href === location.href || isSamePageHash(url) || isHomeStateUrl(url)) {
      return false
    }

    return !url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/static')
  }

  function isSamePageHash(url) {
    return url.hash
      && url.pathname === location.pathname
      && url.search === location.search
  }

  function isHomeStateUrl(url) {
    return url.pathname === '/'
      && (url.searchParams.has('q') || url.searchParams.has('sort'))
  }
})()
