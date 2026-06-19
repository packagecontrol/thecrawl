import { describe, expect, it } from 'vitest'
import {
  isMarkdown,
  renderReadme,
} from './readme-renderer.mjs'

describe('README type detection', () => {
  it.each([
    'https://example.test/repo/README',
    'https://example.test/repo/README.txt',
    'https://example.test/repo/readme.MD',
    'https://example.test/repo/README.mkd',
    'https://example.test/repo/README.mdown',
    'https://example.test/repo/README.markdown',
  ])('treats %s as Markdown', (url) => {
    expect(isMarkdown(url)).toBe(true)
  })

  it.each([
    'https://example.test/repo/README.rst',
    'https://example.test/repo/readme.creole',
    'https://example.test/repo/README.adoc',
    'https://example.test/repo/README.textile',
    'https://example.test/repo/README.org',
  ])('does not treat %s as Markdown', (url) => {
    expect(isMarkdown(url)).toBe(false)
  })
})

describe('renderReadme', () => {
  it('renders non-Markdown README formats as escaped raw text', () => {
    const html = renderReadme(null, '<b>Title</b> & text', 'https://example.test/README.rst', {})

    expect(html).toBe('<pre class="fallback">&lt;b&gt;Title&lt;/b&gt; &amp; text</pre>')
  })

  it('uses escaped raw text as the generic fallback', () => {
    const html = renderReadme(null, '<b>Title</b> & text', 'https://example.test/README.weird', {})

    expect(html).toBe('<pre class="fallback">&lt;b&gt;Title&lt;/b&gt; &amp; text</pre>')
  })
})
