/**
 * Define the <human-date> custom element.
 */

;(function () {
  // WebComponent helpers
  // setup attributes and the corresponding properties
  function setupReflectedAttributes(klass) {
    const schema = klass.attrs || {}
    const descriptors = {}

    for (const [name, type] of Object.entries(schema)) {
      const prop = dashToCamel(name) // attribute names are kebab, properties camel
      descriptors[prop] = type === 'bool'
        ? reflectBool(name)
        : reflectString(name)
    }
    Object.defineProperties(klass.prototype, descriptors)
    klass.observedAttributes = Object.keys(schema)
  }

  function dashToCamel(attr) {
    return attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  }

  function reflectString(attr) {
    return {
      get() {
        return this.getAttribute(attr)
      },
      set(v) {
        if (v == null) {
          this.removeAttribute(attr)
        } else {
          this.setAttribute(attr, v)
        }
      },
    }
  }

  function reflectBool(attr) {
    return {
      get() {
        return this.hasAttribute(attr)
      },
      set(v) {
        if (v) {
          this.setAttribute(attr, '')
        } else {
          this.removeAttribute(attr)
        }
      },
    }
  }

  class HumanDateElement extends HTMLElement {
    static attrs = {
      'abbreviate-months': 'bool',
      'always-months': 'bool',
      clickable: 'bool',
      datetime: 'string',
      raw: 'bool',
    }

    constructor() {
      super()
      this.attachShadow({ mode: 'open' })
      this._timer = null

      this._text = document.createElement('span')

      const desc = document.createElement('span')
      desc.style.display = 'none'
      desc.id = 'desc'
      desc.textContent = 'Toggle date format.'

      this.shadowRoot.append(this._text, desc)
    }

    connectedCallback() {
      this._render()
    }

    disconnectedCallback() {
      this._clearTimer()
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (name === 'clickable') {
        if (newVal !== null) {
          this._text.setAttribute('role', 'button')
          this._text.setAttribute('tabindex', '0')
          this._text.setAttribute('aria-describedby', 'desc')
          this._text.setAttribute('aria-pressed', this.raw ? 'true' : 'false')
          this._text.addEventListener('click', this._toggleRaw)
          this._text.addEventListener('keydown', this._handleKeyboard)
        } else {
          this._text.removeAttribute('role')
          this._text.removeAttribute('tabindex')
          this._text.removeAttribute('aria-describedby')
          this._text.removeAttribute('aria-pressed')
          this._text.removeEventListener('click', this._toggleRaw)
          this._text.removeEventListener('keydown', this._handleKeyboard)
        }
      }
      if (name === 'raw' && this.clickable) {
        if (newVal !== null) {
          this._text.setAttribute('aria-pressed', 'true')
        } else {
          this._text.setAttribute('aria-pressed', 'false')
        }
      }
      if (
        ['abbreviate-months', 'always-months', 'datetime', 'raw'].includes(name)
        && oldVal !== newVal
      ) {
        this._render()
      }
    }

    _handleKeyboard = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        this._toggleRaw(ev)
      }
    }

    _toggleRaw = (ev) => {
      if (ev.altKey) {
        return // alt/option + click to avoid toggle
      }
      const sel = typeof this.shadowRoot.getSelection === 'function'
        ? this.shadowRoot.getSelection()
        : document.getSelection()
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        return
      }
      this.toggleAttribute('raw')
    }

    _clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    }

    _parseDate(raw) {
      if (!raw || typeof raw !== 'string') {
        return null
      }
      const actual_iso = raw.replace(' ', 'T') + (raw.endsWith('Z') ? '' : 'Z')
      const d = new Date(actual_iso)
      return isNaN(d.getTime()) ? null : d
    }

    _format(now, dt) {
      const ms = now - dt
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      const year = 365 * day

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dtStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
      const yesterdayStart = new Date(todayStart.getTime() - day)

      // Always show month if attribute is present
      const alwaysMonths = this.hasAttribute('always-months')
      // Use full month if attribute is present, otherwise short (Jan vs January)
      const abbreviate = this.hasAttribute('abbreviate-months')
      const monthFormat = abbreviate ? { month: 'short' } : { month: 'long' }
      const monthFmt = new Intl.DateTimeFormat('en-US', monthFormat)
      const yearNum = new Intl.DateTimeFormat('en-US', { year: 'numeric' })
      const hm = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

      if (!alwaysMonths && ms > 7 * year) {
        return yearNum.format(dt)
      }
      if (ms > 1 * year) {
        return `${monthFmt.format(dt)} ${yearNum.format(dt)}`
      }
      if (dtStart.getTime() === yesterdayStart.getTime()) {
        return 'yesterday'
      }
      if (todayStart - dtStart > 1 * day) {
        const dayNum = new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(dt)
        return `${monthFmt.format(dt)} ${dayNum}, ${yearNum.format(dt)}`
      }
      if (ms >= 6 * hour) {
        return `${hm.format(dt)}, today`
      }
      if (ms < minute) {
        return 'just now'
      }
      const mins = Math.floor(ms / minute)
      if (mins < 60) {
        return `${mins} minute${mins === 1 ? '' : 's'} ago`
      }
      const hours = Math.floor(ms / hour)
      return `${hours} hour${hours === 1 ? '' : 's'} ago`
    }

    _nextUpdateInMs(now, dt) {
      const ms = now - dt
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dtStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
      const tomorrowStart = new Date(todayStart.getTime() + day)
      const nextMinute = minute - (now.getSeconds() * 1000 + now.getMilliseconds())

      if (ms < 6 * hour && dtStart.getTime() === todayStart.getTime()) {
        return Math.max(5 * 1000, nextMinute)
      }
      if (ms >= 6 * hour && dtStart.getTime() === todayStart.getTime()) {
        return tomorrowStart.getTime() - now.getTime() + 250
      }
      const yesterdayStart = new Date(tomorrowStart.getTime() - day)
      if (dtStart.getTime() === yesterdayStart.getTime()) {
        return tomorrowStart.getTime() - now.getTime() + 250
      }
      return null
    }

    _render() {
      this._clearTimer()
      const raw = this.getAttribute('datetime')
      const dt = this._parseDate(raw)

      if (!dt) {
        this.title = raw || ''
        return
      }

      const now = new Date()
      const shortFormat = this._format(now, dt)
      const abbreviate = this.hasAttribute('abbreviate-months')
      const monthFormat = abbreviate ? 'short' : 'long'
      const longFormat = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: monthFormat,
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(dt).replace(' at', ',')
      const showRaw = this.hasAttribute('raw')
      if (showRaw) {
        this._text.textContent = longFormat
        this.title = shortFormat
      } else {
        this._text.textContent = shortFormat
        this.title = longFormat
      }

      const wait = this._nextUpdateInMs(now, dt)
      if (wait != null && isFinite(wait) && wait > 0) {
        this._timer = setTimeout(() => this._render(), wait)
      }
    }
  }

  setupReflectedAttributes(HumanDateElement)
  customElements.define('human-date', HumanDateElement)
})()
