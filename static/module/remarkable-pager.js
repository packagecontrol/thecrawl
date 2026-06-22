const REMARKABLE_PAGE_PARAM = 'remarkable-page'
const FIRST_PAGE = '1'
const SECOND_PAGE = '2'

const section = document.querySelector('section[name="remarkable"]')

if (section) {
  initRemarkablePager(section)
}

function initRemarkablePager(section) {
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

  for (const control of controls) {
    if (control.dataset.remarkablePageControl === page) {
      control.setAttribute('aria-current', 'page')
    }
    else {
      control.removeAttribute('aria-current')
    }
  }
}

function pageFromUrl() {
  const url = new URL(window.location.href)
  return url.searchParams.get(REMARKABLE_PAGE_PARAM) === SECOND_PAGE
    ? SECOND_PAGE
    : FIRST_PAGE
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
