import { describe, expect, it } from 'vitest'

import { installStatsFor, installTooltipFor } from './card.js'

describe('installation card display', () => {
  const pkg = {
    installs_total: 1_000,
    installs_recent: 250,
    installs_recent_period: 'in the past 3 years',
  }

  it('uses the standard all-time display by default', () => {
    const stats = installStatsFor(pkg)

    expect(stats).toEqual({ count: 1_000, period: null })
    expect(installTooltipFor(stats)).toEqual({
      title: 'Installed 1000 times',
      screenreader: 'installs',
    })
  })

  it('describes the all-time count in total-install mode', () => {
    const stats = installStatsFor(pkg, 'total')

    expect(stats).toEqual({ count: 1_000, period: 'in total' })
    expect(installTooltipFor(stats)).toEqual({
      title: '1,000 installations\nin total',
      screenreader: 'installations in total',
    })
  })

  it('describes the windowed count in recent-install mode', () => {
    const stats = installStatsFor(pkg, 'recent')

    expect(stats).toEqual({ count: 250, period: 'in the past 3 years' })
    expect(installTooltipFor(stats)).toEqual({
      title: '250 installations\nin the past 3 years',
      screenreader: 'installations in the past 3 years',
    })
  })
})
