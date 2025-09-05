import { execSync } from 'child_process'

// rename macos and remove */any
export function cleanPlatforms(platforms) {
  return platforms
    .filter(platform => platform !== '*')
    .map(platform => platform === 'osx' ? 'macos' : platform)
}

// author can be string or array, convert to all arrays
export function cleanAuthors(author) {
  if (typeof author === 'string') {
    return [author]
  }
  return author
}

export function getReadmeUrl(readme) {
  if (typeof readme_url !== 'string') {
    return null
  }

  // https://raw.githubusercontent.com/relikd/CUE-Sheet_sublime/main/README.md
  // => https://github.com/relikd/CUE-Sheet_sublime/blob/main/README.md
  //
  // https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/raw/master/README.md
  // => https://gitlab.com/patopest/sublime-text-cuelang-syntax/-/blob/master/README.md
  //
  // https://bitbucket.org/JeisonJHA/sublime-delphi-language/raw/master/README.md
  // => https://bitbucket.org/JeisonJHA/sublime-delphi-language/src/master/README.md

  return readme.replace( // GitHub raw to blob
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
    'https://github.com/$1/$2/blob/$3/$4',
  ).replace( // GitLab raw to blob
    /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
    'https://gitlab.com/$1/$2/-/blob/$3/$4',
  ).replace( // Bitbucket raw to src
    /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
    'https://bitbucket.org/$1/$2/src/$3/$4',
  )
}

export const gitHash = execSync('git rev-parse --short HEAD').toString().trim()
