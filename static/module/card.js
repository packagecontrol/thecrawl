export class Card {
  pkg = {}
  clone
  compact = false

  constructor(data, compact = null) {
    this.pkg = data
    this.compact = compact === 'compact'

    const template = document.querySelector('template#package-card')
    this.clone = template.content.cloneNode(true)
    this.formatter = new Intl.NumberFormat('en', { notation: 'compact' })
  }

  render() {
    const cardRoot = this.clone.querySelector('.card')
    if (cardRoot) {
      cardRoot.classList.toggle('dimmed', Boolean(this.pkg.outdated))
    }

    this.clone.querySelector('a').innerHTML = this.pkg.name
    this.clone.querySelector('a').setAttribute('href', this.pkg.permalink)
    this.authors(this.clone.querySelector('p.authors'))

    const descr_el = this.clone.querySelector('p.description')
    if (this.compact) {
      descr_el.remove()
    } else {
      descr_el.innerHTML = this.pkg.description
    }

    const labels = this.clone.querySelector('ul.labels')
    // clear the placeholder then fill with data
    labels.innerHTML = ''
    this.platforms(labels)
    this.labels(labels)
    this.stats()

    return this.clone
  }

  stats() {
    const star = this.clone.querySelector('ul.stats .stars')
    const install = this.clone.querySelector('ul.stats .installs')

    if (this.pkg.removed) {
      star.remove()
      install.remove()
      return
    }

    if (this.pkg.stars > 0) {
      star.setAttribute('title', this.pkg.stars + (this.pkg.stars < 2 ? ' star' : ' stars') + ' on GitHub')
      star.querySelector('.counter').innerText = this.formatter.format(Number(this.pkg.stars))
    }
    else {
      star.remove()
    }

    if (this.pkg.installed > 0) {
      install.setAttribute('title', 'Installed ' + this.pkg.installed + (this.pkg.installed < 2 ? ' time' : ' times'))
      install.querySelector('.counter').innerText = this.formatter.format(Number(this.pkg.installed))
    }
    else {
      install.remove()
    }
  }

  authors(parent) {
    if (this.pkg.author.length < 1) {
      parent.remove()
      return
    }

    parent.innerHTML = 'by '
    const list = this.pkg.author.split(',')
    list.forEach((name, iter) => {
      const a = document.createElement('a')
      a.setAttribute('href', searchQueryFor('author', name))
      a.innerText = name
      parent.appendChild(a)
      if (iter + 1 < list.length) {
        parent.appendChild(document.createTextNode(', '))
      }
    })
  }

  platforms(parent) {
    let os = this.pkg.platforms

    if (os.length < 1 || os.includes('any')) {
      return
    }

    os.split(',').forEach((item) => {
      parent.appendChild(this.button(item))
    })
  }

  labels(parent) {
    if (this.pkg.labels.length < 1) {
      return
    }

    this.pkg.labels.split(',').forEach((item) => {
      switch (item) {
        case 'ST2':
          parent.appendChild(this.button(item, 'Outdated package for Sublime Text 2'))
          break
        case 'ST3':
          parent.appendChild(this.button(item, 'Compatible with Sublime Text 3 only'))
          break
        case 'MIA':
          parent.appendChild(this.button(item,
            'Repository was archived on ' + this.pretty(new Date(Number(this.pkg.archived_at) * 1000))))
          break
        case 'RIP':
          parent.appendChild(this.button(item,
            'Package was removed on ' + this.pretty(new Date(Number(this.pkg.removed) * 1000))))
          break
        default:
          parent.appendChild(this.button(item))
      }
    })
  }

  button(name, tooltip = null) {
    const li = document.createElement('li')
    const a = document.createElement('a')

    if (name.startsWith('linux') || name.startsWith('macos') || name.startsWith('windows')) {
      a.classList.add('button', 'platform', 'platform-' + name)
      a.setAttribute('href', searchQueryFor('platform', name))
    }
    else {
      a.classList.add('button', 'label')
      a.setAttribute('href', searchQueryFor('label', name))

      const iconId = resolveLabelIconId(name)
      if (iconId) {
        const svgNS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(svgNS, 'svg')
        const canonical = iconId.replace(/^label-icon-/, '')
        svg.setAttribute('class', `label-icon label-icon--${canonical}`)
        svg.setAttribute('aria-hidden', 'true')
        const use = document.createElementNS(svgNS, 'use')
        use.setAttribute('href', `/static/label-icons.svg#${iconId}`)
        svg.appendChild(use)
        a.appendChild(svg)
      }
    }

    if (['ST2', 'RIP'].includes(name)) {
      a.classList.add('state', 'state-bad')
    }
    if (['ST3', 'MIA'].includes(name)) {
      a.classList.add('state', 'state-warning')
    }

    if (tooltip) {
      a.setAttribute('title', tooltip)
    }

    a.appendChild(document.createTextNode(name))
    li.appendChild(a)

    return li
  }

  pretty(date) {
    const value = new Date(date)
    return (new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })).format(value)
  }
}

const searchQueryFor = (field, rawValue) => {
  const value = String(rawValue ?? '').trim()
  if (!value) return '/?q='

  const filter = field === 'platform' && !value.includes(' ')
    ? `${field}:${value}`
    : `${field}:"${value}"`
  return '/?q=' + encodeURIComponent(filter)
}

function resolveLabelIconId(label) {
  if (typeof label !== 'string') return null
  const normalized = label.trim().toLowerCase()
  if (!normalized) return null

  const sources = Array.isArray(window.__LABEL_ICON_SOURCES__) ? window.__LABEL_ICON_SOURCES__ : []
  const aliases = (window.__LABEL_ICON_ALIASES__ && typeof window.__LABEL_ICON_ALIASES__ === 'object')
    ? window.__LABEL_ICON_ALIASES__
    : {}

  let canonical = aliases[normalized]
  if (!canonical && sources.includes(normalized)) {
    canonical = normalized
  }

  if (!canonical) return null
  return `label-icon-${canonical}`
}
