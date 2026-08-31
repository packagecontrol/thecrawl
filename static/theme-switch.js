const switchEl = document.querySelector('[data-theme-switch]')
const labelEl = switchEl?.querySelector('[data-theme-switch-label]')
const systemTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
const STORAGE_KEY = 'thecrawl-theme'
const MODES = ['auto', 'light', 'dark']
const MODE_ANGLES = {
  light: 0,
  auto: 22.5,
  dark: 45,
}
const SHORT_TURN_MS = 180
const LONG_TURN_MS = 180
const SHORT_TURN_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const LONG_TURN_EASING = 'linear'

let currentMode = loadMode()
let pendingModes = modesAfter(currentMode)
let rotation = MODE_ANGLES[currentMode]
let turnDirection = directionFrom(currentMode)

init()

function init() {
  if (!switchEl) return

  applyInitialMode()
  switchEl.addEventListener('click', selectNextMode)
  systemTheme?.addEventListener('change', handleSystemThemeChange)
}

function applyInitialMode() {
  applyEffectiveTheme()
  switchEl.dataset.mode = currentMode
  switchEl.style.setProperty('--theme-switch-rotation', `${rotation}deg`)
  if (labelEl) labelEl.textContent = capitalize(currentMode)
  updateDescription(nextMode())
}

function selectNextMode() {
  if (currentMode === 'auto') beginAutoCycle()

  const mode = pendingModes.shift()
  const delta = directionalDelta(rotation, MODE_ANGLES[mode], turnDirection)
  const isLongTurn = Math.abs(delta) > 180

  rotation += delta
  currentMode = mode
  applyEffectiveTheme()
  switchEl.style.setProperty('--theme-switch-rotation', `${rotation}deg`)
  switchEl.style.setProperty(
    '--theme-switch-duration',
    `${isLongTurn ? LONG_TURN_MS : SHORT_TURN_MS}ms`,
  )
  switchEl.style.setProperty(
    '--theme-switch-easing',
    isLongTurn ? LONG_TURN_EASING : SHORT_TURN_EASING,
  )
  switchEl.dataset.mode = currentMode
  if (labelEl) labelEl.textContent = capitalize(currentMode)
  saveMode(currentMode)
  updateDescription(nextMode())
}

function handleSystemThemeChange() {
  if (currentMode !== 'auto') return
  applyEffectiveTheme()
  turnDirection = directionForSystemTheme()
  updateDescription(nextModeForAuto())
}

function beginAutoCycle() {
  pendingModes = modesAfterAuto()
  turnDirection = directionForSystemTheme()
}

function nextMode() {
  return pendingModes[0] || nextModeForAuto()
}

function nextModeForAuto() {
  return systemTheme?.matches ? 'light' : 'dark'
}

function modesAfter(mode) {
  if (mode === 'dark') return ['light', 'auto']
  if (mode === 'light') return ['dark', 'auto']
  return []
}

function modesAfterAuto() {
  return systemTheme?.matches
    ? ['light', 'dark', 'auto']
    : ['dark', 'light', 'auto']
}

function directionFrom(mode) {
  if (mode === 'dark') return 1
  if (mode === 'light') return -1
  return directionForSystemTheme()
}

function directionForSystemTheme() {
  return systemTheme?.matches ? -1 : 1
}

function directionalDelta(current, target, direction) {
  const normalizedCurrent = ((current % 360) + 360) % 360
  if (direction > 0) return (target - normalizedCurrent + 360) % 360
  return -((normalizedCurrent - target + 360) % 360)
}

function applyEffectiveTheme() {
  const effectiveTheme = currentMode === 'auto'
    ? (systemTheme?.matches ? 'dark' : 'light')
    : currentMode
  document.documentElement.dataset.theme = effectiveTheme
}

function updateDescription(followingMode) {
  const description = `Switch to ${followingMode} mode`
  switchEl.title = description
  switchEl.setAttribute('aria-label', description)
}

function loadMode() {
  try {
    const mode = localStorage.getItem(STORAGE_KEY)
    return MODES.includes(mode) ? mode : 'auto'
  }
  catch {
    return 'auto'
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  }
  catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1)
}
