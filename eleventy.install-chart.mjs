const compactNumberFormatter = new Intl.NumberFormat('en', { notation: 'compact' })
const groupedNumberFormatter = new Intl.NumberFormat('en', { useGrouping: true })
const shortMonthFormatter = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = MS_PER_DAY * 7
const VISIBLE_WEEK_COUNT = 53
const DAILY_UPGRADE_DAY_COUNT = 28
const DAILY_UPGRADE_ROLLING_DAYS = 7

const BASE_DIMENSIONS = {
  bar_w: 12,
  gap: 1,
  release_pt_r: 2,
  release_pt_hit_r: 14,
  top: 14,
  bottom: 42,
  left: 50,
  right: 60,
  chart_h: 160,
}

export function renderInstallChart(pkg) {
  if (!shouldRenderInstallChart(pkg)) {
    return ''
  }

  const model = chartModel(pkg)
  return html`
    <div class="${classes('chart-container', pkg.removed && 'chart-container-rip')}">
      ${renderChart(model)}
      ${renderLegend(model)}
    </div>
  `
}

function shouldRenderInstallChart(pkg) {
  // Hide completely empty charts: no visible install/upgrade stats and no
  // release in the running year window. Removals alone are not drawn when
  // installs are zero, so they should not trigger the chart.
  const weeklyInstalls = (pkg.weekly_installs ?? []).slice(0, VISIBLE_WEEK_COUNT)
  const weeklyUpgrades = (pkg.weekly_upgrades ?? []).slice(0, VISIBLE_WEEK_COUNT)
  const statsSum = sum(weeklyInstalls) + sum(weeklyUpgrades)
  const hasInstallStats = statsSum > 0
  if (hasInstallStats) {
    return true
  }

  if ((pkg.allReleases?.length ?? 0) > 0 && pkg.weekly_dates && pkg.weekly_dates.length > 0) {
    const latestRelease = pkg.allReleases[0]
    if (latestRelease.date) {
      const releaseIndex = isoWeekIndex(pkg.weekly_dates, latestRelease.date)
      if (releaseIndex !== null && releaseIndex < weeklyInstalls.length) {
        return true
      }
    }
  }

  return false
}

function chartModel(pkg) {
  const installs = (pkg.weekly_installs ?? []).slice(0, VISIBLE_WEEK_COUNT)
  const removals = (pkg.weekly_removals ?? []).slice(0, VISIBLE_WEEK_COUNT)
  // Keep one off-chart upgrade so the line continues into the right axis,
  // where the plot clip cuts it off.
  const upgrades = (pkg.weekly_upgrades ?? []).slice(0, VISIBLE_WEEK_COUNT + 1)
  const dates = (pkg.weekly_dates ?? []).slice(0, VISIBLE_WEEK_COUNT)
  const releases = pkg.allReleases ?? []

  const count = installs.length
  // Pad chart width to a fixed 53 weeks to avoid width changes.
  const paddedCount = VISIBLE_WEEK_COUNT
  const dim = dimensions(BASE_DIMENSIONS, paddedCount)
  const upgradeSeries = upgradePointModel(
    upgrades,
    dates,
    pkg.daily_upgrades ?? [],
    pkg.daily_dates ?? [],
    dim,
    pkg.first_seen,
  )
  const lAxis = dim.axis_for(installs, 5)
  const rAxis = dim.axis_for(upgradeSeries.points.map(point => point.value), 5)
  const averages = averageModel(installs, removals, count, dim, lAxis)
  const releasePoints = releasePointModel(
    releases,
    dates,
    upgrades,
    upgradeSeries.dailyPoints,
    paddedCount,
    dim,
  )
  const firstSeenIndex = isoWeekIndex(dates, pkg.first_seen)

  return {
    installTotal: sum(installs),
    installTotalIsLifetime: firstSeenIndex !== null && firstSeenIndex < count,
    installs,
    removals,
    upgrades,
    dates,
    releases,
    count,
    paddedCount,
    dim,
    lAxis,
    rAxis,
    releasePoints,
    upgradeSeries,
    ...averages,
  }
}

