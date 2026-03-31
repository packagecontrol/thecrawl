import { describe, expect, it } from 'vitest'

import {
  diffFailingPackages,
  extractCurrentlyFailing,
  extractCurrentlyFailingBlocks,
  normalizePackageNameKey,
  normalizeStatusNotes,
} from './status-failing.js'

describe('status-failing helpers', () => {
  it('normalizes notes line endings and legacy currently-failing heading', () => {
    const text = 'A\r\n**currently failing**:\r\n- **Pkg** [since now]\r\n  fail\r\n'
    const normalized = normalizeStatusNotes(text)

    expect(normalized).toContain('A\n#### Currently failing\n')
    expect(normalized).not.toContain('\r')
  })

  it('extracts currently failing section and strips relative date annotations', () => {
    const notes = [
      'Some intro',
      '',
      '#### Currently failing',
      '- **Alpha** [since 2 days]',
      '  timeout',
      '- **Beta** [since now]',
      '  404',
    ].join('\n')

    expect(extractCurrentlyFailing('')).toBe(false)
    expect(extractCurrentlyFailing('no section here')).toBe('')
    expect(extractCurrentlyFailing(notes)).toBe([
      '- **Alpha**',
      'timeout',
      '- **Beta**',
      '404',
    ].join('\n'))
  })

  it('parses currently failing blocks with stable signatures', () => {
    const notes = [
      '#### Currently failing',
      '- **Alpha** [since now]',
      '  timeout',
      '- **Beta** [since 3 days]',
      '  404',
    ].join('\n')

    expect(extractCurrentlyFailingBlocks(notes)).toEqual([
      {
        name: 'Alpha',
        nameKey: 'alpha',
        signature: 'Alpha\ntimeout',
      },
      {
        name: 'Beta',
        nameKey: 'beta',
        signature: 'Beta\n404',
      },
    ])
  })

  it('computes changed and removed failing packages with anchors', () => {
    const previousNotes = [
      '#### Currently failing',
      '- **Alpha** [since 2 days]',
      '  timeout',
      '- **Beta** [since 3 days]',
      '  404',
      '- **Gamma** [since 1 day]',
      '  denied',
    ].join('\n')

    const currentNotes = [
      '#### Currently failing',
      '- **Alpha** [since 3 days]',
      '  timeout changed',
      '- **Gamma** [since 2 days]',
      '  denied',
      '- **Delta** [since now]',
      '  new issue',
    ].join('\n')

    const diff = diffFailingPackages(currentNotes, previousNotes)

    expect(Array.from(diff.changedNames).sort()).toEqual(['alpha', 'delta'])
    expect(diff.removedBlocks).toEqual([
      {
        name: 'Beta',
        nameKey: 'beta',
        anchorNameKey: 'gamma',
      },
    ])
  })

  it('normalizes package name keys consistently', () => {
    expect(normalizePackageNameKey('  My   Package  ')).toBe('my package')
    expect(normalizePackageNameKey('My\tPackage')).toBe('my package')
  })
})
