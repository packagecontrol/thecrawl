import { execFileSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const API_ROOT = 'https://api.github.com'
const REPOSITORY = 'packagecontrol/thecrawl'
const ARTIFACT_NAME = 'crawl-backup'
const WORKSPACE_NAME = 'workspace.json'
const CACHE_DIRECTORY = '.crawl-history-cache'
const CONCURRENCY = 8
const RANGE_PADDING = 4096

await main()

async function main() {
  const logsPath = path.resolve(process.argv[2] || 'logs.json')
  const outputPath = path.resolve(process.argv[3] || 'crawl-history.json')
  const cachePath = path.resolve(CACHE_DIRECTORY)
  const token = resolveGitHubToken()
  const logs = JSON.parse(await readFile(logsPath, 'utf8'))
  const entriesByRunId = new Map(
    logs
      .filter(entry => entry?.run_id)
      .map(entry => [String(entry.run_id), entry]),
  )

  await mkdir(cachePath, { recursive: true })
  await pruneCache(cachePath, new Set(entriesByRunId.keys()))
  const cachedRecords = (
    await mapConcurrent(
      [...entriesByRunId.keys()],
      CONCURRENCY,
      runId => readCachedRecord(cachePath, runId),
    )
  ).filter(Boolean)
  const cachedRunIds = new Set(cachedRecords.map(record => record.run_id))
  const missingRunIds = new Set(
    [...entriesByRunId.keys()].filter(runId => !cachedRunIds.has(runId)),
  )
  const artifacts = missingRunIds.size ? await fetchArtifacts(token) : []
  const relevant = artifacts.filter(artifact => (
    !artifact.expired
    && artifact.name === ARTIFACT_NAME
    && missingRunIds.has(String(artifact.workflow_run?.id || ''))
  ))

  console.log(
    `Loaded ${cachedRecords.length} cached runs; `
    + `${relevant.length} retained crawl backups require collection.`,
  )

  let completed = 0
  const failures = []
  const collectedRecords = await mapConcurrent(relevant, CONCURRENCY, async (artifact) => {
    const runId = String(artifact.workflow_run.id)
    const entry = entriesByRunId.get(runId)

    try {
      const record = await collectRunRecord(token, artifact.id, {
        ...entry,
        artifact_size: artifact.size_in_bytes,
      })
      await writeFile(
        path.join(cachePath, `${runId}.json`),
        JSON.stringify(record),
        'utf8',
      )
      return record
    }
    catch (error) {
      failures.push(runId)
      console.error(`\n${runId}: ${error.message}`)
      return null
    }
    finally {
      completed += 1
      if (completed % 10 === 0 || completed === relevant.length) {
        process.stdout.write(`\rCollected ${completed}/${relevant.length} backups`)
      }
    }
  })
  if (relevant.length) process.stdout.write('\n')

  const records = [...cachedRecords, ...collectedRecords].filter(Boolean)
  const history = buildHistory(logs, records)
  await writeFile(outputPath, JSON.stringify(history), 'utf8')

  console.log(
    `Wrote ${outputPath} with ${history.available.length} runs and `
    + `${Object.keys(history.packages).length} packages.`,
  )
  if (failures.length) {
    console.warn(`Could not collect ${failures.length} runs: ${failures.join(', ')}`)
  }
}

async function collectRunRecord(token, artifactId, entry) {
  const workspace = await downloadWorkspace(token, artifactId, entry.artifact_size)
  const timestamp = workspaceTimestamp(entry.date)
  const touched = new Set()

  for (const packageEntry of Object.values(workspace.packages || {})) {
    if (packageEntry?.last_seen === timestamp && packageEntry.name) {
      touched.add(packageEntry.name)
    }
  }
  for (const packageName of extractFailedAttemptNames(entry.notes || '')) {
    touched.add(packageName)
  }

  const expected = extractExpectedCrawlCount(entry.notes || '')
  if (expected !== null && touched.size !== expected) {
    console.warn(
      `\n${entry.run_id}: derived ${touched.size}/${expected} attempted packages`,
    )
  }

  return {
    run_id: String(entry.run_id),
    packages: [...touched].sort(compareNames),
  }
}

function buildHistory(logs, records) {
  const runs = logs.map(entry => String(entry.run_id || ''))
  const runIndexes = new Map(runs.map((runId, index) => [runId, index]))
  const available = []
  const packageRuns = new Map()

  for (const record of records) {
    const runIndex = runIndexes.get(record.run_id)
    if (typeof runIndex !== 'number') continue
    available.push(runIndex)

    for (const packageName of record.packages) {
      const indexes = packageRuns.get(packageName) || []
      indexes.push(runIndex)
      packageRuns.set(packageName, indexes)
    }
  }

  available.sort((a, b) => a - b)
  const packages = Object.fromEntries(
    [...packageRuns]
      .sort(([left], [right]) => compareNames(left, right))
      .map(([name, indexes]) => [name, indexes.sort((a, b) => a - b)]),
  )

  return {
    generated_at: new Date().toISOString(),
    runs,
    available,
    packages,
  }
}

async function downloadWorkspace(token, artifactId, archiveSize) {
  return retry(async () => {
    const archiveUrl = await fetchArtifactUrl(token, artifactId)
    const tailStart = Math.max(0, archiveSize - 65536)
    const tail = await fetchRange(
      archiveUrl,
      `bytes=${tailStart}-${archiveSize - 1}`,
    )
    const entry = findZipEntry(tail, WORKSPACE_NAME)
    if (!entry) throw new Error(`${WORKSPACE_NAME} is missing from artifact ${artifactId}`)

    const end = entry.localOffset + 30 + entry.compressedSize + RANGE_PADDING
    const payload = await fetchRange(
      archiveUrl,
      `bytes=${entry.localOffset}-${end}`,
    )
    const workspaceBytes = extractLocalZipEntry(payload, entry)
    return JSON.parse(workspaceBytes.toString('utf8'))
  })
}

async function fetchArtifactUrl(token, artifactId) {
  const response = await fetch(
    `${API_ROOT}/repos/${REPOSITORY}/actions/artifacts/${artifactId}/zip`,
    {
      redirect: 'manual',
      headers: githubHeaders(token),
    },
  )
  if (response.status !== 302) {
    throw new Error(`artifact download returned HTTP ${response.status}`)
  }
  const location = response.headers.get('location')
  if (!location) throw new Error('artifact download omitted its redirect URL')
  return location
}

async function fetchRange(url, range) {
  const response = await fetch(url, { headers: { Range: range } })
  if (response.status !== 206) {
    throw new Error(`artifact range ${range} returned HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function findZipEntry(tail, wantedName) {
  for (let offset = 0; offset <= tail.length - 46; offset += 1) {
    if (tail.readUInt32LE(offset) !== 0x02014b50) continue

    const compressedSize = tail.readUInt32LE(offset + 20)
    const filenameLength = tail.readUInt16LE(offset + 28)
    const extraLength = tail.readUInt16LE(offset + 30)
    const commentLength = tail.readUInt16LE(offset + 32)
    const localOffset = tail.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + filenameLength
    const name = tail.subarray(nameStart, nameEnd).toString('utf8')
    if (name === wantedName) {
      return {
        compressionMethod: tail.readUInt16LE(offset + 10),
        compressedSize,
        localOffset,
      }
    }
    offset = nameEnd + extraLength + commentLength - 1
  }
  return null
}

function extractLocalZipEntry(payload, entry) {
  if (payload.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('invalid ZIP local-file header')
  }
  const filenameLength = payload.readUInt16LE(26)
  const extraLength = payload.readUInt16LE(28)
  const start = 30 + filenameLength + extraLength
  const compressed = payload.subarray(start, start + entry.compressedSize)
  if (compressed.length !== entry.compressedSize) {
    throw new Error('incomplete ZIP entry range')
  }
  if (entry.compressionMethod === 0) return compressed
  if (entry.compressionMethod === 8) return inflateRawSync(compressed)
  throw new Error(`unsupported ZIP compression method ${entry.compressionMethod}`)
}

async function fetchArtifacts(token) {
  const artifacts = []
  for (let page = 1; ; page += 1) {
    const url = new URL(`${API_ROOT}/repos/${REPOSITORY}/actions/artifacts`)
    url.searchParams.set('name', ARTIFACT_NAME)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    const response = await fetch(url, { headers: githubHeaders(token) })
    if (!response.ok) {
      throw new Error(`artifact listing returned HTTP ${response.status}`)
    }
    const payload = await response.json()
    const pageArtifacts = Array.isArray(payload.artifacts) ? payload.artifacts : []
    artifacts.push(...pageArtifacts)
    if (pageArtifacts.length < 100) return artifacts
  }
}

function extractFailedAttemptNames(notes) {
  const names = new Set()
  const patterns = [
    /^HTTP error during crawl for (.+?):/gm,
    /^Skip soft-tombstoned \*(.+?)\*:/gm,
    /^Skip fatally blocked \*(.+?)\*:/gm,
    /^Denied update during crawl for (.+?):/gm,
    /^Heart attack during crawl for (.+?):/gm,
    /^Exception while crawling (.+)$/gm,
  ]
  for (const pattern of patterns) {
    for (const match of notes.matchAll(pattern)) names.add(match[1].trim())
  }
  return names
}

function extractExpectedCrawlCount(notes) {
  const match = notes.match(
    /^Found (\d+) packages? to crawl\.(?: Pick (\d+) of them\.)?/m,
  )
  if (!match) return null
  return Number(match[2] || match[1])
}

function workspaceTimestamp(date) {
  const parsed = new Date(date)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid log date: ${date}`)
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function readCachedRecord(cachePath, runId) {
  try {
    return JSON.parse(await readFile(path.join(cachePath, `${runId}.json`), 'utf8'))
  }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function pruneCache(cachePath, retainedRunIds) {
  const filenames = await readdir(cachePath)
  await Promise.all(filenames.map(async (filename) => {
    if (!filename.endsWith('.json')) return
    const runId = filename.slice(0, -'.json'.length)
    if (!retainedRunIds.has(runId)) {
      await unlink(path.join(cachePath, filename))
    }
  }))
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker),
  )
  return results
}

async function retry(operation, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (attempt < attempts) await delay(500 * (2 ** (attempt - 1)))
    }
  }
  throw lastError
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function resolveGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
}

function compareNames(left, right) {
  return left.localeCompare(right, 'en', { sensitivity: 'base' })
}
