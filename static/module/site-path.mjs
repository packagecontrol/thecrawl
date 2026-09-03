export function sitePath(path, pathPrefix = configuredSitePathPrefix()) {
  const value = String(path ?? '')
  const prefix = normalizeSitePathPrefix(pathPrefix)
  if (!prefix || !value.startsWith('/') || value.startsWith('//')) {
    return value
  }
  if (value === prefix || value.startsWith(prefix + '/')) {
    return value
  }
  return prefix + value
}

export function siteRelativePath(path, pathPrefix = configuredSitePathPrefix()) {
  const value = String(path ?? '')
  const prefix = normalizeSitePathPrefix(pathPrefix)
  if (!prefix) {
    return value
  }
  if (value === prefix) {
    return '/'
  }
  if (value.startsWith(prefix + '/')) {
    return value.slice(prefix.length)
  }
  return value
}

function configuredSitePathPrefix() {
  return typeof window === 'undefined' ? '' : window.SITE_PATH_PREFIX
}

export function normalizeSitePathPrefix(value) {
  const pathPrefix = String(value || '').trim()
  if (!pathPrefix || pathPrefix === '/') {
    return ''
  }
  return '/' + pathPrefix.replace(/^\/+|\/+$/g, '')
}
