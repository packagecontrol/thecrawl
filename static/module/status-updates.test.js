import { describe, expect, it } from 'vitest'

import { updatesForPackage } from './status-updates.js'

describe('updatesForPackage', () => {
  const entry = {
    found_updates: [
      { name: 'LSP', published_at: '2026-08-01T00:00:00Z' },
      { name: 'LSP-pyright', published_at: '2026-08-02T00:00:00Z' },
    ],
  }

  it('returns every update when no package is locked', () => {
    expect(updatesForPackage(entry)).toEqual(entry.found_updates)
  })

  it('returns only updates belonging to the locked package', () => {
    expect(updatesForPackage(entry, 'LSP')).toEqual([entry.found_updates[0]])
  })

  it('matches the locked package using normalized names', () => {
    expect(updatesForPackage(entry, '  lsp  ')).toEqual([entry.found_updates[0]])
  })
})
