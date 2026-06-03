export class Card {
  pkg = {}
  clone
  compact = false
  staticBase = window.STATIC_BASE ?? '/static/'

  constructor(data, compact = null) {
    this.pkg = data
    this.compact = compact === 'compact'

    const templateId = this.compact ? 'package-card-compact' : 'package-card-result'
    const template = document.querySelector(`template#${templateId}`)
    this.clone = template.content.cloneNode(true)
    this.formatter = new Intl.NumberFormat('en', { notation: 'compact' })
  }

  render() {
    const cardRoot = this.clone.querySelector('.card')
    if (cardRoot) {
      cardRoot.classList.toggle('dimmed', Boolean(this.pkg.outdated))
      this.insertDebugComment(cardRoot)
    }

    this.clone.querySelector('.card-heading a').innerHTML = this.pkg.name
    const permalink = '/packages/' + encodeURIComponent(this.pkg.name)
    this.clone.querySelector('.card-heading a').setAttribute('href', permalink)
    this.authors(this.clone.querySelector('p.authors'))

    const descr_el = this.clone.querySelector('p.description')
    if (descr_el) {
      if (!this.pkg.description) {
        descr_el.remove()
      } else {
        descr_el.innerHTML = this.pkg.description
      }
    }

    const labels = this.clone.querySelector('ul.labels')
    // clear the placeholder then fill with data
    labels.innerHTML = ''
    this.platforms()
    this.labels(labels)
    this.stats()

    return this.clone
  }

  insertDebugComment(cardRoot) {
    if (window.IS_PROD)
      return

    const debugText = this.buildDebugComment()
    if (!debugText) {
      return
    }
    const comment = document.createComment(`\n${debugText}\n`)
    cardRoot.before(comment)
  }

  buildDebugComment() {
    const breakdown = this.pkg?.magic
    if (!breakdown || typeof breakdown !== 'object') {
      return null
    }

    const formatValue = (value) => {
      const num = Number(value)
      return Number.isFinite(num) ? num.toFixed(4) : '0.0000'
    }
    const formatOptional = (num) => {
      return Number.isFinite(num) ? num.toFixed(4) : '   n/a'
    }
    const pad = label => label.padEnd(21, ' ')
    const prefix = '    '

    const formatContribution = (label, rawValue, showSign, forceNegative = false) => {
      const value = Number(rawValue) || 0
      const magnitude = Math.abs(value)
      const formatted = formatValue(magnitude)
      if (!showSign) {
        return `${prefix}${pad(label)}  ${formatted}    `
      }
      const sign = value < 0 || forceNegative ? '-' : '+'
      return `${prefix}${pad(label)}${sign} ${formatted}    `
    }

    const sections = []
    const contributions = [
      ['popularity', breakdown.popularity, false, false],
      ['stars', breakdown.stars, true, false],
      ['freshness', breakdown.freshness, true, false],
      ['longevity', breakdown.longevity, true, false],
      ['recency', breakdown.recency, true, false],
      ['penalty', breakdown.penalty, true, true],
    ]

    contributions.forEach(([label, value, showSign, forceNegative]) => {
      if (typeof value === 'undefined') {
        return
      }
      sections.push(formatContribution(label, value, showSign, forceNegative))
    })

    if (sections.length === 0) {
      return null
    }

    const metadataScore = toFinite(this.pkg?.magic_score)
    const finalScore = toFinite(this.pkg?.__magicRanking?.final)
    const normalizedMini = toFinite(this.pkg?.__magicRanking?.normalizedMini)
    const miniFactor = toFinite(this.pkg?.__magicRanking?.factor)

    sections.push(`${prefix}-----------------------------`)
    sections.push(`${prefix}${pad('magic score')}  ${formatOptional(metadataScore)}    `)

    if (normalizedMini !== null && miniFactor !== null) {
      const normalizedDisplay = Number(normalizedMini).toFixed(2)
      const leftSide = `mini score ${normalizedDisplay}≘`
      sections.push(`${prefix}${pad(leftSide)}x ${formatValue(miniFactor)}`)
    }
    else {
      const miniDisplay = formatOptional(toFinite(this.pkg?.score))
      sections.push(`${prefix}${pad('mini score')}  ${miniDisplay}`)
    }

    if (finalScore !== null) {
      sections.push(`${prefix}-----------------------------`)
      sections.push(`${prefix}${pad('final weighted')}  ${formatOptional(finalScore)}`)
    }

    return sections.join('\n')
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
    if (!this.pkg.author) {
      parent.remove()
      return
    }

    const list = this.pkg.author.split(',').map(name => name.trim())

    parent.innerHTML = 'by '
    for (let i = 0; i < list.length; i += 1) {
      const name = list[i]
      const a = document.createElement('a')
      a.setAttribute('href', searchQueryFor('author', name))
      a.innerText = name
      parent.appendChild(a)
      if (i + 1 < list.length) {
        parent.appendChild(document.createTextNode(', '))
      }
    }
  }

  platforms() {
    const label = typeof this.pkg.platform_statement === 'string'
      ? this.pkg.platform_statement.trim()
      : ''

    if (!label) {
      this.clone.querySelector('.card-meta .platforms')?.remove()
      this.clone.querySelector('.card-footer .platform-statement')?.remove()
      return
    }

    if (this.compact) {
      const platformStatement = this.clone.querySelector('.card-footer .platform-statement')
      if (!platformStatement) {
        return
      }
      platformStatement.textContent = label
      platformStatement.closest('.card-footer')?.classList.toggle(
        'card-footer-enumeration',
        this.countPlatformSeparators(label) >= 2,
      )
      return platformStatement
    }

    const platforms = this.clone.querySelector('.card-meta .platforms')
    if (!platforms) {
      return
    }
    platforms.textContent = label

    return platforms
  }

  countPlatformSeparators(label) {
    return label.split('/').length - 1
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
        case 'FAILING':
          parent.appendChild(this.button(item,
            'Package metadata updates are currently failing'))
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

    a.classList.add('button', 'label')
    a.setAttribute('href', searchQueryFor('label', name))

    const iconId = resolveLabelIconId(name)
    if (iconId) {
      const svgNS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNS, 'svg')
      const canonical = iconId.replace(/^label-icon-/, '')
      const tint = resolveLabelIconTint(canonical)
      svg.setAttribute('class', `label-icon${tint ? ' label-icon--' + tint : ''}`)
      svg.setAttribute('aria-hidden', 'true')
      const use = document.createElementNS(svgNS, 'use')
      use.setAttribute('href', `${this.staticBase}label-icons.svg#${iconId}`)
      svg.appendChild(use)
      a.appendChild(svg)
    }

    if (['ST2', 'RIP'].includes(name)) {
      a.classList.add('state', 'state-bad')
    }
    if (['ST3', 'MIA'].includes(name)) {
      a.classList.add('state', 'state-warning')
    }
    if (['FAILING'].includes(name)) {
      a.classList.add('state', 'state-failing')
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

const resolveLabelIconId = (label) => {
  if (typeof label !== 'string') return null
  const normalized = label.trim().toLowerCase()
  if (!normalized) return null

  const aliases = window.__LABEL_ICON_ALIASES__ ?? {}
  const tints = window.__LABEL_ICON_TINTS__ ?? {}

  let canonical = null
  const alias = aliases[normalized]
  if (alias && Object.prototype.hasOwnProperty.call(tints, alias)) {
    canonical = alias
  }
  else if (Object.prototype.hasOwnProperty.call(tints, normalized)) {
    canonical = normalized
  }

  if (!canonical) return null
  return `label-icon-${canonical}`
}

const resolveLabelIconTint = (canonical) => {
  const tints = window.__LABEL_ICON_TINTS__ ?? {}
  return tints[canonical]
}

const toFinite = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}