export function upgradePointModel(weeklyUpgrades, weeklyDates, dailyUpgrades, dailyDates, dim, firstSeen) {
  const dailyPoints = []
  const firstSeenDate = firstSeen?.slice(0, 10)
  const completeWindowCount = atLeast(dailyUpgrades.length - DAILY_UPGRADE_ROLLING_DAYS + 1, 0)
  const dailyCount = Math.min(DAILY_UPGRADE_DAY_COUNT, completeWindowCount, dailyDates.length)

  for (let i = 0; i < dailyCount; i += 1) {
    if (firstSeenDate && dailyDates[i] < firstSeenDate) continue
    const x = chartXForDay(dailyDates[i], weeklyDates, dim)
    if (x === null || x < 0) continue
    const rollingValues = dailyUpgrades.slice(i, i + DAILY_UPGRADE_ROLLING_DAYS)
    dailyPoints.push({
      dailyValue: dailyUpgrades[i],
      date: dailyDates[i],
      // A trailing seven-day total has the same units and typical scale as the
      // weekly series.
      value: sum(rollingValues),
      x,
    })
  }
  dailyPoints.sort((a, b) => a.x - b.x)

  const oldestDailyX = dailyPoints.length > 0
    ? dailyPoints[dailyPoints.length - 1].x
    : Number.NEGATIVE_INFINITY
  // Resume weekly samples after the oldest daily point without overlapping
  // the rolling daily window.
  const weeklyPoints = weeklyUpgrades
    .map((value, week_idx) => ({
      value,
      week_idx,
      x: weekX(week_idx, dim),
    }))
    .filter(point => point.x > oldestDailyX)

  return {
    dailyPoints,
    points: [...dailyPoints, ...weeklyPoints].sort((a, b) => a.x - b.x),
    usesDaily: dailyPoints.length > 0,
  }
}

export function releasePointModel(releases, weeklyDates, weeklyUpgrades, dailyPoints, maxWeekIdx, dim) {
  const dailyPointsByDate = new Map(dailyPoints.map(point => [point.date, point]))
  const dailyReleases = new Map()
  const weeklyReleases = []

  for (const release of releases) {
    const date = release?.date?.slice(0, 10)
    const dailyPoint = dailyPointsByDate.get(date)
    if (!dailyPoint) {
      weeklyReleases.push(release)
      continue
    }

    if (!dailyReleases.has(date)) {
      dailyReleases.set(date, { dailyPoint, releases: [] })
    }
    dailyReleases.get(date).releases.push(release)
  }

  const points = [...dailyReleases.entries()].map(([date, group]) => {
    const weekIdx = isoWeekIndex(weeklyDates, date)
    return {
      dailyValue: group.dailyPoint.dailyValue,
      date,
      has_stats: true,
      value: group.dailyPoint.value,
      weeklyValue: weeklyUpgrades[weekIdx] ?? 0,
      versions: releaseVersions(group.releases),
      week_idx: weekIdx,
      x: group.dailyPoint.x,
    }
  })

  for (const releaseWeek of releaseWeekModel(weeklyReleases, weeklyDates, maxWeekIdx)) {
    const hasStats = releaseWeek.week_idx < weeklyUpgrades.length
    const weeklyValue = hasStats ? weeklyUpgrades[releaseWeek.week_idx] : 0
    points.push({
      ...releaseWeek,
      date: weeklyDates[releaseWeek.week_idx] ?? '',
      has_stats: hasStats,
      value: weeklyValue,
      weeklyValue,
      x: weekX(releaseWeek.week_idx, dim),
    })
  }

  return points
    .sort((a, b) => a.x - b.x)
    .map((point, id) => ({ ...point, id }))
}

function chartXForDay(dateInput, weeklyDates, dim) {
  const anchorMonday = mondayOfIsoWeek(weeklyDates[0])
  if (!anchorMonday) return null

  // A daily aggregate sits at the midpoint of its UTC day.
  const day = new Date(`${dateInput}T12:00:00Z`)
  if (Number.isNaN(day.getTime())) return null

  const nextMonday = new Date(anchorMonday)
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7)
  return ((nextMonday - day) / MS_PER_WEEK) * dim.bar_w_gap
}

function weekX(weekIdx, dim) {
  return weekIdx * dim.bar_w_gap + (dim.bar_w / 2)
}

function renderChart(model) {
  const { dim } = model
  return html`
    <div class="install-chart">
      <svg viewBox="0 0 ${dim.svg_w} ${dim.svg_h}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Weekly installs">
        <g transform="translate(${dim.left}, ${dim.top})">
          ${renderMonthTicks(model)}
          ${renderWeekBars(model)}
          ${renderPaddedWeeks(model)}
          ${renderAverageLines(model)}
          ${renderUpgradesOverlay(model)}
          ${drawAxisWithLabels(model.lAxis, 0, dim, 'tick')}
          ${multilineText(['Weekly', 'Installs'], -6, dim.chart_h + 24, undefined, 'end')}

          <g class="upgrades-axis">
            ${drawAxisWithLabels(model.rAxis, dim.chart_w, dim, 'tick tick-right', 'start')}
            ${multilineText(['Weekly', 'Upgrades'], dim.chart_w + 6, dim.chart_h + 24)}
          </g>

          ${line(0, dim.chart_h, dim.chart_w, dim.chart_h, 'axis')}
          ${renderReleases(model)}
        </g>
      </svg>
    </div>
  `
}

