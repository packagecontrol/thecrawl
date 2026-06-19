import DOMPurify from './vendor/dompurify/purify.es.mjs'
import { marked } from './vendor/marked/marked.esm.js'
import { configureMarked, renderReadme, renderReadmePlainText } from './readme-renderer.mjs'

configureMarked(marked)

const target = document.getElementById('md')
const source = target.dataset.readmeUrl

const cacheKey = 'md:' + source

window.__packageReadmeAnchors?.install()

load_readme_markdown(source)
  .then((md) => {
    target.innerHTML = DOMPurify.isSupported
      ? renderReadme(marked, md, source, {
          sanitize: html => DOMPurify.sanitize(html),
          parseHtml: html => new DOMParser().parseFromString(html, 'text/html'),
        })
      : renderReadmePlainText(md)
    window.__packageReadmeAnchors?.scrollOnInitialLoad()

    const now = Math.floor(Date.now() / 1000)
    sessionStorage.setItem(cacheKey, JSON.stringify({ html: target.innerHTML, time: now }))
  })
  .catch((err) => {
    console.error('Failed to load readme:', err)
    if (source.includes('codeberg.org/') || source.includes('gitlab.com/')) {
      target.style.display = 'none'
    }
    else {
      target.style.textAlign = 'center'
      target.innerHTML = '😒<br>The readme failed to load.'
    }
  })

function load_readme_markdown(url) {
  const prefetched = window.__packageReadmeFetches?.get(url)
  if (prefetched) {
    return prefetched
  }

  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    return res.text()
  })
}
