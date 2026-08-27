import { spawnSync } from 'node:child_process'

const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

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

  eleventyConfig.addGlobalData('built', () => {
    const now = new Date()
    return {
      year: now.getFullYear(),
      formatted: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    }
  })
  eleventyConfig.addGlobalData(
    'status_tag_dates_json',
    () => JSON.stringify(readSemverTags()),
  )

  return {
    dir: {
      input: '.',
      output: '_site',
    },
  }
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
