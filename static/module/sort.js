export class Sort {
  static sort(packages, sortBy) {
    const sortedPackages = [...packages]; // Create a copy to avoid mutating original

    switch (sortBy) {
      case 'name':
        return sortedPackages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

      case 'name-desc':
        return sortedPackages.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()));

      case 'stars':
        return sortedPackages.sort((a, b) => {
          const starsA = parseInt(a.stars) || 0;
          const starsB = parseInt(b.stars) || 0;
          return starsB - starsA; // High to low
        });

      case 'stars-desc':
        return sortedPackages.sort((a, b) => {
          const starsA = parseInt(a.stars) || 0;
          const starsB = parseInt(b.stars) || 0;
          return starsA - starsB; // Low to high
        });

      case 'author':
        return sortedPackages.sort((a, b) => a.author.toLowerCase().localeCompare(b.author.toLowerCase()));

      case 'author-desc':
        return sortedPackages.sort((a, b) => b.author.toLowerCase().localeCompare(a.author.toLowerCase()));

      case 'relevance':
      default:
        return sortedPackages; // Return as-is for relevance or default
    }
  }
}
