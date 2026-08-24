import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// What the observability configs are allowed to contain.
//
// The collector configs are the one layer where vendor credentials exist at
// all, and the whole arrangement rests on them existing only as environment
// references resolved at deploy time. A literal token committed once is a
// credential leak with a git history; an image tag that says `latest` is a
// config that validates today and means something else tomorrow.

const PRODUCTION = 'ops/observability/collector.production.yaml'
const LOCAL = 'ops/observability/collector.local.yaml'

describe('the collector configurations', () => {
  it('reference credentials through the environment, never by value', () => {
    const source = fs.readFileSync(PRODUCTION, 'utf8')
    const offenders = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      // the lines that CARRY a value: attribute values and auth headers.
      // `- key: token` merely names the attribute; the value line below it
      // is the one that must resolve from the environment
      .filter((line) => /(?:\bvalue|authorization)\s*:/i.test(line))
      .filter((line) => !/\$\{env:[A-Z0-9_]+\}/.test(line))
    expect(offenders).toEqual([])
  })

  it('keeps every tencent endpoint and credential out of the local config', () => {
    // prose may explain the production arrangement; configuration keys and
    // values may not reach for it
    const configuration = fs
      .readFileSync(LOCAL, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(configuration.toLowerCase()).not.toContain('tencent')
    expect(configuration).not.toContain('${env:')
  })

  it('pins the observability images to exact versions', () => {
    const compose = fs.readFileSync('docker-compose.yml', 'utf8')
    const images = [...compose.matchAll(/image: (\S+)/g)].map((match) => match[1]!)
    const observability = images.filter(
      (image) => image.includes('otel') || image.includes('collector'),
    )
    expect(observability.length).toBeGreaterThan(0)
    for (const image of observability) {
      expect(image).toMatch(/:\d+\.\d+\.\d+$/)
    }
  })
})
