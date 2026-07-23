;(function () {
  // Run inline before the async pager to reduce first-paint geometry changes.
  const headings = document.querySelectorAll('.sticky-section-heading')

  for (const heading of headings) {
    const section = heading.closest('section')
    const list = section.querySelector(':scope > ul')
    const shouldStick = list.getBoundingClientRect().height > viewportHeight()
    section.dataset.shouldStick = String(shouldStick)
  }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 0
  }
})()
