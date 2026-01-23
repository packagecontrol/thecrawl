const systemPref = window.matchMedia('(prefers-color-scheme: dark)')

function getSystemTheme() {
  return systemPref.matches ? 'dark' : 'light'
}

function getStoredTheme() {
  const v = localStorage.getItem('theme')
  return v === 'dark' || v === 'light' ? v : null
}

function getEffectiveTheme() {
  return getStoredTheme() ?? getSystemTheme()
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

function setStoredThemeOrSystem(theme) {
  // If the chosen theme matches system, treat it as "system" (no override).
  if (theme === getSystemTheme()) {
    localStorage.removeItem('theme')
  } else {
    localStorage.setItem('theme', theme)
  }
}

function toggleThemeUser() {
  const current = getEffectiveTheme()
  const next = current === 'dark' ? 'light' : 'dark'

  setStoredThemeOrSystem(next)
  applyTheme(next)
}

// initial apply
applyTheme(getEffectiveTheme())

document.querySelector('#theme-toggle').addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  toggleThemeUser()
})

systemPref.addEventListener('change', () => {
  // only affects us when there is no override
  if (getStoredTheme() == null) {
    applyTheme(getSystemTheme())
  }
})

function setKeyframe(el, t) {
  if (!el) return

  // clamp
  t = Math.max(0, Math.min(1, t))

  const durationSeconds = 3600 // 60 minutes
  const delaySeconds = -durationSeconds * t
  const nextVal = delaySeconds == 0 ? '' : `${delaySeconds}s`
  if (el.style.animationDelay == nextVal) return

  // let the engine apply the new delay
  el.style.animationPlayState = 'running'
  el.style.animationDelay = nextVal

  // then freeze at that frame
  requestAnimationFrame(() => {
    el.style.animationPlayState = 'paused'
  })
}

function computeMoonProgress(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes()

  /* eslint-disable @stylistic/no-multi-spaces */
  const FADE_IN_START  = 21 * 60 // 21:00
  const FADE_IN_END    = 22 * 60 // 22:00

  const FADE_OUT_START =  4 * 60 // 04:00
  const FADE_OUT_END   =  5 * 60 // 05:00
  /* eslint-enable @stylistic/no-multi-spaces */

  // --- FADE IN: 21:00 → 22:00 (0 → 1) ---
  if (minutes >= FADE_IN_START && minutes < FADE_IN_END) {
    return (minutes - FADE_IN_START) / (FADE_IN_END - FADE_IN_START)
  }

  // --- FULL GLOW: 22:00 → 24:00 ---
  if (minutes >= FADE_IN_END) {
    return 1
  }

  // --- FULL GLOW: 00:00 → 04:00 ---
  if (minutes < FADE_OUT_START) {
    return 1
  }

  // --- FADE OUT: 04:00 → 05:00 (1 → 0) ---
  if (minutes < FADE_OUT_END) {
    return 1 - (minutes - FADE_OUT_START) / (FADE_OUT_END - FADE_OUT_START)
  }

  // --- DAYTIME: 05:00 → 21:00 ---
  return 0
}

function computeSunProgress(date = new Date()) {
  if (!inHotSeason(date)) {
    return 0
  }

  const minutes = date.getHours() * 60 + date.getMinutes()

  /* eslint-disable @stylistic/no-multi-spaces */
  const FADE_IN_START   = 10 * 60 + 30 // 10:30
  const FADE_IN_END     = 12 * 60      // 12:00

  const FADE_OUT_START  = 12 * 60 + 30 // 12:30
  const FADE_OUT_END    = 15 * 60      // 15:00
  /* eslint-enable @stylistic/no-multi-spaces */

  // --- FADE IN: 10:30 → 12:00 ---
  if (minutes >= FADE_IN_START && minutes < FADE_IN_END) {
    return (minutes - FADE_IN_START) / (FADE_IN_END - FADE_IN_START)
  }

  // --- FULL GLOW: 12:00 → 12:30 ---
  if (minutes >= FADE_IN_END && minutes < FADE_OUT_START) {
    return 1
  }

  // --- FADE OUT: 12:30 → 15:00 ---
  if (minutes >= FADE_OUT_START && minutes < FADE_OUT_END) {
    return 1 - (minutes - FADE_OUT_START) / (FADE_OUT_END - FADE_OUT_START)
  }

  // --- Outside glow window ---
  return 0
}

function inHotSeason(date = new Date()) {
  // Northern hemisphere is the default. (Likely most users are here anyway; worst case: a false-positive.)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  const south = /^(America\/(Argentina|Santiago|Montevideo)|Australia\/|Pacific\/Auckland|Africa\/Johannesburg)/.test(tz)

  /* eslint-disable @stylistic/no-multi-spaces */
  const m = date.getMonth() + 1 // 1..12
  const d = date.getDate()      // 1..31
  /* eslint-enable @stylistic/no-multi-spaces */

  // Europe-ish: June 1 → Aug 15 (inclusive)
  const northHot = (m === 6) || (m === 7) || (m === 8 && d <= 15)

  // Southern hemisphere "hot": Dec 1 → Feb 28/29
  const southHot = (m === 12) || (m === 1) || (m === 2)

  return south ? southHot : northHot
}

function updateIcons(date = new Date()) {
  const darkIcon = document.querySelector('#theme-toggle .dark')
  if (darkIcon) {
    const t = computeMoonProgress(date)
    setKeyframe(darkIcon, t)
  }
  const lightIcon = document.querySelector('#theme-toggle .light')
  if (lightIcon) {
    const t = computeSunProgress(date)
    setKeyframe(lightIcon, t)
  }
}

// Run on load
updateIcons()
// window.__updateIcons = updateIcons
// window.__setKeyframe = setKeyframe

// ...and update once per minute
setInterval(updateIcons, 60_000)
