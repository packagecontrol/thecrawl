import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSourceLocations,
  extractPackageName,
  parseGitHubSourceUrl,
  selectSources,
} from './build-source-map.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
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