function renderLegend(model) {
  return html`
    <div class="legend">
      <div class="color color-gross"></div>
      Installations:
      ${model.avg_inst ? `recent average ${grouping(Math.round(model.avg_inst))} per week,` : ''}
      ${grouping(model.installTotal)} ${installTotalPeriod(model)}
      <br>
      <div class="color color-net"></div>
      Installations minus removals
      <br>
      <div class="color color-upgrade"></div>
      Upgrades
    </div>
  `
}

function installTotalPeriod(model) {
  if (model.installTotalIsLifetime) {
    return 'in total'
  }

  return `in the ${model.count} ${model.count === 1 ? 'week' : 'weeks'} shown`
}

function renderMonthTicks(model) {
  const { count, dates, dim, paddedCount } = model
  const ticks = []

  for (let i = 0; i < paddedCount; i += 1) {
    const dayOffset = dayOffsetOfMonthChange(mondayAt(dates, i))
    if (dayOffset < 0) continue

    const x = i * dim.bar_w_gap
    const sliceW = dim.slice_width_at(i)
    // Weeks are newest→oldest left→right; that means Monday is at the right
    // ("1 -") edge of slice.
    const xt = x + (sliceW * (1 - (dayOffset / 7)))
    // i + 1 to show the name of the next month.
    const label = abbrMonth(mondayAt(dates, i + 1))
    const cssClass = (i < count - 1) ? 'x-month-label' : 'x-month-label x-month-label-dimmed'
    let tickLen = 12

    if (label === 'Dec') {
      const year = fullYear(mondayAt(dates, i + 1))
      let decLabelX = xt + 2
      const decLabelY = dim.chart_h + 12
      let decAnchor = 'start'
      // For December, we draw a multiline with the year and that can collide
      // with the "Weekly Upgrades" label of the y-axis. Hence we move the Dec
      // label out of its way near the end of a year. These are manually
      // crafted adjustments.
      if (i === paddedCount - 2) {
        decLabelX = xt - 12
        decAnchor = 'start'
        tickLen = 6
      } else if (i === paddedCount - 1) {
        decLabelX = xt + 4
        decAnchor = 'end'
        tickLen = 6
      }
      ticks.push(multilineText([label, year], decLabelX, decLabelY, cssClass, decAnchor))
    } else {
      ticks.push(text(label, xt + 2, dim.chart_h + 12, cssClass))
    }

    ticks.push(line(xt, dim.chart_h, xt, dim.chart_h + tickLen, 'x-month-tick'))
  }

  return ticks
}

function renderWeekBars(model) {
  const { dates, dim, installs, lAxis, removals, upgrades } = model

  return installs.map((inst, i) => {
    const rem = removals[i] ?? 0
    const up = upgrades[i] ?? 0
    const netVal = atLeast(inst - rem, 0)
    const remDraw = atMost(rem, inst)
    const netH = lAxis.to_px(netVal)
    const remH = lAxis.to_px(remDraw)

    const x = i * dim.bar_w_gap
    const yTopInst = lAxis.y_for(inst)
    const yNet = lAxis.y_for(netVal)
    const yRem = yNet - remH
    const sliceW = dim.slice_width_at(i)

    const titleText = [
      dates[i],
      `installs: ${grouping(inst)}`,
      `removals: ${grouping(rem)}`,
      `upgrades: ${grouping(up)}`,
    ].join(' | ')

    return html`
      <g class="week" data-week="${i}">
        ${rect(x, 0, sliceW, dim.chart_h, 'week-slice-bg')}
        ${drawGridLines(i, x, sliceW, dim, lAxis)}
        ${rect(x, yNet, dim.bar_w, netH, 'bar bar-net', titleText)}
        ${rect(x, yRem, dim.bar_w, remH, 'bar bar-remove', titleText)}
        ${inst === 0 && rem > 0 ? rect(x, dim.chart_h, dim.bar_w, 3, 'bar bar-remove bar-remove-excess', titleText) : ''}
        ${rect(x, 0, dim.bar_w, yTopInst, 'week-slice-hit', titleText)}
      </g>
    `
  })
}

function renderPaddedWeeks(model) {
  const { count, dim, lAxis, paddedCount } = model
  const weeks = []

  for (let i = count; i < paddedCount; i += 1) {
    const x = i * dim.bar_w_gap
    const sliceW = dim.slice_width_at(i)
    weeks.push(html`
      <g class="week" data-week="${i}">
        ${drawGridLines(i, x, sliceW, dim, lAxis)}
      </g>
    `)
  }

  return weeks
}

