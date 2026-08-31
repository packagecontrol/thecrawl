import { normalizePackageNameKey } from './status-failing.js'

/**
 * Return all updates for an entry, or only updates belonging to a locked
 * package when a package name is provided.
 *
 * @param {{ found_updates?: unknown[] } | undefined} entry
 * @param {string} [packageName]
 * @returns {unknown[]}
 */
export function updatesForPackage(entry, packageName = '') {
  const updates = Array.isArray(entry?.found_updates) ? entry.found_updates : []
  const packageNameKey = normalizePackageNameKey(packageName)
  if (!packageNameKey) return updates

  return updates.filter(update => (
    normalizePackageNameKey(update?.name) === packageNameKey
  ))
}
