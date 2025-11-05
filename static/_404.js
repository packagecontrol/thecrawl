(() => {
  const path = location?.pathname ?? ''
  if (!path || !path.startsWith('/packages/')) return

  // Extract the attempted package name
  let seg = path.slice('/packages/'.length)
  if (seg.endsWith('/')) seg = seg.slice(0, -1)
  if (seg.toLowerCase().endsWith('.html')) seg = seg.slice(0, -5)
  // eslint-disable-next-line @stylistic/max-statements-per-line
  try { seg = decodeURIComponent(seg) } catch { /* swallow */ }
  const query = seg.trim()
  if (!query) return

  const lower = query.toLowerCase()
  const map = window?.__PKG_NAME_MAP || {}
  const suggestionEl = document.querySelector('#not-found-suggestion')
  const suggestions = []

  if (Object.prototype.hasOwnProperty.call(map, lower)) {
    suggestions.push(map[lower])
  }
  else {
    const limit = 2
    const max_suggestions = 2
    const matches = []
    for (const key of Object.keys(map)) {
      const dist = levenshtein(lower, key, limit)
      if (dist <= limit) matches.push({ key, dist })
    }
    matches.sort((a, b) => (a.dist - b.dist) || a.key.localeCompare(b.key))
    for (const match of matches) {
      suggestions.push(map[match.key])
      if (suggestions.length === max_suggestions) break
    }
  }

  if (suggestions.length > 0) {
    suggestionEl.textContent = ''
    suggestionEl.append('Were you looking for ')
    suggestions.forEach((name, index) => {
      const link = document.createElement('a')
      link.setAttribute('href', `/packages/${encodeURIComponent(name)}`)
      link.textContent = name
      if (index > 0) {
        suggestionEl.append(index === suggestions.length - 1 ? ' or ' : ', ')
      }
      suggestionEl.append(link)
    })
    suggestionEl.append('?')
    suggestionEl.removeAttribute('hidden')
  }

  const btn = document.querySelector('#search-btn') || document.querySelector('.not-found a.button')
  if (btn) {
    if (suggestions.length == 0) {
      btn.textContent = 'Search for it'
    }
    else {
      btn.textContent = 'Search instead'
    }
    btn.setAttribute('href', `/?q=${encodeURIComponent(query)}`)
  }

  function levenshtein(a, b, limit = 2) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1
    const prev = new Array(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j
    for (let i = 1; i <= a.length; i++) {
      let prevDiag = prev[0]
      prev[0] = i
      let rowMin = prev[0]
      for (let j = 1; j <= b.length; j++) {
        const temp = prev[j]
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost)
        prevDiag = temp
        if (prev[j] < rowMin) rowMin = prev[j]
      }
      if (rowMin > limit) return limit + 1
    }
    return prev[b.length]
  }
})()
