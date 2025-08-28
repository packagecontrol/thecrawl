const link = document.querySelector('[href="/#search-field"]')
const referrer = new URL(document.referrer)

if (link && referrer.host === window.location.host && referrer.search) {
  link.href = '/' + referrer.search + '#search-field'
}
