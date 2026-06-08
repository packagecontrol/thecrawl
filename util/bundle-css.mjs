import fs from 'fs'
import path from 'path'

export function bundleCss(entryPath) {
  const resolvedEntryPath = path.resolve(entryPath)
  const outputDir = path.dirname(resolvedEntryPath)
  const seenImports = new Set()
  const bundled = bundleCssFile(resolvedEntryPath, outputDir, seenImports)

  fs.writeFileSync(resolvedEntryPath, bundled)
}

function bundleCssFile(filePath, outputDir, seenImports) {
  const css = fs.readFileSync(filePath, 'utf8')
  const fileDir = path.dirname(filePath)
  const importPattern = /^\s*@import\s+url\((['"]?)([^'")]+)\1\)\s*;\s*$/gm
  let bundled = ''
  let previousIndex = 0
  let match

  while ((match = importPattern.exec(css)) !== null) {
    const [statement, , importUrl] = match
    const beforeImport = css.slice(previousIndex, match.index)
    bundled += rebaseUrls(beforeImport, fileDir, outputDir)

    const importPath = resolveImportPath(importUrl, fileDir)
    if (!importPath) {
      bundled += statement
    } else if (!seenImports.has(importPath)) {
      seenImports.add(importPath)
      bundled += `\n/* ${posixPath(path.relative(outputDir, importPath))} */\n`
      bundled += bundleCssFile(importPath, outputDir, seenImports)
      bundled += '\n'
    }

    previousIndex = match.index + statement.length
  }

  bundled += rebaseUrls(css.slice(previousIndex), fileDir, outputDir)
  return bundled
}

function resolveImportPath(importUrl, fileDir) {
  if (isExternalUrl(importUrl) || path.isAbsolute(importUrl)) {
    return null
  }

  return path.resolve(fileDir, importUrl)
}

function rebaseUrls(css, fromDir, outputDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
    if (isExternalUrl(url) || path.isAbsolute(url) || url.startsWith('#')) {
      return match
    }

    const { pathname, suffix } = splitUrlSuffix(url)
    if (!pathname) {
      return match
    }

    const sourcePath = path.resolve(fromDir, pathname)
    const rebasedPath = posixPath(path.relative(outputDir, sourcePath))
    const normalizedPath = rebasedPath.startsWith('.') ? rebasedPath : `./${rebasedPath}`

    return `url(${quote}${normalizedPath}${suffix}${quote})`
  })
}

function splitUrlSuffix(url) {
  const match = /^(.*?)([?#].*)?$/.exec(url)
  return {
    pathname: match?.[1] ?? url,
    suffix: match?.[2] ?? '',
  }
}

function isExternalUrl(url) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)
}

function posixPath(filePath) {
  return filePath.split(path.sep).join('/')
}
