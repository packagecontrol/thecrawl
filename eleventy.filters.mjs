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

// Helpers used by multiple filters
// magnitude: highest power of 10 <= n
function magnitude(x) {
  if (x <= 0) return 1
  return Math.pow(10, Math.floor(Math.log10(x)))
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
  let max_scale = target * step
  let px_per_unit = height / max_scale
  let to_px = v => v * px_per_unit
  let y_for = v => height - to_px(v)
  return {
    target,
    step,
    max_scale,
    to_px,
    y_for,
  }
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

// return abbreviated month of given (for December include year)
export function abbr_month(date) {
  let monthShort = shortMonthFormatter.format(date)
  let year = date.getUTCFullYear()
  let isDec = date.getUTCMonth() === 11
  return isDec ? `${monthShort} ${year}` : monthShort
}

// cache bust static files
export function bust(p) {
  if (!isProd) return p
  return p.replace('static/', 'static_' + util.gitHash + '/')
}
