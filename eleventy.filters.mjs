import * as util from './eleventy.util.mjs'
import { normalizeSitePathPrefix } from './static/module/site-path.mjs'
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
let labelIconPrimarySourceSet = null
let labelIconSecondarySourceSet = null

const longDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })
const compactNumberFormatter = new Intl.NumberFormat('en', { notation: 'compact' })
const groupedNumberFormatter = new Intl.NumberFormat('en', { useGrouping: true })
const labelSortCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
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

export function package_name_breaks(name) {
  return escapeHtml(String(name))
    .replace(/([a-z\d])([A-Z])/g, '$1<wbr>$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1<wbr>$2')
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

export function configureLabelIcons(labels, { minimumUsage = 1, preferredPackages = [] } = {}) {
  labelIconPrimarySourceSet = primaryLabelIconSources(labels, minimumUsage, preferredPackages)
  labelIconSecondarySourceSet = new Set(
    Array.from(labelIconSourceSet).filter(source => !labelIconPrimarySourceSet.has(source)),
  )

  return {
    primarySources: labelIconPrimarySourceSet,
    secondarySources: labelIconSecondarySourceSet,
  }
}

export function label_normalization_note(changes) {
  const sortedChanges = changes
    .map(change => ({ from: String(change.from), to: String(change.to) }))
    .sort((a, b) => compareLabels(a.from, b.from) || compareLabels(a.to, b.to))

  const groups = []
  const groupByTarget = new Map()
  for (const change of sortedChanges) {
    let group = groupByTarget.get(change.to)
    if (!group) {
      group = { to: change.to, froms: [] }
      groupByTarget.set(change.to, group)
      groups.push(group)
    }
    group.froms.push(change.from)
  }

  const heading = sortedChanges.length === 1
    ? 'One label has been normalized'
    : 'Some labels have been normalized'
  const items = groups.map((group) => {
    const froms = joinAsSentenceList(group.froms.map(formatCode))
    return `<li>${froms} to ${formatCode(group.to)}</li>`
  }).join('')

  return `<p>* ${heading}</p><ul>${items}</ul>`
}

export function search_index_json(packages, installHistory) {
  return JSON.stringify({
    install_history: installHistory,
    packages: packages.map(compactSearchPackage),
    label_icon_aliases: labelIconAliases,
    label_icon_tints: labelIconTints,
    label_icon_secondary: Array.from(labelIconSecondarySourceSet ?? []),
  })
}

function compactSearchPackage(pkg) {
  const row = [
    pkg.name,
    htmlDescription(pkg.description ?? ''),
    (pkg.author ?? []).join(','),
    pkg.stars ?? 0,
    pkg.installs_total ?? 0,
    pkg.installs_recent ?? 0,
    timestamp(pkg.first_seen) || 0,
    timestamp(pkg.last_modified) || 0,
    pkg.magic_score ?? 0,
    compactMagicBreakdown(pkg.magic),
    (pkg.platforms ?? []).join(','),
    pkg.platform_statement ?? '',
    (pkg.labels ?? []).join(','),
  ]

  if (pkg.outdated || pkg.removed || pkg.archived_at) {
    row.push(
      pkg.outdated ? 1 : 0,
      timestamp(pkg.removed) || 0,
      timestamp(pkg.archived_at) || 0,
    )
  }

  return row
}

function compactMagicBreakdown(magic = {}) {
  return [
    magic.popularity ?? 0,
    magic.stars ?? 0,
    magic.freshness ?? 0,
    magic.longevity ?? 0,
    magic.recency ?? 0,
    magic.penalty ?? 0,
  ]
}

function htmlDescription(description) {
  return escapeHtml(String(description)).replace(/\r?\n/g, '<br>')
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char])
}

function compareLabels(a, b) {
  const keyComparison = labelSortCollator.compare(labelSortKey(a), labelSortKey(b))
  if (keyComparison !== 0) return keyComparison

  const lengthComparison = a.length - b.length
  if (lengthComparison !== 0) return lengthComparison

  return labelSortCollator.compare(a, b)
}

