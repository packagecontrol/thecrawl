#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'

const RAW_GITHUB_HOST = 'raw.githubusercontent.com'

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const workspace = JSON.parse(fs.readFileSync(args.workspacePath, 'utf8'))
  const sources = selectSources(workspace, args.threshold)

  recreateDirectory(args.repositoriesPath)

  const checkouts = await cloneSources(sources, args.repositoriesPath)
  console.log('Done with cloning; process what we have...')
  const sourceModel = {}

  for (const { source, checkoutPath } of checkouts) {
    const locations = buildSourceLocations(source, checkoutPath)
    if (Object.keys(locations).length > 0) {
      sourceModel[source.url] = locations
    }
  }

  fs.mkdirSync(path.dirname(path.resolve(args.outputPath)), { recursive: true })
  fs.writeFileSync(
    args.outputPath,
    JSON.stringify(sortSourceModel(sourceModel), null, 2) + '\n',
  )

  const packageCount = Object.values(sourceModel)
    .reduce((count, packages) => count + Object.keys(packages).length, 0)
  console.log(
    `Wrote ${packageCount} package locations from `
    + `${Object.keys(sourceModel).length} sources to ${args.outputPath}`,
  )
}

export async function cloneSources(
  sources,
  repositoriesPath,
  clone = cloneSource,
) {
  const checkouts = await Promise.all(sources.map(async (source) => {
    const label = `${source.owner}/${source.repository}@${source.ref}`
    console.log(`Cloning ${label}`)

    try {
      const checkoutPath = await clone(source, repositoriesPath)
      return { source, checkoutPath }
    } catch (error) {
      console.error(`Cloning ${label} -- erred.\n${error.message}`)
      return null
    }
  }))

  return checkouts.filter(checkout => checkout !== null)
}

export function selectSources(workspace, threshold) {
  const packagesBySource = new Map()

  for (const pkg of Object.values(workspace.packages)) {
    if (pkg.removed || !pkg.source) continue

    if (!packagesBySource.has(pkg.source)) {
      packagesBySource.set(pkg.source, new Set())
    }
    packagesBySource.get(pkg.source).add(pkg.name)
  }

  const sources = []
  for (const [url, packageNames] of packagesBySource) {
    if (packageNames.size <= threshold) continue

    const repository = parseGitHubSourceUrl(url)
    if (!repository) {
      console.warn(`Skipping unsupported source with ${packageNames.size} packages: ${url}`)
      continue
    }

    sources.push({ url, packageNames, ...repository })
  }

  return sources.sort((a, b) => a.url.localeCompare(b.url))
}

export function buildSourceLocations(source, checkoutPath) {
  const root = readRepositoryFile(source, checkoutPath, source.url)
  const files = [root]

  for (const include of root.data.includes ?? []) {
    const includeUrl = new URL(include, source.url).href
    const includeSource = parseGitHubSourceUrl(includeUrl)
    if (!includeSource || !isSameCheckout(source, includeSource)) {
      console.warn(`Skipping include outside ${source.owner}/${source.repository}: ${includeUrl}`)
      continue
    }
    files.push(readRepositoryFile(includeSource, checkoutPath, includeUrl))
  }

  const locations = {}
  for (const file of files) {
    const fieldLines = indexStringFieldLines(file.contents)
    for (const pkg of file.data.packages ?? []) {
      const name = extractPackageName(pkg)
      if (!name || !source.packageNames.has(name) || locations[name]) continue

      const line = packageLineNumber(pkg, fieldLines)
      if (line) {
        locations[name] = { url: file.url, line }
      }
    }
  }

  const missing = [...source.packageNames].filter(name => !locations[name])
  if (missing.length > 0) {
    const sample = missing.slice(0, 5).join(', ')
    const remainder = missing.length > 5 ? ` and ${missing.length - 5} more` : ''
    console.warn(`Missing ${missing.length} locations from ${source.url}: ${sample}${remainder}`)
  }

  return sortPackageLocations(locations)
}

/**
 * Parse a raw GitHub file URL into the repository checkout and file location.
 *
 * For example, `/owner/repo/refs/heads/main/repository.json` becomes
 * `{ owner, repository: repo, ref: main, filePath: repository.json }`.
 * The abbreviated `/owner/repo/main/repository.json` form is also supported.
 * Return null for non-GitHub hosts or URLs missing a repository, ref, or file.
 */
