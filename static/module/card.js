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
    this.states(labels)
    this.platforms(labels)
    this.labels(labels)
    this.stats()

    return this.clone
  }

  stats() {
    const star = this.clone.querySelector('ul.stats .stars')
    const install = this.clone.querySelector('ul.stats .installs')

    if (this.pkg.removed || this.pkg.doa) {
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
      parent.appendChild(this.button(item))
    })
  }

  states(parent) {
    if (this.pkg.outdated) {
      parent.appendChild(this.button('ST2', 'Outdated package for Sublime Text 2'))
    }
    else if (this.pkg.st3_only) {
      parent.appendChild(this.button('ST3', 'Compatible with Sublime Text 3 only'))
    }

    if (this.pkg.archived_at) {
      const date = new Date(Number(this.pkg.archived_at) * 1000)
      parent.appendChild(this.button('Unmaintained', 'Repository was archived on ' + this.pretty(date)))
    }
    else if (this.pkg.doa) {
      parent.appendChild(this.button('R.I.P.', 'Package was never crawled'))
    }
    else if (this.pkg.removed) {
      const date = new Date(Number(this.pkg.removed) * 1000)
      parent.appendChild(this.button('R.I.P.', 'Package was removed on ' + this.pretty(date)))
    }
  }

  button(name, tooltip = null) {
    const li = document.createElement('li')
    const a = document.createElement('a')

    if (name.startsWith('linux') || name.startsWith('macos') || name.startsWith('windows')) {
      a.classList.add('button', 'platform', 'platform-' + name)
      a.setAttribute('href', searchQueryFor('platform', name))
    }
    else if (['ST2', 'ST3', 'Unmaintained', 'R.I.P.'].includes(name)) {
      a.classList.add('button', 'state', 'state-' + (name == 'ST3' ? 'warning' : 'bad'))
      a.setAttribute('href', searchQueryFor('state', name))
    }
    else {
      a.classList.add('button', 'label')
      a.setAttribute('href', searchQueryFor('label', name))
    }

    if (tooltip) {
      a.setAttribute('title', tooltip)
    }

    a.innerText = name
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
