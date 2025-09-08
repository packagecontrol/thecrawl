import * as util from './eleventy.util.mjs'

// Compute prod mode locally so filters remain self-contained
const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'

// Filters as normal functions
// simple to date string for some dates without times
export function date_format(date) {
  if (typeof date !== 'string') return date
  const value = new Date(date)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(value)
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
  const fmt = new Intl.NumberFormat('en', { notation: 'compact' })
  return fmt.format(count)
}

// number formatting with grouping (e.g. 10,000)
export function grouping(count) {
  const fmt = new Intl.NumberFormat('en', { useGrouping: true })
  return fmt.format(count)
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

export function sum(arr) {
  if (!Array.isArray(arr)) return 0
  return arr.reduce((a, b) => a + b, 0)
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
       1–2–5 sequence scaled by a power of 10. Concretely, we find the order of
       magnitude of rough, then round it up to one of {1, 2, 5} × 10^k.
       Examples: 37 → 50, 413 → 500, 9876 → 10000.
  */
  let maximum = Math.max(0, ...arr)
  let approximation = Math.ceil(maximum / target)
  let mag = magnitude(approximation)
  let lead_number = Math.floor((approximation + mag - 1) / mag)
  if (lead_number <= 1) {
    return 1 * mag
  } else if (lead_number <= 2) {
    return 2 * mag
  } else if (lead_number <= 5) {
    return 5 * mag
  } else {
    return 10 * mag
  }
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
      [[[0, 1, 2, 3, 4], -1], [1, 3]],   // negative start handled
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

      [[10], 5, 2],
      [[11], 5, 5],

      [[25], 5, 5],
      [[26], 5, 10],

      [[50], 5, 10],
      [[51], 5, 20],

      [[110], 5, 50],
      [[250], 5, 50],
      [[260], 5, 100],
      [[500], 5, 100],
      [[510], 5, 200],

      [[37], 5, 10],
      [[413], 5, 100],
      [[9876], 5, 2000],
      [[25], 5, 5],
      [[26], 5, 10],

      [[100], 4, 50],
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
}
