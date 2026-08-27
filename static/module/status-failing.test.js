import { describe, expect, it } from 'vitest'

import {
  annotateChanges,
  classForConclusion,
  diffFailingPackages,
  extractCurrentlyFailing,
  extractCurrentlyFailingBlocks,
  extractPackagesCrawled,
  findComparablePreviousSection,
  findGlitchStartIndex,
  isHardFailureWithoutNotes,
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

  it('extracts package crawl counts from notes', () => {
    const notes = 'Found 1,234 packages to crawl.'

    expect(extractPackagesCrawled(notes)).toBe(1234)
    expect(extractPackagesCrawled('No package count here')).toBeNull()
    expect(extractPackagesCrawled('')).toBeNull()
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

  it('maps workflow conclusions to status classes', () => {
    expect(classForConclusion('success')).toBe('')
    expect(classForConclusion('failure')).toBe('error')
    expect(classForConclusion('timed_out')).toBe('error')
    expect(classForConclusion('neutral')).toBe('warn')
    expect(classForConclusion('unknown_value')).toBe('muted')
  })

  it('detects hard failures without notes', () => {
    expect(isHardFailureWithoutNotes({ notes: '', conclusion: 'failure' })).toBe(true)
    expect(isHardFailureWithoutNotes({ notes: 'has notes', conclusion: 'failure' })).toBe(false)
    expect(isHardFailureWithoutNotes({ notes: '', conclusion: 'success' })).toBe(false)
  })

  it('finds comparable previous sections while skipping hard failures', () => {
    const entries = [
      { notes: '#### Currently failing\n- **Now**\n  fail', conclusion: 'success' },
      { notes: '', conclusion: 'failure' },
      { notes: '#### Currently failing\n- **Then**\n  fail', conclusion: 'success' },
    ]
    const sections = entries.map(entry => extractCurrentlyFailing(entry.notes || ''))

    expect(findComparablePreviousSection(entries, sections, 1, 1)).toEqual({
      index: 2,
      section: '- **Then**\nfail',
    })
  })

  it('finds glitch start index across skip-eligible hard failures', () => {
    const entries = [
      { notes: '#### Currently failing\n- **A**\n  fail', conclusion: 'success' },
      { notes: '#### Currently failing\n- **B**\n  fail', conclusion: 'success' },
      { notes: '', conclusion: 'failure' },
      { notes: '#### Currently failing\n- **A**\n  fail', conclusion: 'success' },
    ]
    const sections = entries.map(entry => extractCurrentlyFailing(entry.notes || ''))

    expect(findGlitchStartIndex(entries, sections, 2, 0, 2)).toBe(1)
  })

  it('annotates change and glitch metadata for transient failures', () => {
    const entries = [
      { id: 'now', notes: '#### Currently failing\n- **A**\n  fail', conclusion: 'success' },
      { id: 'middle', notes: '#### Currently failing\n- **B**\n  fail', conclusion: 'success' },
      { id: 'old', notes: '#### Currently failing\n- **A**\n  fail', conclusion: 'success' },
    ]

    const annotated = annotateChanges(entries, { lookback: 10, maxSkippedHardFailures: 2 })

    expect(annotated[0].failuresChanged).toBe(true)
    expect(annotated[0].glitchStartIndex).toBe(1)
    expect(annotated[1].failuresChanged).toBe(true)
    expect(annotated[1].glitchStartIndex).toBeNull()
  })
})
