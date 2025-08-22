;(function(){
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
    }

    connectedCallback() {
      this.setAttribute('role', 'button')
      this.setAttribute('tabindex', '0')
      this.setAttribute('aria-label', 'Toggle between relative and absolute date')
      this._render()
    }

    disconnectedCallback() {
      this._clearTimer()
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (name === 'raw') {
        if (newVal !== null) {
          this.setAttribute('aria-pressed', 'true')
        } else {
          this.setAttribute('aria-pressed', 'false')
        }
      }
      if ((name === 'datetime' || name === 'raw' || name === 'abbreviate-months' || name === 'always-months') && oldVal !== newVal) {
        this._render()
      }
      if (name === 'clickable') {
        if (newVal !== null) {
          this.addEventListener('click', this._toggleRaw)
          this.addEventListener('keydown', this._handleKeyboard)
        } else {
          this.removeEventListener('click', this._toggleRaw)
          this.removeEventListener('keydown', this._handleKeyboard)
        }
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
      const formatted_text = this._format(now, dt)
      const iso_formatted = dt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      const iso_ish = formatAsLocalISO(dt)
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
      })
      const github_style = longFormat.format(dt).replace(' at', ',')
      const showRaw = this.hasAttribute('raw')
      if (showRaw) {
        this.shadowRoot.textContent = github_style
        this.title = formatted_text
      } else {
        this.shadowRoot.textContent = formatted_text
        this.title = github_style
      }

      const wait = this._nextUpdateInMs(now, dt)
      if (wait != null && isFinite(wait) && wait > 0) {
        this._timer = setTimeout(() => this._render(), wait)
      }
    }
  }

  setupReflectedAttributes(HumanDateElement)
  customElements.define('human-date', HumanDateElement)

  const _formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  })

  function formatAsLocalISO(dt) {
    const parts = _formatter.formatToParts(dt)
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]))
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute} ${map.timeZoneName}`
  }
})()

