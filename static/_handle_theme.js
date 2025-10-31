/**
 * Handle color scheme immediately as the page loads
 */

(function () {
  const system_theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const user_pref = localStorage.getItem('theme')
  document.documentElement.setAttribute('data-theme', user_pref ?? system_theme)
})()
