export class Sort {
  static sort(packages, sortBy) {
    const sortedPackages = [...packages] // Create a copy to avoid mutating original

    switch (sortBy) {
      case 'name':
        return sortedPackages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

      case 'name-desc':
        return sortedPackages.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()))

      case 'installed':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.installed) || 0
          const B = parseInt(b.installed) || 0
          return B - A // High to low
        })

      case 'stars':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.stars) || 0
          const B = parseInt(b.stars) || 0
          return B - A // High to low
        })

      case 'stars-desc':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.stars) || 0
          const B = parseInt(b.stars) || 0
          return A - B // Low to high
        })

      case 'newest':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.first_seen) || 0
          const B = parseInt(b.first_seen) || 0
          return B - A // High to low
        })

      case 'oldest':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.first_seen) || 0
          const B = parseInt(b.first_seen) || 0
          return A - B // Low to high
        })

      case 'update':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.last_modified) || 0
          const B = parseInt(b.last_modified) || 0
          return B - A // High to low
        })

      case 'author':
        return sortedPackages.sort((a, b) => a.author.toLowerCase().localeCompare(b.author.toLowerCase()))

      case 'author-desc':
        return sortedPackages.sort((a, b) => b.author.toLowerCase().localeCompare(a.author.toLowerCase()))

      case 'list-author':
        return sortedPackages.sort((a, b) =>
          this.compareAuthor(a.author.toLowerCase(), b.author.toLowerCase(), 'asc'))

      case 'list-author-desc':
        return sortedPackages.sort((a, b) =>
          this.compareAuthor(a.author.toLowerCase(), b.author.toLowerCase(), 'desc'))

      case 'relevance':
      default:
        return rankResultsByMagic(sortedPackages)
    }
  }

  // Special sorter; packages without authors go last in *both* directions
  static compareAuthor(a, b, direction = 'asc') {
    if (!a && !b) {
      return 0
    }
    if (!a) {
      return 1
    }
    if (!b) {
      return -1
    }

    if (direction === 'desc') {
      return b.localeCompare(a)
    }

    return a.localeCompare(b)
  }
}

function shiftedSCurve(x, a = 2, b = 0.5) {
  const u = x - b
  const num = Math.pow(u, a)
  const den = num + Math.pow(1 - u, a)
  return num / den
/*
def shifted_s(x, a=2, b=0.5):
    u = x - b
    return (u**a) / (u**a + (1-u)**a)
*/
}

function rankResultsByMagic(results = []) {
  if (!Array.isArray(results) || results.length === 0) {
    return results
  }

  const getMetadataScore = pkg => clamp01(toNumber(pkg.magic_score))
  const maxMiniScore = results.reduce((max, pkg) => Math.max(max, pkg.score ?? 0), 0)
  const finalCache = new WeakMap()

  const getFinalScore = (pkg) => {
    if (finalCache.has(pkg)) {
      return finalCache.get(pkg)
    }
    const normalizedMiniScore = maxMiniScore > 0 ? clamp01((pkg.score ?? 0) / maxMiniScore) : 0
    const factor = shiftedSCurve(normalizedMiniScore, 3, -0.1)
    const score = clamp01(getMetadataScore(pkg) * factor)
    finalCache.set(pkg, score)
    return score
  }

  return results.sort((a, b) => {
    const rankA = getFinalScore(a)
    const rankB = getFinalScore(b)
    if (rankA === rankB) {
      return (
        getMetadataScore(b) - getMetadataScore(a)
        || toNumber(b.installed) - toNumber(a.installed)
        || toNumber(b.stars) - toNumber(a.stars)
        || a.name.localeCompare(b.name)
      )
    }
    return rankB - rankA
  })
}

const clamp01 = value => Math.max(0, Math.min(1, value))
const toNumber = (value, fallback = 0) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}