function labelSortKey(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function formatCode(value) {
  return `<code>${escapeHtml(value)}</code>`
}

function joinAsSentenceList(parts) {
  if (parts.length <= 2) {
    return parts.join(' and ')
  }

  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
}

function primaryLabelIconSources(labels, minimumUsage, preferredPackages) {
  const counts = new Map()
  const threshold = Math.max(1, Number(minimumUsage) || 1)

  for (const item of labels ?? []) {
    const key = typeof item?.key === 'string' ? item.key : String(item ?? '')
    const canonical = sourceLabelFor(key)
    if (!canonical) continue

    const count = Number(item?.count ?? 1)
    counts.set(canonical, (counts.get(canonical) ?? 0) + (Number.isFinite(count) ? count : 1))
  }

  const sources = new Set()
  for (const source of labelIconSourceSet) {
    if ((counts.get(source) ?? 0) >= threshold) {
      sources.add(source)
    }
  }

  for (const pkg of preferredPackages) {
    for (const label of pkg.labels ?? []) {
      const source = sourceLabelFor(label)
      if (source) sources.add(source)
    }
  }

  return sources
}

function sourceLabelFor(label) {
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

export function label_icon_sprite(label) {
  const canonical = canonicalLabel(label)
  if (!canonical) return ''
  return labelIconSecondarySourceSet?.has(canonical)
    ? 'data/label-icons-extra.svg'
    : 'data/label-icons.svg'
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

export function site_path(value, pathPrefix = process.env.SITE_PATH_PREFIX) {
  const path = String(value ?? '')
  const prefix = normalizeSitePathPrefix(pathPrefix)
  if (!prefix || !path.startsWith('/') || path.startsWith('//')) {
    return path
  }
  if (path === prefix || path.startsWith(prefix + '/')) {
    return path
  }
  return prefix + path
}

// Cache bust source-controlled static files by commit.
export function bust(p) {
  if (!isProd) return p
  return p.replace('static/', 'static_' + util.gitHash + '/')
}

// Place crawler-derived files in the directory for this exact build.
export function data_bust(p) {
  if (!isProd) return p
  return p.replace('data/', 'data_' + util.dataVersion + '/')
}

// Inline tests (Vitest)
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('site_path', () => {
    it('prefixes root paths without touching external URLs', () => {
      expect(site_path('/data/icons.svg#icon', '/website-stage'))
        .toBe('/website-stage/data/icons.svg#icon')
      expect(site_path('https://example.com/', '/website-stage'))
        .toBe('https://example.com/')
    })

    it('does not duplicate an existing prefix', () => {
      expect(site_path('/website-stage/labels', '/website-stage'))
        .toBe('/website-stage/labels')
    })
  })

  describe('label icon sprites', () => {
    it('keeps common and preferred icons in the primary sprite', () => {
      const sprites = configureLabelIcons([
        { key: 'python', count: 3 },
        { key: 'typst', count: 1 },
      ], {
        minimumUsage: 3,
        preferredPackages: [{ labels: ['typst'] }],
      })

      expect(sprites.primarySources).toContain('python')
      expect(sprites.primarySources).toContain('typst')
      expect(sprites.secondarySources).toContain('audio')
      expect(label_icon_sprite('typst')).toBe('data/label-icons.svg')
      expect(label_icon_sprite('audio')).toBe('data/label-icons-extra.svg')
    })
  })

  describe('package_name_breaks', () => {
    it.each([
      ['ConvertChineseCharacters', 'Convert<wbr>Chinese<wbr>Characters'],
      ['XMLParser', 'XML<wbr>Parser'],
      ['SublimeLinter3Plugin', 'Sublime<wbr>Linter3<wbr>Plugin'],
      ['Package Control', 'Package Control'],
    ])('adds meaningful break opportunities to %s', (input, expected) => {
      expect(package_name_breaks(input)).toBe(expected)
    })

    it('escapes HTML before adding break opportunities', () => {
      expect(package_name_breaks('<BadThing>')).toBe('&lt;Bad<wbr>Thing&gt;')
    })
  })

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

  describe('label_normalization_note', () => {
    it('formats a single rewrite with singular text', () => {
      expect(label_normalization_note([
        { from: 'autocomplete', to: 'auto-complete' },
      ])).toBe(
        '<p>* One label has been normalized</p>'
        + '<ul><li><code>autocomplete</code> to <code>auto-complete</code></li></ul>',
      )
    })

    it('groups and sorts rewrites', () => {
      expect(label_normalization_note([
        { from: 'completion', to: 'completions' },
        { from: 'auto complete', to: 'auto-complete' },
        { from: 'autocomplete', to: 'auto-complete' },
      ])).toBe(
        '<p>* Some labels have been normalized</p>'
        + '<ul>'
        + '<li><code>autocomplete</code> and <code>auto complete</code> to <code>auto-complete</code></li>'
        + '<li><code>completion</code> to <code>completions</code></li>'
        + '</ul>',
      )
    })

    it('escapes label HTML', () => {
      expect(label_normalization_note([
        { from: '<bad&label>', to: 'safe' },
      ])).toBe(
        '<p>* One label has been normalized</p>'
        + '<ul><li><code>&lt;bad&amp;label&gt;</code> to <code>safe</code></li></ul>',
      )
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
