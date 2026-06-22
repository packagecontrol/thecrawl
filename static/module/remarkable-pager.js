const section = document.querySelector('section[name="remarkable"]')

if (section) {
  initRemarkablePager(section)
}

function initRemarkablePager(section) {
  const controls = Array.from(section.querySelectorAll('[data-remarkable-page-control]'))
  if (controls.length < 2) {
    return
  }

  for (const control of controls) {
    control.addEventListener('click', () => {
      const page = control.dataset.remarkablePageControl
      if (!page || section.dataset.remarkablePage === page) {
        return
      }
      showRemarkablePage(section, page, controls)
    })
  }
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
