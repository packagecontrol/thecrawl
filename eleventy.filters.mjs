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

// merge: shallow-merge two objects, returning a new object
export function merge(obj, ext) {
  return { ...obj, ...ext }
}

// slice: provide arr.slice to the templates
export function slice(arr, start, end = undefined) {
  return arr.slice(start, end)
}

// max: provide Math.max to the templates
export function max(arr, defaultValue = 0) {
  return Math.max(defaultValue, ...(Array.isArray(arr) ? arr : [arr]))
}

export function max_length(arr, defaultValue = 0) {
  return Math.max(defaultValue, ...arr.map(val => val.length))
}

// min: provide Math.min to the templates
export function min(arr, defaultValue = Number.POSITIVE_INFINITY) {
  return Math.min(defaultValue, ...(Array.isArray(arr) ? arr : [arr]))
}

export function at_least(v, defaultValue = 0) {
  return Math.max(defaultValue, v)
}

export function at_most(v, defaultValue = Number.POSITIVE_INFINITY) {
  return Math.min(defaultValue, v)
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

export function sum(arr) {
  if (!Array.isArray(arr)) return 0
  return arr.reduce((a, b) => a + b, 0)
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

// every_other: return every 2nd element starting at index `start` (0 or 1)
export function every_other(arr, start = 0) {
  if (!Array.isArray(arr)) return arr
  let s = Math.abs(start) % 2
  return arr.filter((_, i) => (i % 2) === s)
}

export function dimensions(dim, total_count) {
  let bar_w_gap = dim.bar_w + dim.gap
  let chart_w = (total_count * bar_w_gap) - dim.gap
  return {
    ...dim,
    bar_w_gap,
    chart_w,
    svg_w: dim.left + chart_w + dim.right,
    svg_h: dim.top + dim.chart_h + dim.bottom,
    axis_for: (arr, target) => axis_for(arr, target, dim.chart_h),
    slice_width_at: i => (i < (total_count - 1)) ? bar_w_gap : dim.bar_w,
  }
}

function axis_for(arr, target, height = 1) {
  let step = compute_step(arr, target)
  let steps = Array.from({ length: target + 1 }, (_, i) => i * step)
  let max_scale = target * step
  let px_per_unit = height / max_scale
  let to_px = v => v * px_per_unit
  let y_for = v => height - to_px(v)
  return {
    target,
    step,
    steps,
    max_scale,
    to_px,
    y_for,
  }
}

function compute_step(arr, target) {
  /*
    We want about n evenly spaced ticks, regardless of
    the data magnitude. To achieve this we:

    1) Compute the maximum.
    2) Compute a rough step as ceil(maximum / target).
       This is the smallest step that could cover the range with ~target ticks
       but it may be an awkward number (e.g. 37, 413, 9876).
    3) Normalize the rough step to a “nice” human-friendly step using a
       1–2–2.5–5 sequence scaled by a power of 10. Concretely, we find the
       order of magnitude of rough, then round it up to one of
       {1, 2, 2.5, 5} × 10^k. Examples: 37 → 50, 413 → 500, 9876 → 10000.
  */
  let maximum = Math.max(0, ...arr)
  let approximation = Math.ceil(maximum / target)
  let mag = magnitude(approximation)
  let normalized = approximation / mag
  const niceSteps = [1, 2, 2.5, 5, 10]
  for (let nice of niceSteps) {
    if (normalized <= nice) {
      return nice * mag
    }
  }
  return 10 * mag
}

// magnitude: highest power of 10 <= n
function magnitude(x) {
  if (x <= 0) return 1
  return Math.pow(10, Math.floor(Math.log10(x)))
}

// given an array of ISO week strings (newest first) and an index i,
// return the Monday date of that week.
export function monday_at(dates, i) {
  let anchorMonday = mondayOfIsoWeek(dates[0])
  let monday = new Date(anchorMonday)
  monday.setUTCDate(monday.getUTCDate() - i * 7)
  return monday
}

// given an ISO week string (e.g. "2025-W01") return the Monday date
// of that week.
function mondayOfIsoWeek(isoWeekStr) {
  let [yearStr, weekStr] = isoWeekStr.split('-W')
  let year = parseInt(yearStr, 10)
  let week = parseInt(weekStr, 10)

  // Jan 4th is in ISO week 1 per rule
  let jan4 = new Date(Date.UTC(year, 0, 4))
  let weekday_jan4 = jan4.getUTCDay()
  if (weekday_jan4 === 0) weekday_jan4 = 7 // Sunday (=0) is the last day (=7) in ISO

  return new Date(Date.UTC(year, 0, 4 + (week - 1) * 7 - (weekday_jan4 - 1)))
  //                                  ^ advance to wanted week
  //                                                   ^ back to the monday
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = MS_PER_DAY * 7

// given a Monday date, return the day offset (0..6) of where the
// next month starts if within that week or -1.
export function day_offset_of_month_change(monday) {
  if (monday.getUTCDate() === 1) return 0
  let nextMonthFirst = new Date(Date.UTC(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    1,
  ))
  let diff = (nextMonthFirst - monday) / MS_PER_DAY

  // is the 1st of next month inside this week?
  return diff < 7 ? diff : -1
}

// given a list of ISO week strings (newest first) return the index of a target ISO week.
// if the week is newer than the data (i.e. outside range) returns null.
export function iso_week_index(dates, dateInput) {
  if (!dateInput || !Array.isArray(dates) || dates.length === 0) return null
  const isoWeekStr = util.isoWeekString(dateInput)
  if (!isoWeekStr) return null

  const direct = dates.indexOf(isoWeekStr)
  if (direct !== -1) return direct

  const anchor = mondayOfIsoWeek(dates[0])
  const target = mondayOfIsoWeek(isoWeekStr)
  if (!anchor || !target) return null

  const diff = Math.round((anchor - target) / MS_PER_WEEK)
  return diff >= 0 ? diff : null
}

// given releases and a list of ISO week strings, return week indexes and their versions
export function release_week_model(releases, dates, max_week_idx) {
  if (!Array.isArray(releases) || !Array.isArray(dates) || dates.length === 0) {
    return []
  }

  const weeks = []
  const releasesByWeek = new Map()

  for (const release of releases) {
    if (!release || !release.date) continue
    const idx = iso_week_index(dates, release.date)
    if (idx === null || idx === undefined) continue
    if (idx >= max_week_idx) continue

    if (!releasesByWeek.has(idx)) {
      weeks.push(idx)
      releasesByWeek.set(idx, [])
    }

    releasesByWeek.get(idx).push(release)
  }

  return weeks.map(week_idx => ({
    week_idx,
    versions: releaseVersionsForWeek(releasesByWeek.get(week_idx) ?? []),
  }))
}

function releaseVersionsForWeek(releases) {
  const sortedReleases = [...releases].sort((a, b) => {
    const maxA = util.parseSublimeTextMax(a?.sublime_text)
    const maxB = util.parseSublimeTextMax(b?.sublime_text)
    if (maxA !== maxB) {
      return maxB - maxA
    }

    const dateA = new Date(a?.date ?? '1970-01-01 00:00:00')
    const dateB = new Date(b?.date ?? '1970-01-01 00:00:00')
    return dateB - dateA
  })

  const versions = []
  for (const release of sortedReleases) {
    const version = String(release.version ?? 'unknown')
    if (!versions.includes(version)) {
      versions.push(version)
    }
  }

  return versions
}

// for each week index, find the nearest release week index
export function release_week_nearest_map(release_weeks, max_week_idx) {
  if (!Array.isArray(release_weeks) || !Number.isFinite(max_week_idx) || max_week_idx <= 0) {
    return []
  }

  const week_idxs = release_weeks
    .map(release => release?.week_idx)
    .filter(idx => Number.isInteger(idx))

  if (week_idxs.length === 0) return []

  const map = []
  for (let i = 0; i < max_week_idx; i += 1) {
    let nearest = week_idxs[0]
    let best_dist = Math.abs(i - nearest)
    for (const week_idx of week_idxs) {
      const dist = Math.abs(i - week_idx)
      if (dist < best_dist || (dist === best_dist && week_idx < nearest)) {
        nearest = week_idx
        best_dist = dist
      }
    }
    map.push(nearest)
  }

  return map
}

// given release weeks, compute x/y coordinates and stats flags
export function release_week_coords(release_weeks, upgrades, dim, r_axis, default_y) {
  if (!Array.isArray(release_weeks)) return []
  const upgradesList = Array.isArray(upgrades) ? upgrades : []
  const coords = []

  for (const release of release_weeks) {
    const week_idx = release.week_idx
    const has_stats = week_idx < upgradesList.length
    const x = week_idx * dim.bar_w_gap + (dim.bar_w / 2)
    const y = has_stats
      ? r_axis.y_for(upgradesList[week_idx])
      : default_y
    coords.push({ x, y, has_stats })
  }

  return coords
}

const shortMonthFormatter = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })

// return abbreviated month of given date
export function abbr_month(date) {
  return shortMonthFormatter.format(date)
}

// return full year of given date
export function full_year(date) {
  return date.getUTCFullYear()
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

  describe('every_other', () => {
    it.each([
      [[[0, 1, 2, 3, 4], 0], [0, 2, 4]],
      [[[0, 1, 2, 3, 4], 1], [1, 3]],
      [[[0, 1, 2, 3, 4], 2], [0, 2, 4]], // start cycles every 2
      [[[0, 1, 2, 3, 4], -1], [1, 3]], // negative start handled
    ])('every_other(%j) -> %j', (args, expected) => {
      expect(every_other(...args)).toStrictEqual(expected)
    })

    it('passes through non-arrays', () => {
      expect(every_other('not-array')).toBe('not-array')
      expect(every_other(null)).toBe(null)
      expect(every_other(undefined)).toBe(undefined)
    })
  })

  describe('axis_for', () => {
    it.each([
      [[0], 5, [0, 1, 2, 3, 4, 5]],
      [[25], 5, [0, 5, 10, 15, 20, 25]],
    ])('axis_for(%j, %d).steps -> %s', (arr, target, expected) => {
      expect(axis_for(arr, target).steps).toStrictEqual(expected)
    })

    it.each([
      [[25], 5, 100, 0, 0],
      [[25], 5, 100, 5, 20],
      [[25], 5, 100, 10, 40],
      [[25], 5, 100, 15, 60],
      [[25], 5, 100, 20, 80],
      [[25], 5, 100, 25, 100],
    ])('axis_for(%j, %d, %d).to_px(%d) -> %s', (arr, target, height, val, expected) => {
      expect(axis_for(arr, target, height).to_px(val)).toBe(expected)
    })

    it.each([
      [[25], 5, 100, 0, 100],
      [[25], 5, 100, 5, 80],
      [[25], 5, 100, 10, 60],
      [[25], 5, 100, 15, 40],
      [[25], 5, 100, 20, 20],
      [[25], 5, 100, 25, 0],
    ])('axis_for(%j, %d, %d).y_for(%d) -> %s', (arr, target, height, val, expected) => {
      expect(axis_for(arr, target, height).y_for(val)).toBe(expected)
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

  describe('compute_step', () => {
    it.each([
      [[0, 1, 2, 3], 5, 1],
      [[0], 5, 1],
      [[1], 5, 1],
      [[2], 5, 1],
      [[3], 5, 1],
      [[4], 5, 1],
      [[5], 5, 1],
      [[6], 5, 2],
      // ...
      [[10], 5, 2],
      [[11], 5, 5],
      // ...
      [[25], 5, 5],
      [[26], 5, 10],
      // ...
      [[50], 5, 10],
      [[51], 5, 20],
      // ...
      [[100], 5, 20],
      [[101], 5, 25],
      // ...
      [[125], 5, 25],
      [[126], 5, 50],
      // ...
      [[250], 5, 50],
      [[251], 5, 100],
      // ...
      [[500], 5, 100],
      [[501], 5, 200],
      // ...
      [[1000], 5, 200],
      [[1001], 5, 250],
      // ...
      [[1250], 5, 250],
      [[1251], 5, 500],
      // ...
      [[2500], 5, 500],
      [[2501], 5, 1000],

      [[37], 5, 10],
      [[413], 5, 100],
      [[9876], 5, 2000],

      [[100], 4, 25],
      [[100], 3, 50],
      [[1000], 5, 200],
    ])('compute_step(%j, %d) = %d', (arr, target, expected) => {
      expect(compute_step(arr, target)).toBe(expected)
    })
  })

  describe('magnitude', () => {
    it.each([
      [0, 1],
      [1, 1],
      [9, 1],
      [10, 10],
      [11, 10],
      [99, 10],
      [100, 100],
      [123456, 100000],
    ])('magnitude(%d) = %d', (n, expected) => {
      expect(magnitude(n)).toBe(expected)
    })
  })

  describe('mondayOfIsoWeek', () => {
    it.each([
      ['2025-W01', '2024-12-30'],
      ['2025-W36', '2025-09-01'],
      // W01 start-day variants
      ['2018-W01', '2018-01-01'], // Jan 1 is Mon -> W01 Monday = Jan 1
      ['2019-W01', '2018-12-31'], // Jan 1 is Tue -> W01 Monday = Dec 31 prev year
      ['2020-W01', '2019-12-30'], // Jan 1 is Wed -> W01 Monday = Dec 30 prev year
      ['2015-W01', '2014-12-29'], // Jan 1 is Thu -> W01 Monday = Dec 29 prev year
      ['2016-W01', '2016-01-04'], // Jan 1 is Fri -> W01 Monday = Jan 4
      ['2022-W01', '2022-01-03'], // Jan 1 is Sat -> W01 Monday = Jan 3
      ['2017-W01', '2017-01-02'], // Jan 1 is Sun -> W01 Monday = Jan 2
    ])('mondayOfIsoWeek(%s) -> %s', (iso, expectedIso) => {
      expect(mondayOfIsoWeek(iso).toISOString().slice(0, 10)).toBe(expectedIso)
    })
  })

  describe('day_offset_of_month_change', () => {
    it.each([
      // Monday is the 1st of the month -> offset 0
      ['2025-09-01', 0],
      // Next month starts within this week
      ['2025-06-30', 1],
      ['2024-12-30', 2],
      ['2024-07-29', 3],
      ['2024-10-28', 4],
      ['2025-02-24', 5],
      ['2024-08-26', 6],
      // Next month not within the same week
      ['2025-09-08', -1],
    ])('offset for %s -> %d', (ymd, expected) => {
      const monday = new Date(ymd + 'T00:00:00Z')
      expect(monday.getUTCDay()).toBe(1)
      expect(day_offset_of_month_change(monday)).toBe(expected)
    })
  })

  describe('release_week_model', () => {
    it('sorts and deduplicates versions in each release week', () => {
      const releases = [
        { date: '2026-04-22T18:02:46Z', sublime_text: '>=4204', version: '6.1.0' },
        { date: '2026-04-22T18:02:27Z', sublime_text: '4107 - 4203', version: '5.1.0' },
        { date: '2026-04-22T15:17:35Z', sublime_text: '>=4204', version: '6.0.0' },
        { date: '2026-04-20T00:27:09Z', sublime_text: '4107 - 4203', version: '5.0.3' },
        { date: '2026-04-20T00:27:09Z', sublime_text: '>=4204', version: '5.0.3' },
      ]

      expect(release_week_model(releases, ['2026-W17'], 1)).toStrictEqual([
        {
          week_idx: 0,
          versions: ['6.1.0', '6.0.0', '5.0.3', '5.1.0'],
        },
      ])
    })
  })

  describe('dimensions.slice_width_at', () => {
    it('uses bar_w_gap except for last slice', () => {
      const base = { bar_w: 12, gap: 1, top: 0, bottom: 0, left: 0, right: 0, chart_h: 100 }
      const total_count = 3
      const d = dimensions(base, total_count)
      expect(d.bar_w_gap).toBe(13)
      expect(d.slice_width_at(0)).toBe(13)
      expect(d.slice_width_at(1)).toBe(13)
      expect(d.slice_width_at(2)).toBe(12)
    })

    it('handles single-slice charts', () => {
      const base = { bar_w: 10, gap: 5, top: 0, bottom: 0, left: 0, right: 0, chart_h: 50 }
      const d = dimensions(base, 1)
      expect(d.bar_w_gap).toBe(15)
      expect(d.slice_width_at(0)).toBe(10)
    })
  })
}
