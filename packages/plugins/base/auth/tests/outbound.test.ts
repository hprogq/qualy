import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  OutboundFailed,
  OutboundRefused,
  OutboundRequest,
  OutboundResponse,
} from '@qualy/auth-contract/outbound'
import {
  allowlistEntryValid,
  classifyAddress,
  makeOutbound,
  type OutboundPolicy,
  type ResolvedAddress,
} from '../src/server/outbound.ts'

// Where a login entrance's upstream may be, and that the answer checked is
// the address connected to.
//
// The server here listens on loopback and is reached by a name no resolver
// knows: a request that arrives proves the connection went to the address
// the policy handed over, not to whatever a second lookup would have said.

let server: Server
let port: number
const seen: { host: string | undefined; url: string | undefined; body: string }[] = []

const answer = (request: IncomingMessage, response: ServerResponse, body: string) => {
  seen.push({ host: request.headers.host, url: request.url, body })
  if (request.url === '/moved') {
    response.writeHead(302, { location: 'http://idp.test/elsewhere' })
    response.end()
    return
  }
  if (request.url === '/large') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('x'.repeat(4096))
    return
  }
  if (request.url === '/silent') return
  response.writeHead(200, { 'content-type': 'text/plain', 'x-echo': request.method ?? '' })
  response.end(`ok ${request.headers['content-type'] ?? ''}`)
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => answer(request, response, body))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

const development: OutboundPolicy = {
  requireHttps: false,
  allowLoopback: true,
  privateAllowlist: [],
}

/** a resolver that answers from a list, one answer per call, and counts */
const scripted = (...answers: (readonly ResolvedAddress[])[]) => {
  const calls: string[] = []
  const resolve = (hostname: string) => {
    calls.push(hostname)
    return Promise.resolve(answers[Math.min(calls.length - 1, answers.length - 1)]!)
  }
  return { calls, resolve }
}

const loopback: readonly ResolvedAddress[] = [{ address: '127.0.0.1', family: 4 }]

const fetchWith = (policy: OutboundPolicy, request: OutboundRequest) =>
  Effect.runPromiseExit(makeOutbound(policy).fetch(request))

