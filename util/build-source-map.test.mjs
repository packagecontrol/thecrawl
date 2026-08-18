import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSourceLocations,
  cloneSources,
  extractPackageName,
  parseGitHubSourceUrl,
  selectSources,
} from './build-source-map.mjs'

const temporaryDirectories = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('cloneSources', () => {
  it('reports starts and failures and returns successful checkouts', async () => {
    const successfulSource = {
      owner: 'example',
      repository: 'available',
      ref: 'main',
    }
    const failedSource = {
      owner: 'example',
      repository: 'deleted',
      ref: 'main',
    }
    const clone = vi.fn(async (source) => {
      if (source === failedSource) throw new Error('repository not found')
      return '/checkouts/available'
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const checkouts = await cloneSources(
      [successfulSource, failedSource],
      '/checkouts',
      clone,
    )

    expect(checkouts).toEqual([{
      source: successfulSource,
      checkoutPath: '/checkouts/available',
    }])
    expect(log).toHaveBeenCalledWith('Cloning example/available@main')
    expect(log).toHaveBeenCalledWith('Cloning example/deleted@main')
    expect(error).toHaveBeenCalledWith(
      'Cloning example/deleted@main -- erred.\nrepository not found',
    )
  })
})

describe('selectSources', () => {
  it('selects GitHub sources with more packages than the threshold', () => {
    const source = 'https://raw.githubusercontent.com/example/channel/main/repository.json'
    const workspace = {
      packages: Object.fromEntries([
        ...Array.from({ length: 6 }, (_, index) => [
          `Package ${index}`,
          { name: `Package ${index}`, source },
        ]),
        ['Removed', { name: 'Removed', source, removed: '2026-01-01' }],
        ['Other', {
          name: 'Other',
          source: 'https://raw.githubusercontent.com/example/other/main/repository.json',
        }],
      ]),
    }

    const selected = selectSources(workspace, 5)

    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({
      url: source,
      owner: 'example',
      repository: 'channel',
      ref: 'main',
      filePath: 'repository.json',
    })
    expect(selected[0].packageNames.size).toBe(6)
  })
})

describe('buildSourceLocations', () => {
  it('indexes packages in the root file and its direct includes', () => {
    const checkoutPath = makeCheckout({
      'repository.json': `{
  "packages": [
    { "name": "Root Package", "details": "https://github.com/example/root" }
  ],
  "includes": ["./included.json"]
}\n`,
      'included.json': `{
  "packages": [
    {
      "details": "https://github.com/example/Derived-Package"
    }
  ]
}\n`,
    })
    const source = {
      url: 'https://raw.githubusercontent.com/example/channel/main/repository.json',
      owner: 'example',
      repository: 'channel',
      ref: 'main',
      filePath: 'repository.json',
      packageNames: new Set(['Root Package', 'Derived-Package']),
    }

    expect(buildSourceLocations(source, checkoutPath)).toEqual({
      'Derived-Package': {
        url: 'https://raw.githubusercontent.com/example/channel/main/included.json',
        line: 4,
      },
      'Root Package': {
        url: 'https://raw.githubusercontent.com/example/channel/main/repository.json',
        line: 3,
      },
    })
  })
})

describe('parseGitHubSourceUrl', () => {
  it('parses refs/heads source URLs', () => {
    expect(parseGitHubSourceUrl(
      'https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json',
    )).toEqual({
      owner: 'sublimehq',
      repository: 'package_control_channel',
      ref: 'master',
      filePath: 'repository.json',
      cloneUrl: 'https://github.com/sublimehq/package_control_channel.git',
    })
  })
})

describe('extractPackageName', () => {
  it('prefers an explicit package name', () => {
    expect(extractPackageName({
      name: 'Explicit',
      details: 'https://github.com/example/Derived',
    })).toBe('Explicit')
  })

  it('derives omitted names from the details repository', () => {
    expect(extractPackageName({
      details: 'https://github.com/example/Derived/tree/main',
    })).toBe('Derived')
  })
})

function makeCheckout(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-map-test-'))
  temporaryDirectories.push(directory)

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }

  return directory
}
