import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'

const markdownAlertExtension = {
  name: 'markdownAlert',
  level: 'block',
  start(src) {
    const match = src.match(/^> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/m)
    return match ? match.index : undefined
  },
  tokenizer(src) {
    const rule = /^> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*(?:\n> ?.*)*/
    const match = rule.exec(src)
    if (!match) return

    const raw = match[0]
    const alertType = match[1].toLowerCase()
    const lines = raw.split('\n').map(line => line.replace(/^> ?/, ''))
    lines.shift()
    const text = lines.join('\n').replace(/^\n+/, '')
    const tokens = this.lexer.blockTokens(text, [])

    return {
      type: 'markdownAlert',
      raw,
      alertType,
      tokens,
    }
  },
  renderer(token) {
    const title = token.alertType.charAt(0).toUpperCase() + token.alertType.slice(1)
    const body = this.parser.parse(token.tokens)
    return `\
<div class="markdown-alert markdown-alert-${token.alertType}">\
<p class="markdown-alert-title">${title}</p>\
<p class="markdown-alert-content">${body}</p>\
</div>`
  },
}

let headingSlugCounts = new Map()

const readmeHeadingRenderer = {
  heading({ tokens, depth: level } = {}) {
    const html = this.parser.parseInline(tokens)
    const plain = tokens.map(token => token.text || '').join('')

    if (level > 4) {
      return `<h${level}>${html}</h${level}>`
    }

    const slug = unique_heading_slug(plain)
    const id = `readme-${slug}`
    return `\
<h${level} id="${id}">${html}\
<a class="markdown-anchor" href="?readme#${slug}" aria-labelledby="${id}"></a>\
</h${level}>`
  },
}

marked.use({ extensions: [markdownAlertExtension], renderer: readmeHeadingRenderer })

const target = document.getElementById('md')
const source = target.dataset.readmeUrl

const cacheKey = 'md:' + source
const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')

const now = Math.floor(Date.now() / 1000)
const ttl = 60 * 60 // 1 hour in seconds

if (cached && (now - cached.time) < ttl) {
  target.innerHTML = cached.html
  scroll_readme_anchor()
}
else {
  fetch(source)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`)
      return res.text()
    })
    .then((md) => {
      if (DOMPurify.isSupported && is_markdown(source)) {
        headingSlugCounts = new Map()
        const html = marked.parse(md)
        const html_ = post_process_html(html, source)
        const safe_content = DOMPurify.sanitize(html_)
        target.innerHTML = safe_content
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

function is_markdown(url) {
  return /(readme|\.md|\.mkd|\.mdown|\.markdown|\.txt)$/i.test(url)
}

function scroll_readme_anchor() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('readme')) {
    return
  }

  const slug = url.hash.replace(/^#/, '')
  if (!slug) {
    return
  }

  const anchor = document.getElementById(`readme-${slug}`)
  if (anchor) {
    anchor.scrollIntoView({ block: 'start' })
  }
}

function unique_heading_slug(text) {
  // Avoid duplicate ids/anchors when headings share the same text.
  const base = slugify_heading(text)
  const count = headingSlugCounts.get(base) ?? 0
  headingSlugCounts.set(base, count + 1)
  if (count === 0) {
    return base
  }

  return `${base}-${count}`
}

function slugify_heading(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function post_process_html(html, base_url) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const base = new URL(base_url)

  doc.querySelectorAll('a[href], img[src], video[src]').forEach((el) => {
    if (el.matches('a.markdown-anchor')) {
      return
    }

    const attr = el.hasAttribute('href') ? 'href' : 'src'
    const val = el.getAttribute(attr)
    if (val && !val.match(/^([a-z]+:|#|\/)/i)) {
      // relative URL, resolve it
      el.setAttribute(attr, new URL(val, base).href)
    }
  })

  doc.querySelectorAll('video[src]').forEach((el) => {
    el.setAttribute('controls', 'controls')
  })

  // Replace packagecontrol.io references with packages.sublimetext.io
  // Only rewrite URLs that point at the old homepage ("/")
  // or "/packages/*" paths, since those are the only pages
  // mirrored on the new domain.
  doc.querySelectorAll('a[href]').forEach((el) => {
    const href = el.getAttribute('href')
    if (!href || !href.includes('packagecontrol.io')) {
      return
    }

    let url
    try {
      url = new URL(href, base)
    } catch {
      return
    }

    const hostname = url.hostname.toLowerCase()
    if (hostname !== 'packagecontrol.io') {
      return
    }

    const path = url.pathname || '/'
    const isHomepage = path === '/'
    const isPackagePage = path.startsWith('/packages/')
    if (isHomepage || isPackagePage) {
      url.hostname = 'packages.sublimetext.io'
      el.setAttribute('href', url.toString())
    }
  })

  return doc.body.innerHTML
}
