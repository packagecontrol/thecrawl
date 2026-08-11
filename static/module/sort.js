export class Sort {
  static sort(packages, sortBy) {
    const sortedPackages = [...packages] // Create a copy to avoid mutating original
    annotateMagicRanking(sortedPackages)

    switch (sortBy) {
      case 'name':
        return sortedPackages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

      case 'name-desc':
        return sortedPackages.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()))

      case 'installed-recent':
        return sortedPackages.sort((a, b) => {
          return b.installs_recent - a.installs_recent // High to low
        })

      case 'installed':
        return sortedPackages.sort((a, b) => {
          return b.installs_total - a.installs_total // High to low
        })

      case 'stars':
        return sortedPackages.sort((a, b) => {
          return b.stars - a.stars // High to low
        })

      case 'stars-desc':
        return sortedPackages.sort((a, b) => {
          return a.stars - b.stars // Low to high
        })

      case 'newest':
        return sortedPackages.sort((a, b) => {
          return b.first_seen - a.first_seen // High to low
        })

      case 'oldest':
        return sortedPackages.sort((a, b) => {
          return a.first_seen - b.first_seen // Low to high
        })

      case 'update':
        return sortedPackages.sort((a, b) => {
          return b.last_modified - a.last_modified // High to low
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
  const getMetadataScore = pkg => pkg?.__magicRanking?.metadata ?? clamp01(toNumber(pkg?.magic_score))
  const getFinalScore = pkg => pkg?.__magicRanking?.final ?? getMetadataScore(pkg)

  return results.sort((a, b) => {
    const rankA = getFinalScore(a)
    const rankB = getFinalScore(b)
    if (rankA === rankB) {
      return (
        getMetadataScore(b) - getMetadataScore(a)
        || toNumber(b.installs_total) - toNumber(a.installs_total)
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

function annotateMagicRanking(results = []) {
  if (!Array.isArray(results) || results.length === 0) {
    return
  }

  const maxMiniScore = results.reduce((max, pkg) => Math.max(max, toNumber(pkg.score ?? 0)), 0)

  results.forEach((pkg) => {
    const metadataScore = clamp01(toNumber(pkg.magic_score))
    const miniScore = toNumber(pkg.score ?? 0)
    const normalizedMini = maxMiniScore > 0 ? clamp01(miniScore / maxMiniScore) : 0
    const factor = shiftedSCurve(normalizedMini, 3, -0.1)
    const finalScore = clamp01(metadataScore * factor)
    pkg.__magicRanking = {
      metadata: metadataScore,
      miniscore: miniScore,
      normalizedMini,
      factor,
      final: finalScore,
    }
  })
}