/** the answer of a request that was expected to come back */
const answered = (exit: Exit.Exit<OutboundResponse, OutboundRefused | OutboundFailed>) => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected an answer, got ${String(exit.cause)}`)
}

const failureOf = (exit: Exit.Exit<unknown, { _tag: string; reason: string }>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === 'Fail'
    ? { tag: exit.cause.reasons[0].error._tag, reason: exit.cause.reasons[0].error.reason }
    : undefined

describe('what an address is', () => {
  it('is judged by where it points, mapped addresses included', () => {
    expect(classifyAddress('93.184.216.34')).toBe('public')
    expect(classifyAddress('2606:4700::1111')).toBe('public')
    expect(classifyAddress('127.0.0.1')).toBe('loopback')
    expect(classifyAddress('127.9.9.9')).toBe('loopback')
    expect(classifyAddress('::1')).toBe('loopback')
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback')
    expect(classifyAddress('0.0.0.0')).toBe('unspecified')
    expect(classifyAddress('::')).toBe('unspecified')
    expect(classifyAddress('169.254.169.254')).toBe('metadata')
    expect(classifyAddress('100.100.100.200')).toBe('metadata')
    expect(classifyAddress('fd00:ec2::254')).toBe('metadata')
    expect(classifyAddress('169.254.1.1')).toBe('link-local')
    expect(classifyAddress('fe80::1')).toBe('link-local')
    expect(classifyAddress('10.1.2.3')).toBe('private')
    expect(classifyAddress('::ffff:10.1.2.3')).toBe('private')
    expect(classifyAddress('172.16.0.1')).toBe('private')
    expect(classifyAddress('192.168.1.1')).toBe('private')
    expect(classifyAddress('100.64.0.1')).toBe('private')
    expect(classifyAddress('fd12::1')).toBe('private')
    expect(classifyAddress('224.0.0.1')).toBe('reserved')
    expect(classifyAddress('192.0.2.10')).toBe('reserved')
  })

  it('is allowlisted only as a hostname, an address or a block', () => {
    for (const good of ['cas.school.edu', 'cas', '10.0.0.0/8', '10.1.2.3', 'fd00::/8']) {
      expect(allowlistEntryValid(good), good).toBe(true)
    }
    for (const bad of ['10.0.0.0/33', 'https://cas.school.edu', 'cas.school.edu/24', '-cas', '']) {
      expect(allowlistEntryValid(bad), bad).toBe(false)
    }
  })
})

describe('what an entrance may reach', () => {
  const production: OutboundPolicy = {
    requireHttps: true,
    allowLoopback: false,
    privateAllowlist: ['10.20.0.0/16', 'cas.intra.school.edu', '169.254.0.0/16'],
  }

  it('refuses what a production deployment never reaches', async () => {
    const cases: [string, readonly ResolvedAddress[], string][] = [
      ['http://cas.school.edu/', [{ address: '93.184.216.34', family: 4 }], 'scheme'],
      ['ftp://cas.school.edu/', [{ address: '93.184.216.34', family: 4 }], 'scheme'],
      ['https://user:pw@cas.school.edu/', [{ address: '93.184.216.34', family: 4 }], 'credentials'],
      ['https://cas.school.edu/#x', [{ address: '93.184.216.34', family: 4 }], 'fragment'],
      ['https://cas.school.edu/', loopback, 'loopback'],
      ['https://127.0.0.1/', [], 'loopback'],
      ['https://[::1]/', [], 'loopback'],
      ['https://0.0.0.0/', [], 'unspecified'],
      // allowlisted as a block, and still never: a metadata service is not
      // somewhere any upstream lives
      ['https://169.254.169.254/latest/meta-data', [], 'metadata'],
      ['https://cas.school.edu/', [{ address: '169.254.7.7', family: 4 }], 'link-local'],
      ['https://cas.school.edu/', [{ address: '10.9.0.1', family: 4 }], 'private'],
      // one internal answer among public ones makes the name internal
      [
        'https://cas.school.edu/',
        [
          { address: '93.184.216.34', family: 4 },
          { address: '192.168.0.10', family: 4 },
        ],
        'private',
      ],
      ['https://cas.school.edu/', [], 'unresolvable'],
    ]
    for (const [url, addresses, reason] of cases) {
      const exit = await fetchWith(
        { ...production, resolve: () => Promise.resolve(addresses) },
        { url, timeoutMs: 200 },
      )
      expect(failureOf(exit), url).toEqual({ tag: 'OutboundRefused', reason })
    }
  })

  it('reaches a private network only where the deployment named it', async () => {
    // named by block, and by hostname: neither is refused by the policy -
    // what happens on the wire is the network's business
    for (const [url, address] of [
      ['https://cas.school.edu/', '10.20.0.1'],
      ['https://cas.intra.school.edu/', '10.99.0.1'],
    ] as const) {
      const exit = await fetchWith(
        { ...production, resolve: () => Promise.resolve([{ address, family: 4 as const }]) },
        { url, timeoutMs: 100 },
      )
      expect(failureOf(exit)?.tag, url).not.toBe('OutboundRefused')
    }
  })
})

describe('the connection an entrance makes', () => {
  it('goes to the address that was checked, under the name that was asked for', async () => {
    const resolver = scripted(loopback, [{ address: '169.254.169.254', family: 4 }])
    const exit = await fetchWith(
      { ...development, resolve: resolver.resolve },
      { url: `http://idp.test:${port}/hello` },
    )
    const response = answered(exit)
    expect(response.status).toBe(200)
    // resolved once, and the second answer - the one a rebinding name gives
    // after the check - was never asked for
    expect(resolver.calls).toEqual(['idp.test'])
    expect(seen.at(-1)?.host).toBe(`idp.test:${port}`)
  })

  it('does not follow a redirect', async () => {
    const exit = await fetchWith(
      { ...development, resolve: scripted(loopback).resolve },
      { url: `http://idp.test:${port}/moved` },
    )
    const response = answered(exit)
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('http://idp.test/elsewhere')
    expect(seen.at(-1)?.url).toBe('/moved')
  })

  it('posts a form as a form', async () => {
    const exit = await fetchWith(
      { ...development, resolve: scripted(loopback).resolve },
      {
        url: `http://idp.test:${port}/token`,
        method: 'POST',
        body: new URLSearchParams({ code: 'c', grant_type: 'authorization_code' }),
      },
    )
    const response = answered(exit)
    expect(new TextDecoder().decode(response.body)).toBe('ok application/x-www-form-urlencoded')
    expect(seen.at(-1)?.body).toBe('code=c&grant_type=authorization_code')
  })

  it('stops reading an answer past its size, and waiting past its time', async () => {
    const large = await fetchWith(
      { ...development, resolve: scripted(loopback).resolve },
      { url: `http://idp.test:${port}/large`, maxBytes: 1024 },
    )
    expect(failureOf(large)).toEqual({ tag: 'OutboundFailed', reason: 'too-large' })
    const silent = await fetchWith(
      { ...development, resolve: scripted(loopback).resolve },
      { url: `http://idp.test:${port}/silent`, timeoutMs: 200 },
    )
    expect(failureOf(silent)).toEqual({ tag: 'OutboundFailed', reason: 'timeout' })
  })
})

describe('the port as a Fetch API function', () => {
  it('answers a standards client the way the Effect side does, and refuses what it refuses', async () => {
    const outbound = makeOutbound({ ...development, resolve: scripted(loopback).resolve })
    const response = await outbound.asFetch(`http://idp.test:${port}/token`, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok application/x-www-form-urlencoded')

    const moved = await outbound.asFetch(`http://idp.test:${port}/moved`)
    expect(moved.status).toBe(302)

    const production = makeOutbound({
      requireHttps: true,
      allowLoopback: false,
      privateAllowlist: [],
      resolve: () => Promise.resolve([{ address: '10.0.0.8', family: 4 }]),
    })
    await expect(production.asFetch('https://idp.internal/.well-known/openid-configuration')).rejects.toMatchObject({
      _tag: 'OutboundRefused',
      reason: 'private',
    })
  })
})
