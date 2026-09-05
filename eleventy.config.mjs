import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'

const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const PATH_PREFIX = normalizePathPrefix(
  process.env.SITE_PATH_PREFIX || '/thecrawl/',
)

export default function (eleventyConfig) {
  const isBuild = process.env.ELEVENTY_RUN_MODE === 'build'
  // Source assets change with commits; crawler artifacts use content hashes.
  const staticOutputDir = isBuild ? `static_${readGitHash()}` : 'static'
  const logsOutputFile = isBuild
    ? versionedDataPath('logs.json')
    : 'data/logs.json'
  const hasCrawlHistory = existsSync('crawl-history.json')
  const historyOutputFile = isBuild && hasCrawlHistory
    ? versionedDataPath('crawl-history.json')
    : 'data/crawl-history.json'
  const bundledScriptEntries = new Set()

  eleventyConfig.ignores.add('README.md')

  eleventyConfig.addPassthroughCopy(
    { static: staticOutputDir },
    { filter: source => !source.endsWith('.test.js') },
  )
  eleventyConfig.addPassthroughCopy({
    'registry.json': 'registry.json',
    'channel.json': 'channel.json',
    'node_modules/dompurify/dist/purify.es.mjs':
      `${staticOutputDir}/vendor/dompurify/purify.es.mjs`,
    'node_modules/marked/lib/marked.esm.js':
      `${staticOutputDir}/vendor/marked/marked.esm.js`,
  })
  eleventyConfig.addPassthroughCopy({
    'logs.json': logsOutputFile,
  })
  if (hasCrawlHistory) {
    eleventyConfig.addPassthroughCopy({
      'crawl-history.json': historyOutputFile,
    })
  }

  eleventyConfig.on('eleventy.before', () => {
    bundledScriptEntries.clear()
  })
  eleventyConfig.on('eleventy.after', async ({ directories } = {}) => {
    if (!isBuild) return

    const outputDir = directories?.output ?? '_site'
    await bundleJavaScript(
      path.join(outputDir, staticOutputDir),
      bundledScriptEntries,
    )
  })

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
  eleventyConfig.addGlobalData(
    'logs_url',
    prefixSitePath(logsOutputFile),
  )
  eleventyConfig.addGlobalData(
    'crawl_history_url',
    prefixSitePath(historyOutputFile),
  )
  eleventyConfig.addGlobalData(
    'data_manifest_url',
    prefixSitePath('data-manifest.json'),
  )
  eleventyConfig.addFilter('site_url', prefixSitePath)
  eleventyConfig.addFilter(
    'static_url',
    source => prefixSitePath(versionedStaticUrl(source, staticOutputDir)),
  )
  eleventyConfig.addFilter(
    'bundled',
    source => bundledScriptUrl(
      source,
      bundledScriptEntries,
      staticOutputDir,
      isBuild,
    ),
  )

  return {
    pathPrefix: PATH_PREFIX,
    dir: {
      input: '.',
      output: '_site',
    },
  }
}

async function bundleJavaScript(staticOutputDir, entries) {
  if (!entries.size) return

  await esbuild.build({
    entryPoints: Object.fromEntries(
      [...entries].sort().map(fileName => [
        path.basename(fileName, '.js'),
        path.join(staticOutputDir, fileName),
      ]),
    ),
    outdir: path.join(staticOutputDir, 'bundle'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    splitting: false,
  })
}

function bundledScriptUrl(source, entries, staticOutputDir, isBuild) {
  const match = String(source).match(/^(\/?)static\/([^/]+\.js)$/)
  if (!match) {
    throw new Error(`[bundled] Expected /static/<entry>.js, got ${source}`)
  }

  const [, leadingSlash, fileName] = match
  entries.add(fileName)
  if (!isBuild) return source
  return `${leadingSlash}${staticOutputDir}/bundle/${fileName}`
}

function versionedStaticUrl(source, staticOutputDir) {
  return String(source).replace(/^(\/?)static\//, `$1${staticOutputDir}/`)
}

function prefixSitePath(path) {
  return PATH_PREFIX + String(path || '').replace(/^\/+/, '')
}

function versionedDataPath(fileName) {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  const hash = createHash('sha256')
    .update(readFileSync(fileName))
    .digest('hex')
    .slice(0, 12)
  return `data/${stem}_${hash}${extension}`
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

function readGitHash() {
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  })
  if (git.status !== 0) {
    throw new Error('Unable to determine the static asset version from git')
  }
  return git.stdout.trim()
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
