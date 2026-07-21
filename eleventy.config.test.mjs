import { describe, expect, it } from 'vitest'
import { basePackage } from './eleventy.config.mjs'

describe('basePackage compatibility labels', () => {
  it('does not infer ST labels for skeleton tombstones', () => {
    const pkg = basePackage({
      name: 'Yollama',
      labels: ['auto-complete', 'ai', 'assistant'],
      first_seen: '2024-02-19T21:02:58Z',
      removed: '2025-11-16T12:38:48Z',
    })

    expect(pkg.labels).toEqual(['RIP', 'auto-complete', 'ai', 'assistant'])
    expect(pkg.compatibility).toBeNull()
    expect(pkg.outdated).toBe(false)
    expect(pkg.st3_only).toBe(false)
  })

  it('derives ST2 labels and flags from compatibility', () => {
    const pkg = basePackage({
      name: 'Old Package',
      releases: [
        { version: '1.0.0', sublime_text: '<3000', platforms: ['*'] },
      ],
    })

    expect(pkg.labels).toEqual(['ST2'])
    expect(pkg.compatibility).toBe('st2')
    expect(pkg.outdated).toBe(true)
    expect(pkg.st3_only).toBe(false)
  })

  it('derives ST3 labels and flags from compatibility', () => {
    const pkg = basePackage({
      name: 'ST3 Package',
      releases: [
        { version: '1.0.0', sublime_text: '3000-3999', platforms: ['*'] },
      ],
    })

    expect(pkg.labels).toEqual(['ST3'])
    expect(pkg.compatibility).toBe('st3')
    expect(pkg.outdated).toBe(false)
    expect(pkg.st3_only).toBe(true)
  })
})
