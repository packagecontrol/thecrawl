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
          return new Date(b.created_at) - new Date(a.created_at) // new to old
        })

      case 'oldest':
        return sortedPackages.sort((a, b) => {
          return new Date(a.created_at) - new Date(b.created_at) // old to new
        })

      case 'update':
        return sortedPackages.sort((a, b) => {
          return new Date(b.last_modified) - new Date(a.last_modified) // new to old
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
        return sortedPackages // Return as-is for relevance or default
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
