;(function () {
  const RECENT_QUERY_PARAM = 'recent'
  const RECENT_PER_PAGE = 9

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

  if (hasRecentQueryParam()) {
    const section = document.querySelector('section[name="recent"]')
    const list = section?.querySelector('ul.grid')
    list.style.visibility = 'hidden'
    renderRecentPlaceholders()

    const timer = setTimeout(() => {
      list.style.visibility = 'revert'
    }, 500)
    document.addEventListener('search-data-ready', () => {
      list.style.visibility = 'revert'
      clearTimeout(timer)
    })
  }

  function hasRecentQueryParam() {
    try {
      const url = new URL(window.location.href)
      return url.searchParams.has(RECENT_QUERY_PARAM)
    }
    catch {
      return false
    }
  }

  function renderRecentPlaceholders() {
    const section = document.querySelector('section[name="recent"]')
    const list = section?.querySelector('ul.grid')
    if (!list) return

    list.innerHTML = ''

    for (let i = 0; i < RECENT_PER_PAGE; i++) {
      const li = document.createElement('li')
      li.appendChild(templateEl.content.cloneNode(true))
      list.appendChild(li)
    }
  }
})()
