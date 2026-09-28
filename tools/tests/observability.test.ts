import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// What the observability configs are allowed to contain.
//
// The collector configs are the one layer where vendor credentials exist at
// all, and the whole arrangement rests on them existing only as environment
// references resolved at deploy time. A literal token committed once is a
// credential leak with a git history; an image tag that says `latest` is a
// config that validates today and means something else tomorrow.

const PRODUCTION = 'deploy/otel-collector.yaml'
const STAGING = 'ops/observability/collector.staging.yaml'
const LOCAL = 'ops/observability/collector.local.yaml'

describe('the collector configurations', () => {
  it('reference credentials through the environment, never by value', () => {
    for (const config of [PRODUCTION, STAGING]) {
      const offenders = fs
        .readFileSync(config, 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        // the lines that CARRY a value: attribute values, auth headers, and
        // basic-auth credentials. `- key: token` merely names the attribute;
        // the value line below it is the one that must resolve from the
        // environment
        .filter((line) => /(?:\bvalue|authorization|username|password)\s*:/i.test(line))
        .filter((line) => !/\$\{env:[A-Z0-9_]+/.test(line))
      expect(offenders, config).toEqual([])
    }
  })

  it('keeps the collector credential files out of git, and their examples empty', () => {
    for (const [file, example] of [
      ['ops/observability/collector.env', 'ops/observability/collector.env.example'],
      ['deploy/collector.env', 'deploy/collector.env.example'],
    ] as const) {
      expect(fs.readFileSync('.gitignore', 'utf8')).toContain(file)
      // the tracked example names the variables; every secret value is blank
      const secrets = fs
        .readFileSync(example, 'utf8')
        .split('\n')
        .filter((line) => /^[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=/.test(line))
      expect(secrets.length, example).toBeGreaterThan(0)
      for (const line of secrets) {
        expect(line, example).toMatch(/=$/)
      }
    }
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

  it('pins the observability images to exact versions, and the deployed one to a digest', () => {
    const imagesOf = (file: string) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/image: (\S+)/g)]
        .map((match) => match[1]!)
        .filter((image) => image.includes('otel') || image.includes('collector'))
    const development = imagesOf('docker-compose.yml')
    expect(development.length).toBeGreaterThan(0)
    for (const image of development) {
      expect(image).toMatch(/:\d+\.\d+\.\d+$/)
    }
    const deployed = imagesOf('deploy/compose.yaml')
    expect(deployed.length).toBe(1)
    expect(deployed[0]).toMatch(/:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/)
  })
})
