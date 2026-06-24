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
