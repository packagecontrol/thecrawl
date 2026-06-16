const configuredMarked = new WeakSet()
let headingSlugCounts = new Map()

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
<a class="markdown-anchor" href="#${slug}" aria-labelledby="${id}"></a>\
</h${level}>`
  },
}

export function configureMarked(marked) {
  if (configuredMarked.has(marked)) {
    return
  }

  marked.use({ extensions: [markdownAlertExtension], renderer: readmeHeadingRenderer })
  configuredMarked.add(marked)
}

export function renderReadmeMarkdown(marked, markdown, baseUrl, { sanitize, parseHtml }) {
  headingSlugCounts = new Map()
  const html = marked.parse(markdown)
  const html_ = postProcessHtml(html, baseUrl, parseHtml)
  return sanitize(html_)
}

export function isMarkdown(url) {
  return /(readme|\.md|\.mkd|\.mdown|\.markdown|\.txt)$/i.test(url)
}

function postProcessHtml(html, baseUrl, parseHtml) {
  const doc = parseHtml(html)
  const base = new URL(baseUrl)

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
