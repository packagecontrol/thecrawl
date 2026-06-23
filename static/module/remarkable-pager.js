const REMARKABLE_PAGE_PARAM = 'remarkable-page'
const FIRST_PAGE = '1'
const SECOND_PAGE = '2'

const section = document.querySelector('section[name="remarkable"]')

if (section) {
  initRemarkablePager(section)
}

function initRemarkablePager(section) {
  initStickyHeader(section)

  const controls = Array.from(section.querySelectorAll('[data-remarkable-page-control]'))
  if (controls.length < 2) {
    return
  }

  syncFromUrl(section, controls)

  for (const control of controls) {
    control.addEventListener('click', () => {
      const page = control.dataset.remarkablePageControl
      if (!page || section.dataset.remarkablePage === page) {
        return
      }
      showRemarkablePage(section, page, controls)
      updateHistory(page)
    })
  }
}

function syncFromUrl(section, controls) {
  const page = pageFromUrl()
  showRemarkablePage(section, page, controls)
  updateHistory(page)
}

function showRemarkablePage(section, page, controls) {
  section.dataset.remarkablePage = page
  updateStickyHeader(section)

  for (const control of controls) {
    if (control.dataset.remarkablePageControl === page) {
      control.setAttribute('aria-current', 'page')
    }
    else {
      control.removeAttribute('aria-current')
    }
  }
}

function initStickyHeader(section) {
  const header = section.querySelector('.remarkable-header')
  if (!header) {
    return
  }

  const sentinel = document.createElement('div')
  sentinel.classList.add('scroll-sentinel')
  section.insertBefore(sentinel, header)

  const observer = new IntersectionObserver(
    ([entry]) => header.classList.toggle('shadow', !entry.isIntersecting))
  observer.observe(sentinel)

  updateStickyHeader(section)
  window.addEventListener('resize', () => updateStickyHeader(section))
}

function updateStickyHeader(section) {
  const header = section.querySelector('.remarkable-header')
  const list = section.querySelector('.remarkable-list')
  if (!header || !list) {
    return
  }

  const stick = list.getBoundingClientRect().height > viewportHeight()
  header.classList.toggle('is-sticky', stick)
  section.style.scrollMarginTop = stick
    ? `${Math.ceil(header.getBoundingClientRect().height || 0)}px`
    : ''
}

function pageFromUrl() {
  const url = new URL(window.location.href)
  return url.searchParams.get(REMARKABLE_PAGE_PARAM) === SECOND_PAGE
    ? SECOND_PAGE
    : FIRST_PAGE
}

function viewportHeight() {
  return window.innerHeight || document.documentElement.clientHeight || 0
}

function updateHistory(page) {
  const url = new URL(window.location.href)
  if (page === SECOND_PAGE) {
    url.searchParams.set(REMARKABLE_PAGE_PARAM, SECOND_PAGE)
  }
  else {
    url.searchParams.delete(REMARKABLE_PAGE_PARAM)
  }

  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url)
  }
}
