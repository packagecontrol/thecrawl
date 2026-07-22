import { initStickySectionHeader } from './sticky-section-header.js'

const REMARKABLE_PAGE_PARAM = 'remarkable-page'
const FIRST_PAGE = '1'
const SECOND_PAGE = '2'
// Shortcut: responsive CSS also has 15-item pages, but the remarkable
// collection normally fills the widest layout's two 20-item pages.
const PAGE_SIZE = 20

const CONTROLS_TEMPLATE_HTML = `
  <nav class="remarkable-pagination" aria-label="Remarkable pages">
    <button type="button" class="remarkable-page-button" data-remarkable-page-control="1" aria-current="page" aria-controls="remarkable-list">1</button>
    <span class="remarkable-page-separator" aria-hidden="true">|</span>
    <button type="button" class="remarkable-page-button" data-remarkable-page-control="2" aria-controls="remarkable-list">2</button>
  </nav>
`

const controlsTemplate = document.createElement('template')
controlsTemplate.innerHTML = CONTROLS_TEMPLATE_HTML.trim()

const section = document.querySelector('section[name="remarkable"]')

if (section) {
  initRemarkablePager(section)
}

function initRemarkablePager(section) {
  const controls = renderControls(section)
  const stickyHeader = initStickySectionHeader(section, {
    headerSelector: '.remarkable-header',
    listSelector: '.remarkable-list',
  })

  if (controls.length < 2) {
    return
  }

  syncFromUrl(section, controls, stickyHeader)

  for (const control of controls) {
    control.addEventListener('click', () => {
      const page = control.dataset.remarkablePageControl
      if (!page || section.dataset.remarkablePage === page) {
        return
      }
      showRemarkablePage(section, page, controls, stickyHeader)
      updateHistory(page)
      stickyHeader?.scrollListStartIntoView()
    })
  }
}

function renderControls(section) {
  const list = section.querySelector('.remarkable-list')
  if (list.children.length <= PAGE_SIZE) {
    return []
  }

  const controls = controlsTemplate.content.firstElementChild.cloneNode(true)
  section.querySelector('.remarkable-header').appendChild(controls)
  return Array.from(controls.querySelectorAll('[data-remarkable-page-control]'))
}

function syncFromUrl(section, controls, stickyHeader) {
  const page = pageFromUrl()
  showRemarkablePage(section, page, controls, stickyHeader)
  updateHistory(page)
}

function showRemarkablePage(section, page, controls, stickyHeader) {
  section.dataset.remarkablePage = page
  stickyHeader?.update()

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