function renderAverageLines(model) {
  if (!Number.isFinite(model.y_avg_inst) || !Number.isFinite(model.y_avg_net)) {
    return ''
  }

  const { dim } = model
  return html`
    ${line(0, model.y_avg_inst, dim.chart_w, model.y_avg_inst, 'avg-line avg-line-inst')}
    ${line(0, model.y_avg_net, dim.chart_w, model.y_avg_net, 'avg-line avg-line-net')}
  `
}

function renderUpgradesOverlay(model) {
  const { count, dim, rAxis, upgradeSeries } = model
  const { points, usesDaily } = upgradeSeries
  // Only show the upgrades line when there is at least one upgrade.
  if (sum(points.map(point => point.value)) <= 0) {
    return ''
  }

  // Smoothed cubic Bézier via Catmull–Rom approximation
  //
  // Basics:
  // - A straight polyline would use SVG 'L' commands between points:
  //   M x0 y0 L x1 y1 L x2 y2 … That produces sharp corners. To smooth
  //   the line we switch to cubic Bézier segments ('C'). We start with a
  //   first point (M), and then continue with two control points and a
  //   segment end-point (C).
  //   Refer: https://svg-tutorial.com/editor/cubic-bezier
  //
  // - For each curved segment from P1 to P2 we take four points P0, P1,
  //   P2, P3 (clamping at the ends) and compute the two control points as:
  //     C1 = P1 + (P2 − P0) / 6
  //     C2 = P2 − (P3 − P1) / 6
  //   This is a common Catmull–Rom to Bézier conversion that yields a
  //   smooth line passing through all data points.

  const upgradeCount = points.length
  const startIndex = usesDaily ? 0 : 1
  let d = ''
  if (upgradeCount > startIndex) {
    const firstPoint = points[startIndex]
    d = `M ${firstPoint.x} ${rAxis.y_for(firstPoint.value)}`

    for (let i = startIndex; i < upgradeCount - 1; i += 1) {
      const i0 = atLeast(i - 1, startIndex)
      const i1 = i
      const i2 = i + 1
      const i3 = atMost(i + 2, upgradeCount - 1)

      const p0 = points[i0]
      const p1 = points[i1]
      const p2 = points[i2]
      const p3 = points[i3]

      const x0 = p0.x
      const x1 = p1.x
      const x2 = p2.x
      const x3 = p3.x

      const y0 = rAxis.y_for(p0.value)
      const y1 = rAxis.y_for(p1.value)
      const y2 = rAxis.y_for(p2.value)
      const y3 = rAxis.y_for(p3.value)

      // Catmull–Rom → Bézier control points
      //
      // Intuition: Catmull–Rom defines the tangent at P1 as (P2−P0)/2 and at
      // P2 as (P3−P1)/2 (with unit spacing). A cubic Bézier's tangents are
      // 3·(C1−P1) at the start and 3·(P2−C2) at the end. T.i.:
      //   3·(C1−P1) = (P2−P0)/2
      //      C1−P1  = (P2−P0)/6
      //          C1 = P1 + (P2−P0)/6
      // Likewise:
      //   3·(P2−C2) = (P3−P1)/2
      //          C2 = P2 − (P3−P1)/6

      const c1x = x1 + (x2 - x0) / 6
      const c2x = x2 - (x3 - x1) / 6
      const segmentMinY = Math.min(y1, y2)
      const segmentMaxY = Math.max(y1, y2)
      // Limit controls to the range between the adjacent samples. This
      // deliberately dampens curves near extrema rather than clipping them at
      // zero, and equal adjacent values produce a flat segment.
      const c1y = clamp(y1 + (y2 - y0) / 6, segmentMinY, segmentMaxY)
      const c2y = clamp(y2 - (y3 - y1) / 6, segmentMinY, segmentMaxY)

      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`
    }
  }

  // Reach the outer SVG edges on three sides so only the continuation past
  // the right axis is clipped.
  return html`
    <clipPath id="clip-upgrades">
      ${rect(-dim.left, -dim.top, dim.left + dim.chart_w, dim.svg_h)}
    </clipPath>
    <g clip-path="url(#clip-upgrades)">
      <path d="${d}" class="upgrades-line" />
      ${!usesDaily && count > 1 ? renderRunningWeekUpgradeLine(model) : ''}
    </g>
  `
}

function renderRunningWeekUpgradeLine(model) {
  const { dim, rAxis, upgrades } = model
  const xWeek0 = dim.bar_w / 2
  const yWeek0 = rAxis.y_for(upgrades[0])
  const xWeek1 = 1 * dim.bar_w_gap + (dim.bar_w / 2)
  const yWeek1 = rAxis.y_for(upgrades[1])
  return line(xWeek0, yWeek0, xWeek1, yWeek1, 'upgrades-line upgrades-line-dashed')
}

function renderReleases(model) {
  const { releasePoints } = model
  if (releasePoints.length === 0) {
    return ''
  }

  const defaultY = model.y_avg_net ?? model.lAxis.y_for(0)
  const releaseCoords = releasePointCoords(releasePoints, model.rAxis, defaultY)

  return html`
    ${renderReleaseInteractionStyle(model)}
    ${releasePoints.map((release, i) => renderReleasePoint(model, release, releaseCoords[i], i === 0))}
  `
}

function renderReleaseInteractionStyle(model) {
  const { dim, paddedCount, releasePoints } = model
  const releaseNearest = releasePointNearestMap(releasePoints, paddedCount, dim)
  const defaultReleaseId = releasePoints[0].id

  return html`
    <style>
      .install-chart {
        .release-week .release-callout-group {
          opacity: 0;
          pointer-events: none;
          transition: opacity .3s ease-out;
        }
        .release-week .release-label-expanded {
          display: none;
        }
        .release-week:has(.release-point-hit:hover) .release-label-collapsed {
          display: none;
        }
        .release-week:has(.release-point-hit:hover) .release-label-expanded {
          display: inline;
        }
        .release-week.is-default .release-callout-group {
          opacity: 1;
          transition-duration: .1s;
        }
        .release-week:has(.release-point-hit:hover) {
          .release-callout-group {
            opacity: 1;
            transition-duration: .1s;
          }
          .release-point {
            stroke-width: 1px;
            stroke: var(--release-point-stroke-color);
          }
          .release-point-in-the-void {
            opacity: 1;
          }
        }
        &:has(.release-point-hit:hover) .release-week.is-default .release-point {
          stroke-width: 0.3px;
          stroke: var(--release-point-stroke-alt-color);
        }
        .release-week.is-default:has(.release-point-hit:hover) .release-point {
          stroke-width: 1px;
          stroke: var(--release-point-stroke-color);
        }
        &:has(.release-point-hit:hover) .release-week.is-default .release-callout-group {
          opacity: 0;
        }
        .release-week.is-default:has(.release-point-hit:hover) .release-callout-group {
          opacity: 1;
          transition-duration: .1s;
        }
        &:has(.upgrades-axis:hover),
        &:has(.release-point-hit:hover) {
          .upgrades-line {
            stroke-width: 2.8px;
          }
        }
      }
      ${range(0, paddedCount).map((weekIdx) => {
        const nearestReleaseId = releaseNearest[weekIdx]
        if (nearestReleaseId === undefined || nearestReleaseId === null) return ''
        return html`
          .install-chart:has(.week[data-week="${weekIdx}"]:hover) {
            .release-week[data-release="${nearestReleaseId}"] {
              .release-callout-group {
                opacity: 1;
                transition-duration: .1s;
              }
              .release-point {
                stroke-width: 1px;
                stroke: var(--release-point-stroke-color);
              }
              .release-point-in-the-void {
                opacity: 1;
              }
            }
            ${nearestReleaseId !== defaultReleaseId
              ? html`
                .release-week.is-default {
                  .release-callout-group { opacity: 0; }
                  .release-point {
                    stroke-width: 0.3px;
                    stroke: var(--release-point-stroke-alt-color);
                  }
                }
              `
              : ''}
          }
        `
      })}
      ${releasePoints.map(release => html`
        .install-chart:has(.release-week[data-release="${release.id}"] .release-point-hit:hover) {
          .week[data-week="${release.week_idx}"] .bar {
            fill: var(--install-bar-hover-color);
          }
        }
      `)}
    </style>
  `
}

function renderReleasePoint(model, release, rCoord, isLatestRelease) {
  const releaseHasStats = release.has_stats
  let releaseTitle = release.date
  if (releaseHasStats) {
    releaseTitle += ` | upgrades: ${grouping(release.weeklyValue)}`
    if (release.dailyValue !== undefined) {
      releaseTitle += ` | ${grouping(release.dailyValue)} on that day`
    }
  }

  const releaseWeekClass = classes('release-week', isLatestRelease && 'is-default')
  const releasePointClasses = classes('release-point', !releaseHasStats && 'release-point-in-the-void')

  return html`
    <g class="${releaseWeekClass}" data-release="${release.id}" data-week="${release.week_idx}">
      <circle
        cx="${rCoord.x}"
        cy="${rCoord.y}"
        r="${model.dim.release_pt_hit_r}"
        class="release-point-hit">
        <title>${escapeText(releaseTitle)}</title>
      </circle>

      <circle cx="${rCoord.x}" cy="${rCoord.y}" r="${model.dim.release_pt_r}" class="${releasePointClasses}" />

      <g class="release-callout-group">
        ${renderReleaseCallout(model, release, rCoord)}
      </g>
    </g>
  `
}

function renderReleaseCallout(model, release, rCoord) {
  const { dim, installs, lAxis, paddedCount, rAxis, upgradeSeries } = model
  const gapToLineStart = 4
  const gapToText = 4
  const minimumLineLength = 12
  const maxLineLength = 52
  // The default line length when we have a version and no stats around it.
  const voidLineLength = 24

  // Callout line heading North.
  let lineStartY = atLeast(rCoord.y - dim.release_pt_r - gapToLineStart, 0)
  // Watch out +- 4 weeks and compute `line_end_y` to stay visually above
  // everything else.
  const lookStart = atLeast(release.week_idx - 4, 0)
  const lookEnd = atMost(release.week_idx + 4, paddedCount - 1)
  const lookStartX = lookStart * dim.bar_w_gap
  const lookEndX = (lookEnd + 1) * dim.bar_w_gap
  const nearbyUpgradeValues = upgradeSeries.points
    .filter(point => point.x >= lookStartX && point.x <= lookEndX)
    .map(point => point.value)
  const maxUpgradeVal = max(nearbyUpgradeValues)
  const maxInstallVal = max(installs.slice(lookStart, lookEnd + 1))

  let lineEndY
  if (maxUpgradeVal === 0 && maxInstallVal === 0) {
    lineEndY = atLeast(lineStartY - voidLineLength, 0)
  } else {
    const upgradeTop = rAxis.y_for(maxUpgradeVal) - dim.release_pt_r - gapToLineStart
    const installTop = lAxis.y_for(maxInstallVal) - gapToLineStart
    lineEndY = atLeast(min([lineStartY - minimumLineLength, upgradeTop, installTop]), 0)
  }

  const lineLength = lineStartY - lineEndY
  const clipped = lineLength > maxLineLength
  if (clipped) {
    lineStartY = atMost(lineEndY + maxLineLength, lineStartY)
  }

  // If line_start_y == 0 we draw a point at the top edge with no callout line
  // but just the text. Increase the gap_to_text slightly by 2 in that case.
  const labelY = lineEndY - gapToText - (lineStartY === 0 ? 2 : 0)

  return html`
    ${line(rCoord.x, lineStartY, rCoord.x, lineEndY, 'release-callout')}
    ${clipped ? drawArrow(rCoord.x, lineStartY, 3, 2) : ''}
    ${drawCalloutLabel(release.versions, rCoord.x, labelY, dim.chart_w)}
  `
}

function averageModel(installs, removals, count, dim, lAxis) {
  // Average lines exclude running week at index 0:
  // - installs: mean(installs[i]) for i >= 1
  // - net installs: mean(max(installs[i] - removals[i], 0)) for i >= 1
  const countExcl0 = count - 1
  if (countExcl0 <= 0) {
    return {}
  }

  const sumInst = sum(installs.slice(1))
  const sumRem = sum(removals.slice(1))
  const sumNet = atLeast(sumInst - sumRem, 0)
  const avgInst = sumInst / countExcl0
  const avgNet = sumNet / countExcl0

  return {
    avg_inst: avgInst,
    avg_net: avgNet,
    y_avg_inst: lAxis.y_for(avgInst),
    y_avg_net: lAxis.y_for(avgNet),
  }
}

export function dimensions(dim, total_count) {
  const bar_w_gap = dim.bar_w + dim.gap
  const chart_w = (total_count * bar_w_gap) - dim.gap
  return {
    ...dim,
    bar_w_gap,
    chart_w,
    svg_w: dim.left + chart_w + dim.right,
    svg_h: dim.top + dim.chart_h + dim.bottom,
    axis_for: (arr, target) => axisFor(arr, target, dim.chart_h),
    slice_width_at: i => (i < (total_count - 1)) ? bar_w_gap : dim.bar_w,
  }
}

export function isoWeekIndex(dates, dateInput) {
  if (!dateInput || !Array.isArray(dates) || dates.length === 0) return null
  const isoWeekStr = isoWeekString(dateInput)
  if (!isoWeekStr) return null

  const direct = dates.indexOf(isoWeekStr)
  if (direct !== -1) return direct

  const anchor = mondayOfIsoWeek(dates[0])
  const target = mondayOfIsoWeek(isoWeekStr)
  if (!anchor || !target) return null

  const diff = Math.round((anchor - target) / MS_PER_WEEK)
  return diff >= 0 ? diff : null
}

export function releaseWeekModel(releases, dates, max_week_idx) {
  if (!Array.isArray(releases) || !Array.isArray(dates) || dates.length === 0) {
    return []
  }

  const weeks = []
  const releasesByWeek = new Map()

  for (const release of releases) {
    if (!release || !release.date) continue
    const idx = isoWeekIndex(dates, release.date)
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
    versions: releaseVersions(releasesByWeek.get(week_idx) ?? []),
  }))
}

function releasePointNearestMap(releasePoints, maxWeekIdx, dim) {
  if (releasePoints.length === 0) return []

  const map = []
  for (let i = 0; i < maxWeekIdx; i += 1) {
    const x = weekX(i, dim)
    let nearest = releasePoints[0]
    let bestDistance = Math.abs(x - nearest.x)
    for (const release of releasePoints) {
      const distance = Math.abs(x - release.x)
      if (distance < bestDistance || (distance === bestDistance && release.x < nearest.x)) {
        nearest = release
        bestDistance = distance
      }
    }
    map.push(nearest.id)
  }

  return map
}

function releasePointCoords(releasePoints, rAxis, defaultY) {
  return releasePoints.map(release => ({
    x: release.x,
    y: release.has_stats ? rAxis.y_for(release.value) : defaultY,
  }))
}

function drawAxisWithLabels(axis, xPos, dim, cssClass = 'tick', textAnchor = 'end', offset = 6) {
  const sign = (textAnchor === 'end') ? -1 : 1
  return html`
    ${line(xPos, 0, xPos, dim.chart_h, 'axis')}
    ${everyOther(axis.steps).map((step) => {
      const y = axis.y_for(step)
      return text(compact(step), xPos + (sign * offset), y, cssClass, textAnchor)
    })}
  `
}

function drawGridLines(i, x, sliceW, dim, axis) {
  return html`
    <clipPath id="clip-week-${i}">
      ${rect(x, 0, sliceW, dim.chart_h)}
    </clipPath>
    <g clip-path="url(#clip-week-${i})">
      ${axis.steps.map((step) => {
        const gy = axis.y_for(step)
        return line(0, gy, dim.chart_w, gy, 'grid')
      })}
    </g>
  `
}

function rect(x, y, w, h, cssClass = '', titleText = '') {
  return html`
    <rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cssClass}">
      ${titleText ? `<title>${escapeText(titleText)}</title>` : ''}
    </rect>
  `
}

function line(x1, y1, x2, y2, cssClass = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cssClass}" />`
}

function drawArrow(x, y, height, sideWidth, cssClass = 'release-callout') {
  const baseY = y - height
  return `<polygon points="${x},${y} ${x - sideWidth},${baseY} ${x + sideWidth},${baseY}" class="${cssClass}" />`
}

function drawCalloutLabel(versions, baseX, labelY, chartW, margin = 4, charWidth = 6, cssClass = 'release-label') {
  const count = versions.length
  let compactLabel = versions[0] || ''
  if (count === 2) {
    compactLabel = `${versions[0]} / ${versions[1]}`
  } else if (count > 2) {
    compactLabel = `${versions[0]} / ${versions[1]} / ...`
  }

  const fullLabel = versions.join(' / ')
  const compactPosition = calloutLabelPosition(compactLabel, baseX, chartW, margin, charWidth)

  if (count > 2) {
    const expandedPosition = calloutLabelPosition(fullLabel, baseX, chartW, margin, charWidth)
    return html`
      ${text(compactLabel, compactPosition.x, labelY, `${cssClass} release-label-collapsed`, compactPosition.anchor, 'alphabetic')}
      ${text(fullLabel, expandedPosition.x, labelY, `${cssClass} release-label-expanded`, expandedPosition.anchor, 'alphabetic')}
    `
  }

  return text(compactLabel, compactPosition.x, labelY, cssClass, compactPosition.anchor, 'alphabetic')
}

function text(value, x, y, cssClass = '', anchor = 'start', baseline = 'middle') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" class="${cssClass}">${escapeText(value)}</text>`
}

