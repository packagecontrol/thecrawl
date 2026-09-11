import { describe, expect, it } from 'vitest'
import { splitSearchResults } from './list.js'

describe('splitSearchResults', () => {
  const living = { name: 'Living' }
  const st2 = { name: 'ST2', outdated: true }
  const dead = { name: 'Dead', removed: 1, graveyard: true }

  it('separates ST2 and graveyard addenda from normal search results', () => {
    expect(splitSearchResults([living, st2, dead], true)).toEqual({
      searchResults: [living],
      st2Results: [st2],
      graveyardResults: [dead],
    })
  })

  it('does not add supplementary entries when listing all packages', () => {
    expect(splitSearchResults([living, st2, dead], false)).toEqual({
      searchResults: [living],
      st2Results: [st2],
      graveyardResults: [],
    })
  })

  it('does not add supplementary entries for ten or more matches', () => {
    const results = [dead, st2, ...Array.from({ length: 8 }, (_, index) => ({ name: `Living ${index}` }))]
    expect(splitSearchResults(results, true)).toEqual({
      searchResults: results.slice(2),
      st2Results: [st2],
      graveyardResults: [],
    })
  })
})
