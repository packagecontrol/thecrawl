export class Card {
  pkg = {}
  clone

  constructor(data) {
    this.pkg = data

    const template = document.querySelector('template#package-card')
    this.clone = template.content.cloneNode(true)
    this.formatter = new Intl.NumberFormat('en', { notation: 'compact' })
  }

  render() {
    this.clone.querySelector('a').innerHTML = this.pkg.name
    this.clone.querySelector('a').setAttribute('href', this.pkg.permalink)
    this.authors(this.clone.querySelector('p'))

    const star = this.clone.querySelector('ul.stats .stars')
    const install = this.clone.querySelector('ul.stats .installs')
    const warning = this.clone.querySelector('ul.stats .warning')

    if (this.pkg.stars !== '0') {
      star.setAttribute('title', this.pkg.stars + (this.pkg.stars < 2 ? ' star' : ' stars') + ' on GitHub')
      star.querySelector('.counter').innerText = this.formatter.format(Number(this.pkg.stars))
    }
    else {
      star.remove()
    }

    if (this.pkg.installed !== '0') {
      install.setAttribute('title', 'Installed ' + this.pkg.installed + (this.pkg.installed < 2 ? ' time' : ' times'))
      install.querySelector('.counter').innerText = this.formatter.format(Number(this.pkg.installed))
    }
    else {
      install.remove()
    }

    if (this.pkg.archived_at) {
      const date = new Date(Number(this.pkg.archived_at) * 1000)
      warning.setAttribute('title', 'Repository was archived on ' + this.pretty(date))
      warning.querySelector('.counter').innerText = 'Unmaintained'
    }
    else if (this.pkg.doa) {
      warning.setAttribute('title', 'Package was never crawled')
      warning.querySelector('.counter').innerText = 'R.I.P.'
      this.clone.querySelector('h3').innerHTML = this.pkg.name
      this.clone.firstElementChild.classList.add('dead-on-arrival')
    }
    else if (this.pkg.removed) {
      const date = new Date(Number(this.pkg.removed) * 1000)
      warning.setAttribute('title', 'Package was removed on ' + this.pretty(date))
      warning.querySelector('.counter').innerText = 'R.I.P.'
    }
    else {
      warning.remove()
    }

    const labels = this.clone.querySelector('ul.labels')
    // clear the placeholder then fill with data
    labels.innerHTML = ''
    this.platforms(labels)
    this.labels(labels)

    return this.clone
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
      a.setAttribute('href', '/?q=' + encodeURI('author:"' + name.trim() + '"'))
      a.innerHTML = name
      parent.appendChild(a)
      if (iter + 1 < list.length) {
        parent.appendChild(document.createTextNode(', '))
      }
    })
  }

  platforms(parent) {
    if (this.pkg.platforms.length < 1) {
      return
    }

    this.pkg.platforms.split(',').forEach((item) => {
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

  button(name) {
    const li = document.createElement('li')
    const a = document.createElement('a')

    if (name.startsWith('linux') || name.startsWith('macos') || name.startsWith('windows')) {
      a.classList.add('button', 'platform', 'platform-' + name)
      a.setAttribute('href', '/?q=' + encodeURI('platform:"' + name + '"'))
    }
    else {
      a.classList.add('button', 'label')
      a.setAttribute('href', '/?q=' + encodeURI('label:"' + name + '"'))
    }

    if (name == 'Archived') {
      a.classList.add('archive')
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
