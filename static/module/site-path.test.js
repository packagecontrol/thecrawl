import { describe, expect, it } from 'vitest'
import {
  normalizeSitePathPrefix,
  sitePath,
  siteRelativePath,
} from './site-path.mjs'

describe('normalizeSitePathPrefix', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['website-stage', '/website-stage'],
    ['/website-stage/', '/website-stage'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeSitePathPrefix(input)).toBe(expected)
  })
})

describe('sitePath', () => {
  it('prefixes site-root paths', () => {
    expect(sitePath('/', '/website-stage')).toBe('/website-stage/')
    expect(sitePath('/packages/Test', '/website-stage')).toBe('/website-stage/packages/Test')
    expect(sitePath('/?q=test', '/website-stage')).toBe('/website-stage/?q=test')
  })

  it('normalizes the configured prefix', () => {
    expect(sitePath('/labels', 'website-stage/')).toBe('/website-stage/labels')
  })

  it('leaves paths alone without a prefix', () => {
    expect(sitePath('/labels', '')).toBe('/labels')
  })

  it('leaves external and already-prefixed paths alone', () => {
    expect(sitePath('https://example.com/', '/website-stage')).toBe('https://example.com/')
    expect(sitePath('//example.com/asset', '/website-stage')).toBe('//example.com/asset')
    expect(sitePath('/website-stage/labels', '/website-stage')).toBe('/website-stage/labels')
  })
})

describe('siteRelativePath', () => {
  it('removes the configured prefix', () => {
    expect(siteRelativePath('/website-stage', '/website-stage')).toBe('/')
    expect(siteRelativePath('/website-stage/', '/website-stage')).toBe('/')
    expect(siteRelativePath('/website-stage/packages/Test', '/website-stage'))
      .toBe('/packages/Test')
  })

  it('does not remove partial or absent prefixes', () => {
    expect(siteRelativePath('/website-stagecoach', '/website-stage'))
      .toBe('/website-stagecoach')
    expect(siteRelativePath('/packages/Test', '')).toBe('/packages/Test')
  })
})
