;(function () {
  const SECTIONS = [
    { name: 'recent', queryParam: 'updated_after' },
    { name: 'newest', queryParam: 'created_after' },
  ]
  const PER_PAGE = 9

  const template = `<div class="card">
    <h3> <a href="/packages//"> </a> </h3>
    <p> </p>
    <ul class="stats"> </ul>
    <ul class="button-group labels">
        <li>
          <a class="button platform platform-" href="/">
          </a>
        </li>
        <li>
          <a class="button label" href="/">
          </a>
        </li>
        <li>
          <a class="button label" href="/">
          </a>
        </li>

        <li>
          <a class="button label" href="/">
          </a>
        </li>
    </ul>
  </div>`
  const templateEl = document.createElement('template')
  templateEl.innerHTML = template

  SECTIONS.forEach(({ name, queryParam }) => {
    if (!hasQueryParam(queryParam)) return

    const section = document.querySelector(`section[name="${name}"]`)
    const list = section?.querySelector('ul.grid')
    const h2 = section?.querySelector('h2')
    if (!list || !h2) return

    list.style.visibility = 'hidden'
    h2.style.visibility = 'hidden'
    renderPlaceholders(list)

    const onReady = () => {
      list.style.visibility = 'revert'
      h2.style.visibility = 'revert'
      clearTimeout(timer)
      document.removeEventListener('search-data-ready', onReady)
      setTimeout(() => document.dispatchEvent(new CustomEvent('pager-ready')))
    }

    const timer = setTimeout(onReady, 500)
    document.addEventListener('search-data-ready', onReady)
  })

  function hasQueryParam(param) {
    try {
      const url = new URL(window.location.href)
      return url.searchParams.has(param)
    }
    catch {
      return false
    }
  }

  function renderPlaceholders(list) {
    list.innerHTML = ''

    for (let i = 0; i < PER_PAGE; i++) {
      const li = document.createElement('li')
      li.appendChild(templateEl.content.cloneNode(true))
      list.appendChild(li)
    }
  }
})()
