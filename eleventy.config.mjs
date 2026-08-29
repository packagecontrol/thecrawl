import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const PATH_PREFIX = normalizePathPrefix(
  process.env.SITE_PATH_PREFIX || '/thecrawl/',
)

export default function (eleventyConfig) {
  eleventyConfig.ignores.add('README.md')

  eleventyConfig.addPassthroughCopy(
    { static: 'static' },
    { filter: source => !source.endsWith('.test.js') },
  )
  eleventyConfig.addPassthroughCopy({
    'registry.json': 'registry.json',
    'channel.json': 'channel.json',
    'logs.json': 'logs.json',
    'node_modules/dompurify/dist/purify.es.mjs':
      'static/vendor/dompurify/purify.es.mjs',
    'node_modules/marked/lib/marked.esm.js':
      'static/vendor/marked/marked.esm.js',
  })
  if (existsSync('crawl-history.json')) {
    eleventyConfig.addPassthroughCopy({
      'crawl-history.json': 'crawl-history.json',
    })
  }

  eleventyConfig.addGlobalData('built', () => {
    const now = new Date()
    return {
      year: now.getFullYear(),
      iso: now.toISOString(),
      formatted: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    }
  })
  eleventyConfig.addGlobalData('artifact_counts', readArtifactCounts)
  eleventyConfig.addGlobalData(
    'status_tag_dates_json',
    () => JSON.stringify(readSemverTags()),
  )
  eleventyConfig.addFilter('site_url', prefixSitePath)

  return {
    pathPrefix: PATH_PREFIX,
    dir: {
      input: '.',
      output: '_site',
    },
  }
}

function prefixSitePath(path) {
  return PATH_PREFIX + String(path || '').replace(/^\/+/, '')
}

function readArtifactCounts() {
  const channel = readJson('channel.json')
  const registry = readJson('registry.json')

  return {
    channelEntries:
      countCachedEntries(channel.packages_cache)
      + countCachedEntries(channel.libraries_cache),
    registryEntries:
      countEntries(registry.packages)
      + countEntries(registry.libraries),
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function countCachedEntries(cache) {
  if (!cache || typeof cache !== 'object') return 0
  return Object.values(cache).reduce(
    (total, entries) => total + countEntries(entries),
    0,
  )
}

function countEntries(entries) {
  return Array.isArray(entries) ? entries.length : 0
}

function normalizePathPrefix(path) {
  const stripped = String(path || '').replace(/^\/+|\/+$/g, '')
  return stripped ? `/${stripped}/` : '/'
}

function readSemverTags() {
  const git = spawnSync(
    'git',
    [
      'for-each-ref',
      '--sort=-taggerdate',
      '--format=%(refname:short)\t%(taggerdate:iso-strict)',
      'refs/tags',
    ],
    { encoding: 'utf8' },
  )

  if (git.status !== 0) {
    return []
  }

  return git.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [tag, date] = line.split('\t')
      return { tag: String(tag || '').trim(), date: String(date || '').trim() }
    })
    .filter(({ tag, date }) => SEMVER_TAG_RE.test(tag) && Number.isFinite(Date.parse(date)))
}
