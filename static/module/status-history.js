import { normalizePackageNameKey } from './status-failing.js'

/**
 * Convert the compact crawl-history payload into lookup sets used by the
 * chart. Invalid run indexes are ignored so partially generated data remains
 * safe to use.
 *
 * @param {unknown} payload
 * @returns {{
 *   availableRunIds: Set<string>,
 *   packageNames: string[],
 *   packagesByName: Map<string, { name: string, touchedRunIds: Set<string> }>,
 * }}
 */
export function parseCrawlHistory(payload) {
  const runs = Array.isArray(payload?.runs)
    ? payload.runs.map(runId => String(runId || ''))
    : []
  const availableRunIds = runIdsAtIndexes(runs, payload?.available)
  const packageNames = []
  const packagesByName = new Map()
  const packages = isPlainObject(payload?.packages) ? payload.packages : {}

  for (const [name, indexes] of Object.entries(packages)) {
    const nameKey = normalizePackageNameKey(name)
    if (!nameKey || !Array.isArray(indexes)) continue
    packageNames.push(name)
    packagesByName.set(nameKey, {
      name,
      touchedRunIds: runIdsAtIndexes(runs, indexes),
    })
  }

  return { availableRunIds, packageNames, packagesByName }
}

/**
 * Resolve an exact package-name query to its run lookup. Free-form notes
 * searches continue to work when no package has that exact name.
 *
 * @param {ReturnType<typeof parseCrawlHistory> | null} history
 * @param {string} query
 * @returns {{
 *   name: string,
 *   availableRunIds: Set<string>,
 *   touchedRunIds: Set<string>,
 * } | null}
 */
export function resolvePackageRunState(history, query) {
  if (!history) return null
  const packageEntry = history.packagesByName.get(normalizePackageNameKey(query))
  if (!packageEntry) return null
  return {
    name: packageEntry.name,
    availableRunIds: history.availableRunIds,
    touchedRunIds: packageEntry.touchedRunIds,
  }
}

function runIdsAtIndexes(runs, indexes) {
  const runIds = new Set()
  if (!Array.isArray(indexes)) return runIds

  for (const index of indexes) {
    if (!Number.isInteger(index) || !runs[index]) continue
    runIds.add(runs[index])
  }
  return runIds
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
