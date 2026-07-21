#!/usr/bin/env node
/* global process */
import fs from 'fs'
import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'
import { marked } from 'marked'
import { configureMarked, renderReadme } from './static/readme-renderer.mjs'
import { createHash } from 'crypto'

const args = parseArgs(process.argv.slice(2))
const rawReadmes = readJson(args.input)
const dom = new JSDOM('')
const DOMPurify = createDOMPurify(dom.window)
const parser = new dom.window.DOMParser()

const oldRenderedReadmes = readJson(args.output)
const renderedReadmes = {}

configureMarked(marked)

for (const [url, text] of Object.entries(rawReadmes)) {
  const hash = createHash('sha256').update(text).digest('base64')
  if (oldRenderedReadmes[url] && oldRenderedReadmes[url][0] === hash) {
    renderedReadmes[url] = [hash, oldRenderedReadmes[url][1]]
    continue
  }

  const html = renderReadme(marked, text, url, {
    sanitize: html => DOMPurify.sanitize(html),
    parseHtml: html => parser.parseFromString(html, 'text/html'),
  })
  renderedReadmes[url] = [hash, html]
}

fs.writeFileSync(args.output, JSON.stringify(renderedReadmes, null, 2) + '\n')
console.log(`Rendered ${Object.keys(renderedReadmes).length} README files to ${args.output}`)

dom.window.close()

function parseArgs(argv) {
  let input = 'readmes.json'
  let output = 'readmes_rendered.json'

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-i' || arg === '--input') {
      input = argv[++i]
    } else if (arg === '-o' || arg === '--output') {
      output = argv[++i]
    } else if (arg === '-h' || arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { input, output }
}

function printHelp() {
  console.log('Usage: node render_readmes.mjs -i readmes.json -o readmes_rendered.json')
}

function readJson(path) {
  if (!fs.existsSync(path)) {
    return {}
  }

  return JSON.parse(fs.readFileSync(path, 'utf8'))
}