export function parseGitHubSourceUrl(sourceUrl) {
  const url = new URL(sourceUrl)
  if (url.hostname.toLowerCase() !== RAW_GITHUB_HOST) return null

  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, repository, ...remainder] = segments
  if (!owner || !repository || remainder.length < 2) return null

  let ref
  let filePath
  if (remainder[0] === 'refs' && ['heads', 'tags'].includes(remainder[1])) {
    ref = remainder[2]
    filePath = remainder.slice(3).join('/')
  } else {
    ref = remainder[0]
    filePath = remainder.slice(1).join('/')
  }
  if (!ref || !filePath) return null

  return {
    owner,
    repository,
    ref,
    filePath,
    cloneUrl: `https://github.com/${owner}/${repository}.git`,
  }
}

export function extractPackageName(pkg) {
  if (pkg.name) return pkg.name
  if (!pkg.details) return null

  const parts = new URL(pkg.details).pathname.replace(/^\/+|\/+$/g, '').split('/')
  return parts.length >= 2 ? parts[1] : null
}

function parseArgs(argv) {
  const positional = []
  let outputPath = null
  let threshold = null

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '-o' || arg === '--output') {
      outputPath = argv[++index]
    } else if (arg === '-t' || arg === '--threshold') {
      threshold = Number(argv[++index])
    } else {
      positional.push(arg)
    }
  }

  if (
    positional.length !== 2
    || !outputPath
    || !Number.isInteger(threshold)
    || threshold < 0
  ) {
    throw new Error(
      'Usage: node util/build-source-map.mjs '
      + '<workspace.json> <repositories-path> -o <output.json> -t <threshold>',
    )
  }

  return {
    workspacePath: positional[0],
    repositoriesPath: positional[1],
    outputPath,
    threshold,
  }
}

function recreateDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true })
  fs.mkdirSync(directoryPath, { recursive: true })
}

async function cloneSource(source, repositoriesPath) {
  const directoryName = [
    source.owner,
    source.repository,
    source.ref,
    source.filePath,
  ].join('--').replace(/[^A-Za-z0-9_.-]/g, '-')
  const checkoutPath = path.join(repositoriesPath, directoryName)

  await run('git', [
    'clone',
    '--quiet',
    '--depth', '1',
    '--single-branch',
    '--branch', source.ref,
    source.cloneUrl,
    checkoutPath,
  ])
  return checkoutPath
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
      }
    })
  })
}

function readRepositoryFile(source, checkoutPath, url) {
  const filePath = path.join(checkoutPath, ...source.filePath.split('/'))
  const contents = fs.readFileSync(filePath, 'utf8')
  return {
    url,
    contents,
    data: JSON.parse(contents),
  }
}

function isSameCheckout(a, b) {
  return a.owner === b.owner
    && a.repository === b.repository
    && a.ref === b.ref
}

function indexStringFieldLines(contents) {
  const linesByField = new Map()
  const fieldPattern = /"(name|details)"\s*:\s*("(?:[^"\\]|\\.)*")/g
  const lines = contents.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    for (const match of lines[index].matchAll(fieldPattern)) {
      const key = `${match[1]}\u0000${JSON.parse(match[2])}`
      if (!linesByField.has(key)) {
        linesByField.set(key, index + 1)
      }
    }
  }

  return linesByField
}

function packageLineNumber(pkg, fieldLines) {
  if (pkg.name) {
    const nameLine = fieldLines.get(`name\u0000${pkg.name}`)
    if (nameLine) return nameLine
  }
  if (pkg.details) {
    return fieldLines.get(`details\u0000${pkg.details}`) ?? null
  }
  return null
}

function sortSourceModel(sourceModel) {
  return Object.fromEntries(
    Object.entries(sourceModel)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, packages]) => [source, sortPackageLocations(packages)]),
  )
}

function sortPackageLocations(locations) {
  return Object.fromEntries(
    Object.entries(locations).sort(([a], [b]) => a.localeCompare(b)),
  )
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
