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
          const A = parseInt(a.created_at) || 0
          const B = parseInt(b.created_at) || 0
          return B - A // High to low
        })

      case 'oldest':
        return sortedPackages.sort((a, b) => {
          const A = parseInt(a.created_at) || 0
          const B = parseInt(b.created_at) || 0
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

      case 'relevance':
      default:
        return sortedPackages // Return as-is for relevance or default
    }
  }
}
