import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'
import { configureMarked, isMarkdown, renderReadmeMarkdown } from './readme-renderer.mjs'

configureMarked(marked)

const target = document.getElementById('md')
const source = target.dataset.readmeUrl

const cacheKey = 'md:' + source
const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')

const now = Math.floor(Date.now() / 1000)
const ttl = 60 * 60 // 1 hour in seconds

window.addEventListener('hashchange', scroll_readme_anchor)

if (cached && (now - cached.time) < ttl) {
  target.innerHTML = cached.html
  scroll_readme_anchor()
}
else {
  load_readme_markdown(source)
    .then((md) => {
      if (DOMPurify.isSupported && isMarkdown(source)) {
        target.innerHTML = renderReadmeMarkdown(marked, md, source, {
          sanitize: html => DOMPurify.sanitize(html),
          parseHtml: html => new DOMParser().parseFromString(html, 'text/html'),
        })
        scroll_readme_anchor()
      }
      else {
        const escaped = md
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        const pre = document.createElement('pre')
        pre.classList.add('fallback')
        pre.innerHTML = escaped
        target.appendChild(pre)
      }
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
}

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

function scroll_readme_anchor() {
  const slug = readme_hash_slug()
  if (!slug) {
    return
  }

  const anchor = document.getElementById(`readme-${slug}`)
  if (anchor) {
    anchor.scrollIntoView({ block: 'start' })
  }
}

function readme_hash_slug() {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''))
  } catch {
    return window.location.hash.replace(/^#/, '')
  }
}
