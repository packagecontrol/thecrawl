const STORAGE_PREFIX = 'thecrawl.artifact-count.'
const countElements = new Map(
  [...document.querySelectorAll('[data-artifact-count]')]
    .map(element => [element.dataset.artifactCount, element]),
)
const countStates = new WeakMap()

window.animateArtifactCounts = animateArtifactCounts
initArtifactCounts()

/**
 * Roll the homepage counts to new values from the browser console.
 *
 *     animateArtifactCounts(5000, 5900)
 *     animateArtifactCounts({ channel: 5000, registry: 5900 })
 */
function animateArtifactCounts(channelOrCounts, registry) {
  const counts = Object.entries(requestedCounts(channelOrCounts, registry))
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => [name, validCount(value)])

  for (const [name, value] of counts) {
    if (value === null) {
      throw new TypeError(`${name} count must be a non-negative integer`)
    }
  }

  return Promise.all(counts.map(([name, value]) => {
    const element = countElements.get(name)
    return element ? animateArtifactCount(element, value) : undefined
  }))
}

function initArtifactCounts() {
  const reduceMotion = prefersReducedMotion()

  for (const [name, element] of countElements) {
    const current = validCount(element.dataset.artifactCountValue)
    if (current === null) continue

    const seen = readSeenCount(name)
    writeSeenCount(name, current)
    if (reduceMotion) {
      countStates.set(element, { value: current, revision: 0 })
      continue
    }

    const start = seen ?? current
    countStates.set(element, { value: start, revision: 0 })
    renderCount(element, start)

    if (seen !== null && seen !== current) {
      animateArtifactCount(element, current, false)
    }
  }
}

async function animateArtifactCount(element, target, persist = true) {
  const name = element.dataset.artifactCount
  const state = countStates.get(element) ?? {
    value: validCount(element.dataset.artifactCountValue) ?? target,
    revision: 0,
  }
  const start = state.value
  const revision = state.revision + 1

  countStates.set(element, { value: target, revision })
  element.dataset.artifactCountValue = String(target)
  if (persist) writeSeenCount(name, target)

  if (start === target) {
    finishCountAnimation(element, target, revision)
    return
  }

  const { visual, reels } = rollingCount(start, target)
  element.classList.add('is-rolling')
  element.replaceChildren(visual, accessibleCount(target))

  if (!reels.length || typeof reels[0].track.animate !== 'function') {
    finishCountAnimation(element, target, revision)
    return
  }

  const direction = target > start ? 1 : -1
  const animations = reels.map(({ track, steps, place }) => {
    const offset = `${steps * -1}em`
    const keyframes = direction > 0
      ? [{ transform: 'translateY(0)' }, { transform: `translateY(${offset})` }]
      : [{ transform: `translateY(${offset})` }, { transform: 'translateY(0)' }]
    return track.animate(keyframes, {
      duration: 360 + (steps * 45),
      delay: place * 32,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    }).finished.catch(() => {})
  })

  await Promise.all(animations)
  if (String(target).length < String(start).length) {
    finishCountAnimation(element, target, revision)
  }
  else {
    settleCountAnimation(element, revision)
  }
}

function settleCountAnimation(element, revision) {
  if (countStates.get(element)?.revision !== revision) return
  element.classList.remove('is-rolling')
}

function finishCountAnimation(element, target, revision) {
  if (countStates.get(element)?.revision !== revision) return
  renderCount(element, target)
  element.classList.remove('is-rolling')
}

function rollingCount(start, target) {
  const direction = target > start ? 1 : -1
  const width = Math.max(String(start).length, String(target).length)
  const from = String(start).padStart(width, ' ')
  const to = String(target).padStart(width, ' ')
  const visual = document.createElement('span')
  const reels = []

  visual.className = 'artifact-count-visual'
  visual.setAttribute('aria-hidden', 'true')

  for (let index = 0; index < width; index += 1) {
    if (from[index] === to[index]) {
      visual.appendChild(staticDigit(to[index]))
      continue
    }

    const sequence = isDigit(from[index]) && isDigit(to[index])
      ? digitSequence(Number(from[index]), Number(to[index]), direction)
      : [from[index], to[index]]
    const windowElement = document.createElement('span')
    const track = document.createElement('span')
    const displayedSequence = direction > 0 ? sequence : [...sequence].reverse()

    windowElement.className = 'artifact-count-digit-window'
    track.className = 'artifact-count-digit-track'
    for (const digit of displayedSequence) {
      track.appendChild(staticDigit(String(digit)))
    }
    windowElement.appendChild(track)
    visual.appendChild(windowElement)
    reels.push({
      track,
      steps: sequence.length - 1,
      place: width - index - 1,
    })
  }

  return { visual, reels }
}

function renderCount(element, value) {
  const visual = document.createElement('span')
  visual.className = 'artifact-count-visual'
  visual.setAttribute('aria-hidden', 'true')
  for (const digit of String(value)) visual.appendChild(staticDigit(digit))

  element.replaceChildren(visual, accessibleCount(value))
}

function accessibleCount(value) {
  const element = document.createElement('span')
  element.className = 'screenreader-only'
  element.textContent = String(value)
  return element
}

function staticDigit(digit) {
  const element = document.createElement('span')
  element.className = 'artifact-count-digit'
  element.textContent = digit
  return element
}

function digitSequence(start, target, direction) {
  const digits = [start]
  while (digits.at(-1) !== target) {
    digits.push((digits.at(-1) + direction + 10) % 10)
  }
  return digits
}

function isDigit(value) {
  return value >= '0' && value <= '9'
}

function requestedCounts(channelOrCounts, registry) {
  if (channelOrCounts !== null && typeof channelOrCounts === 'object') {
    return {
      channel: channelOrCounts.channel ?? channelOrCounts.channelEntries,
      registry: channelOrCounts.registry ?? channelOrCounts.registryEntries,
    }
  }
  return { channel: channelOrCounts, registry }
}

function validCount(value) {
  if (value === '' || value === null || value === undefined) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

function readSeenCount(name) {
  try {
    return validCount(localStorage.getItem(`${STORAGE_PREFIX}${name}`))
  }
  catch {
    return null
  }
}

function writeSeenCount(name, value) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${name}`, String(value))
  }
  catch {
    // The counter still works when storage is disabled.
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