function multilineText(lines, x, y, cssClass = '', anchor = 'start', lineHeight = 12) {
  const cls = cssClass || ((anchor === 'end') ? 'tick' : 'tick tick-right')
  return html`
    <g class="tick-label" transform="translate(${x}, ${y})">
      ${lines.map((value, i) => text(value, 0, i * lineHeight, cls, anchor))}
    </g>
  `
}

function calloutLabelPosition(label, baseX, chartW, margin, charWidth) {
  const halfWidth = (label.length * charWidth) / 2
  const xLeft = baseX - halfWidth
  const xRight = baseX + halfWidth
  const chartRight = chartW - margin

  if (xLeft < margin) {
    return { anchor: 'start', x: margin }
  }
  if (xRight > chartRight) {
    return { anchor: 'end', x: chartRight }
  }
  return { anchor: 'middle', x: baseX }
}

function releaseVersions(releases) {
  const sortedReleases = [...releases].sort((a, b) => {
    const maxA = parseSublimeTextMax(a?.sublime_text)
    const maxB = parseSublimeTextMax(b?.sublime_text)
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

function axisFor(arr, target, height = 1) {
  const step = computeStep(arr, target)
  const steps = Array.from({ length: target + 1 }, (_, i) => i * step)
  const max_scale = target * step
  const px_per_unit = height / max_scale
  const to_px = v => v * px_per_unit
  const y_for = v => height - to_px(v)
  return {
    target,
    step,
    steps,
    max_scale,
    to_px,
    y_for,
  }
}

function computeStep(arr, target) {
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
  const maximum = Math.max(0, ...arr)
  const approximation = Math.ceil(maximum / target)
  const mag = magnitude(approximation)
  const normalized = approximation / mag
  const niceSteps = [1, 2, 2.5, 5, 10]
  for (const nice of niceSteps) {
    if (normalized <= nice) {
      return nice * mag
    }
  }
  return 10 * mag
}

// Magnitude: highest power of 10 <= n.
function magnitude(x) {
  if (x <= 0) return 1
  return Math.pow(10, Math.floor(Math.log10(x)))
}

function mondayAt(dates, i) {
  const anchorMonday = mondayOfIsoWeek(dates[0])
  const monday = new Date(anchorMonday)
  monday.setUTCDate(monday.getUTCDate() - i * 7)
  return monday
}

// Given an ISO week string (e.g. "2025-W01") return the Monday date of that
// week.
function mondayOfIsoWeek(isoWeekStr) {
  const [yearStr, weekStr] = isoWeekStr.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekStr, 10)

  // Jan 4th is in ISO week 1 per rule.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  let weekday_jan4 = jan4.getUTCDay()
  if (weekday_jan4 === 0) weekday_jan4 = 7 // Sunday (=0) is the last day (=7) in ISO.

  return new Date(Date.UTC(year, 0, 4 + (week - 1) * 7 - (weekday_jan4 - 1)))
  //                                  ^ advance to wanted week
  //                                                   ^ back to the monday
}

function dayOffsetOfMonthChange(monday) {
  if (monday.getUTCDate() === 1) return 0
  const nextMonthFirst = new Date(Date.UTC(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    1,
  ))
  const diff = (nextMonthFirst - monday) / MS_PER_DAY

  // Is the 1st of next month inside this week?
  return diff < 7 ? diff : -1
}

function isoWeekString(dateInput) {
  if (!dateInput) return null
  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) return null

  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3)
  const week = 1 + Math.round((target - firstThursday) / MS_PER_WEEK)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function abbrMonth(date) {
  return shortMonthFormatter.format(date)
}

function fullYear(date) {
  return date.getUTCFullYear()
}

function parseSublimeTextMax(input) {
  if (!input || input === '*') return Infinity
  const spec = String(input).replace(/\s+/g, '')
  if (spec.startsWith('<=')) return Number.parseInt(spec.slice(2), 10)
  if (spec.startsWith('<')) return Number.parseInt(spec.slice(1), 10) - 1
  if (spec.startsWith('>=')) return Infinity
  if (spec.startsWith('>')) return Infinity
  if (/^\d{4}-\d{4}$/.test(spec)) return Number.parseInt(spec.split('-')[1], 10)
  if (/^\d{4}$/.test(spec)) return Number.parseInt(spec, 10)
  return Infinity
}

export const __test__ = {
  axisFor,
  computeStep,
  dayOffsetOfMonthChange,
  everyOther,
  magnitude,
  mondayOfIsoWeek,
}

function compact(count) {
  return compactNumberFormatter.format(count)
}

function grouping(count) {
  return groupedNumberFormatter.format(count)
}

function everyOther(arr, start = 0) {
  if (!Array.isArray(arr)) return arr
  const s = Math.abs(start) % 2
  return arr.filter((_, i) => (i % 2) === s)
}

function max(arr, defaultValue = 0) {
  return Math.max(defaultValue, ...(Array.isArray(arr) ? arr : [arr]))
}

function min(arr, defaultValue = Number.POSITIVE_INFINITY) {
  return Math.min(defaultValue, ...(Array.isArray(arr) ? arr : [arr]))
}

function atLeast(v, defaultValue = 0) {
  return Math.max(defaultValue, v)
}

function atMost(v, defaultValue = Number.POSITIVE_INFINITY) {
  return Math.min(defaultValue, v)
}

function clamp(v, minimum, maximum) {
  return atMost(atLeast(v, minimum), maximum)
}

function sum(arr) {
  if (!Array.isArray(arr)) return 0
  return arr.reduce((a, b) => a + b, 0)
}

function range(start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
}

function classes(...tokens) {
  return tokens.filter(Boolean).join(' ')
}

function html(strings, ...values) {
  let out = ''
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i]
    if (i < values.length) {
      out += stringifyHtmlValue(values[i])
    }
  }
  return out
}

function stringifyHtmlValue(value) {
  if (Array.isArray(value)) {
    return value.map(stringifyHtmlValue).join('')
  }
  return value ?? ''
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
