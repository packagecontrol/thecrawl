const STICKY_HEADER_CLASS = 'sticky-section-header'
const STICKY_CLASS = 'is-sticky'
const SHADOW_CLASS = 'shadow'

export function initStickySectionHeader(section, options = {}) {
  const header = elementFromOption(section, options.header ?? options.headerSelector)
  const list = elementFromOption(section, options.list ?? options.listSelector ?? 'ul.grid')
  if (!header || !list) {
    return null
  }

  header.classList.add(STICKY_HEADER_CLASS)

  const sentinel = document.createElement('div')
  sentinel.classList.add('scroll-sentinel')
  section.insertBefore(sentinel, header)

  const state = {
    section,
    header,
    list,
    sentinel,
    observer: null,
    onChange: options.onChange,
  }
  const controller = {
    header,
    get isSticky() {
      return section.dataset.shouldStick === 'true'
    },
    update() {
      return updateStickyState(state)
    },
    disconnect() {
      disconnectStickyHeader(state, handleResize)
    },
  }

  const handleResize = () => controller.update()
  state.observer = new IntersectionObserver(
    ([entry]) => header.classList.toggle(SHADOW_CLASS, !entry.isIntersecting))
  state.observer.observe(sentinel)

  controller.update()
  window.addEventListener('resize', handleResize)
  return controller
}

function updateStickyState(state) {
  // Compute the mobile sticky treatment based on whether the visible list
  // fits in the viewport, not on a width breakpoint. If scrolling the list
  // would hide its heading, keep the heading sticky.
  const stick = state.list.getBoundingClientRect().height > viewportHeight()
  const changed = state.section.dataset.shouldStick !== String(stick)

  state.section.dataset.shouldStick = String(stick)
  state.header.classList.toggle(STICKY_CLASS, stick)
  state.section.style.scrollMarginTop = stick
    ? `${Math.ceil(state.header.getBoundingClientRect().height || 0)}px`
    : ''

  if (changed) {
    state.onChange?.(stick)
  }

  return stick
}

function disconnectStickyHeader(state, handleResize) {
  state.observer?.disconnect()
  window.removeEventListener('resize', handleResize)
  state.sentinel.remove()
  state.section.style.scrollMarginTop = ''
  state.header.classList.remove(STICKY_HEADER_CLASS, STICKY_CLASS, SHADOW_CLASS)
}

function elementFromOption(section, option) {
  if (typeof option === 'string') {
    return section.querySelector(option)
  }
  return option ?? null
}

function viewportHeight() {
  return window.innerHeight || document.documentElement.clientHeight || 0
}
