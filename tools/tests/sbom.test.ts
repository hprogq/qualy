import { describe, expect, it } from 'vitest'
import { fetchSbom, type SbomClient } from '../lib/sbom.ts'

// The asynchronous export, against a scripted GitHub. What matters most is
// the last group: every way of not getting a report ends as `unavailable`,
// never as a document - an empty package list would read as a graph that
// lost everything, and a missing check as a graph that is fine.

const REPO = 'owner/repo'
const REPORT = 'https://api.github.com/repos/owner/repo/dependency-graph/sbom/fetch-report/u-1'
const BLOB = 'https://blob.example.net/report.json?sig=secret'

const spdx = (packages: { name: string; versionInfo?: string }[]) =>
  JSON.stringify({
    spdxVersion: 'SPDX-2.3',
    creationInfo: { created: '2026-10-15T10:00:00Z' },
    packages,
  })

type Answer = Response | Error

/** a GitHub that answers each url from its own queue, recording what it was asked */
const scripted = (answers: Record<string, Answer[]>) => {
  const asked: { url: string; init: RequestInit | undefined }[] = []
  let clock = 0
  const slept: number[] = []
  const client: SbomClient = {
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      asked.push({ url, init })
      const key = Object.keys(answers).find((prefix) => url.startsWith(prefix))
      const next = key === undefined ? undefined : answers[key]!.shift()
      if (next === undefined) throw new Error(`nothing scripted for ${url}`)
      if (next instanceof Error) throw next
      return next
    },
    sleep: async (ms) => {
      slept.push(ms)
      clock += ms
    },
    now: () => clock,
  }
  return { client, asked, slept }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const empty = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers })
const generated = () => json(201, { sbom_url: REPORT })
const ready = () => empty(302, { location: BLOB })
const GENERATE = 'https://api.github.com/repos/owner/repo/dependency-graph/sbom/generate-report'

describe('the asynchronous SBOM export', () => {
  it('waits while the report is built, then reads it from where it redirects', async () => {
    const { client, asked } = scripted({
      [GENERATE]: [generated()],
      [REPORT]: [empty(202), empty(201, { 'retry-after': '2' }), ready()],
      [BLOB]: [new Response(spdx([{ name: 'kysely', versionInfo: '0.29.6' }]))],
    })
    const outcome = await fetchSbom(REPO, 'token-123', client)
    expect(outcome).toEqual({
      kind: 'document',
      document: {
        created: '2026-10-15T10:00:00Z',
        packages: [{ name: 'kysely', versionInfo: '0.29.6' }],
      },
    })
    // the redirect is taken by hand, and the token never goes to the blob
    const polls = asked.filter((one) => one.url === REPORT)
    expect(polls.every((one) => one.init?.redirect === 'manual')).toBe(true)
    const download = asked.find((one) => one.url === BLOB)!
    expect(JSON.stringify(download.init ?? {})).not.toContain('token-123')
    const sent = asked[0]!.init?.headers as Record<string, string> | undefined
    expect(sent?.['x-github-api-version']).toBe('2026-03-10')
  })

  it('reads the synchronous shape too', async () => {
    const { client } = scripted({
      [GENERATE]: [generated()],
      [REPORT]: [ready()],
      [BLOB]: [new Response(JSON.stringify({ sbom: JSON.parse(spdx([{ name: 'pg' }])) }))],
    })
    const outcome = await fetchSbom(REPO, 't', client)
    expect(outcome.kind === 'document' && outcome.document.packages).toEqual([{ name: 'pg' }])
  })

  it('waits out a rate limit as asked', async () => {
    const { client, slept } = scripted({
      [GENERATE]: [
        empty(429, { 'retry-after': '7' }),
        empty(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '20' }),
        generated(),
      ],
      [REPORT]: [ready()],
      [BLOB]: [new Response(spdx([]))],
    })
    const outcome = await fetchSbom(REPO, 't', client)
    expect(outcome.kind).toBe('document')
    expect(slept).toEqual([7_000, 13_000])
  })
})

describe('a report that could not be had', () => {
  const cases: [string, Record<string, Answer[]>][] = [
    ['the job is unknown or expired', { [GENERATE]: [generated()], [REPORT]: [empty(404)] }],
    ['generation is refused', { [GENERATE]: [empty(404)] }],
    [
      'the server keeps failing',
      { [GENERATE]: [empty(502), empty(502), empty(502), empty(502), empty(502)] },
    ],
    [
      'the network keeps failing',
      {
        [GENERATE]: [
          new Error('reset'),
          new Error('reset'),
          new Error('reset'),
          new Error('reset'),
          new Error('reset'),
        ],
      },
    ],
    [
      'the download is refused',
      { [GENERATE]: [generated()], [REPORT]: [ready()], [BLOB]: [empty(403)] },
    ],
    [
      'the download is not a report',
      {
        [GENERATE]: [generated()],
        [REPORT]: [ready()],
        [BLOB]: [new Response('<Error>AuthenticationFailed</Error>')],
      },
    ],
    [
      'the report has no package list',
      {
        [GENERATE]: [generated()],
        [REPORT]: [ready()],
        [BLOB]: [new Response(JSON.stringify({ spdxVersion: 'SPDX-2.3' }))],
      },
    ],
    ['the redirect goes nowhere', { [GENERATE]: [generated()], [REPORT]: [empty(302)] }],
  ]
  for (const [name, answers] of cases) {
    it(`is unavailable, not empty, when ${name}`, async () => {
      const { client } = scripted(answers)
      const outcome = await fetchSbom(REPO, 't', client)
      expect(outcome.kind).toBe('unavailable')
    })
  }

  it('is unavailable when the report is never ready, within the deadline', async () => {
    const pending = Array.from({ length: 200 }, () => empty(202))
    const { client, slept } = scripted({ [GENERATE]: [generated()], [REPORT]: pending })
    const outcome = await fetchSbom(REPO, 't', client, 60_000)
    expect(outcome).toEqual({
      kind: 'unavailable',
      reason: 'the report was not ready within 60s',
    })
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(60_000)
  })
})
