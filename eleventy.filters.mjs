import * as util from './eleventy.util.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Compute prod mode locally so filters remain self-contained
const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourcesPath = path.join(__dirname, 'label-icons.json')
const configPath = path.join(__dirname, 'label-icons-config.json')

let labelIconSourceSet = new Set()
let labelIconAliases = {}
let labelIconTints = {}

const longDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })
const compactNumberFormatter = new Intl.NumberFormat('en', { notation: 'compact' })
const groupedNumberFormatter = new Intl.NumberFormat('en', { useGrouping: true })
{
  const rawSources = fs.readFileSync(sourcesPath, 'utf8')
  const sourcesData = JSON.parse(rawSources)
  if (!sourcesData || typeof sourcesData !== 'object') {
    throw new Error(`Unexpected data format in ${sourcesPath}; expected object mapping labels to tints`)
  }
  const labelIconSources = Object.keys(sourcesData)
  labelIconSourceSet = new Set(labelIconSources)
  labelIconTints = sourcesData

  const rawConfig = fs.readFileSync(configPath, 'utf8')
  const configData = JSON.parse(rawConfig)
  if (!configData || typeof configData.aliases !== 'object') {
    throw new Error(`Missing or invalid "aliases" object in ${configPath}`)
  }

  labelIconAliases = configData.aliases
}

// Filters as normal functions
// simple to date string for some dates without times
export function date_format(date) {
  if (typeof date !== 'string') return date
  const value = new Date(date)
  return longDateFormatter.format(value)
}

// simple to date string for some dates _with_ times
export function date_time_format(date) {
  return (new Date(date)).toISOString().slice(0, 16).replace('T', ' ')
}

// number of seconds since epoch, to facilitate comparisons in search
export function timestamp(date) {
  if (typeof date !== 'string') return date
  return (new Date(date)).getTime() / 1000
}

// compact number formatting (e.g. 10k)
export function compact(count) {
  return compactNumberFormatter.format(count)
}

export function label_icon_aliases_json() {
  return JSON.stringify(labelIconAliases)
}

export function label_icon_tints_json() {
  return JSON.stringify(labelIconTints)
}

function canonicalLabel(label) {
  if (typeof label !== 'string') return ''
  const normalized = label.trim().toLowerCase()
  if (!normalized) return ''

  const alias = labelIconAliases[normalized]
  if (alias && labelIconSourceSet.has(alias)) {
    return alias
  }

  if (labelIconSourceSet.has(normalized)) {
    return normalized
  }

  return ''
}

export function label_icon_id(label) {
  const canonical = canonicalLabel(label)
  if (!canonical) return ''
  return `label-icon-${canonical}`
}

export function label_icon_tint(label) {
  const canonical = canonicalLabel(label)
  if (!canonical) return ''
  return labelIconTints[canonical] ?? ''
}

// number formatting with grouping (e.g. 10,000)
export function grouping(count) {
  return groupedNumberFormatter.format(count)
}

export function format_requirement(spec) {
  if (typeof spec !== 'string') return spec
  const trimmed = spec.replace(/\s+/g, '')
  if (trimmed === '' || trimmed === '*') return '*'
  if (trimmed == '>=3000') return '*'

  if (trimmed.startsWith('<=')) {
    const base = Number.parseInt(trimmed.slice(2), 10)
    return `<ST${base + 1}`
  }
  if (trimmed.startsWith('<')) {
    return `<ST${trimmed.slice(1)}`
  }
  if (trimmed.startsWith('>=')) {
    const base = Number.parseInt(trimmed.slice(2), 10)
    if (base === 3000) return '*'
    if (base === 4000) return '>ST4000'
    return `>ST${base - 1}`
  }
  if (trimmed.startsWith('>')) {
    const base = Number.parseInt(trimmed.slice(1), 10)
    if (base === 2999) return '*'
    if (base === 3999) return '>ST4000'
    return `>ST${base}`
  }
  if (/^\d{4}-\d{4}$/.test(trimmed)) {
    const [low, high] = trimmed.split('-')
    return `ST${low} - ${high}`
  }
  if (/^\d{4}$/.test(trimmed)) {
    return `ST${trimmed}`
  }
  return trimmed
}

// cache bust static files
export function bust(p) {
  if (!isProd) return p
  return p.replace('static/', 'static_' + util.gitHash + '/')
}

// Inline tests (Vitest)
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('date_time_format', () => {
    it.each([
      [[new Date('2025-09-08T11:12:59Z')], '2025-09-08 11:12'],
      [['2025-09-08T00:01:00Z'], '2025-09-08 00:01'],
      [['2025-09-08T11:12:00Z'], '2025-09-08 11:12'],
      [['2025-01-01T00:00:00Z'], '2025-01-01 00:00'],
    ])('date_time_format(%j) -> %s', (args, expected) => {
      expect(date_time_format(...args)).toBe(expected)
    })

    it('throws on invalid date input', () => {
      expect(() => date_time_format('not-a-date')).toThrow()
    })
  })

  describe('format_requirement', () => {
    it.each([
      ['>2999', '*'], // invariant: >2999 implies any
      ['>=3000', '*'], // invariant: >=3000 implies any
      ['>3999', '>ST4000'], // invariant: avoid the 999's
      ['>=4000', '>ST4000'], // invariant: avoid the 999's
      ['>=4078', '>ST4077'],
      ['>4078', '>ST4078'],
      ['3092', 'ST3092'],
      ['3092-4000', 'ST3092 - 4000'],
      ['<3092', '<ST3092'],
      ['<=3092', '<ST3093'],
    ])('format_requirement(%s) -> %s', (input, expected) => {
      expect(format_requirement(input)).toBe(expected)
    })
  })
}
