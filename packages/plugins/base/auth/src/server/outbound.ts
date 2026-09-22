import { lookup as systemLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Effect } from 'effect'
import { Agent, request } from 'undici'
import {
  AuthOutbound,
  OutboundFailed,
  OutboundRefused,
  type OutboundRequest,
  type OutboundResponse,
} from '@qualy/auth-contract/outbound'

// What a login entrance's upstream may be, and the one way it is reached.
//
// The addresses are the whole of the question. A name is resolved once, every
// address it resolves to is checked, and the connection is then made to one
// of exactly those addresses - the TLS name and the Host header are still the
// name that was typed, but no second resolution happens behind the check. A
// check followed by an ordinary fetch would resolve again, and a name that
// answered with a public address the first time can answer with an internal
// one the second.
//
// Some addresses are never reachable, whatever a deployment says: the
// machine itself, link-local space (where every cloud keeps its metadata
// service), the unspecified address. Private networks are reachable only
// where the deployment named them - a school whose CAS lives on its own
// network - and the list is the deployment's, never a tenant's.

export interface OutboundPolicy {
  /** https only; development may reach plain http services of its own */
  readonly requireHttps: boolean
  /** a development machine's own services; never true in production */
  readonly allowLoopback: boolean
  /** hostnames and CIDR blocks on private networks the deployment chose to reach */
  readonly privateAllowlist: readonly string[]
  /** how a name becomes addresses; the system resolver unless a test says otherwise */
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>
}

export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 1024 * 1024

const blocks = (entries: readonly [string, number, 'ipv4' | 'ipv6'][]) => {
  const list = new BlockList()
  for (const [network, prefix, type] of entries) list.addSubnet(network, prefix, type)
  return list
}

const LOOPBACK = blocks([
  ['127.0.0.0', 8, 'ipv4'],
  ['::1', 128, 'ipv6'],
])
const UNSPECIFIED = blocks([
  ['0.0.0.0', 8, 'ipv4'],
  ['::', 128, 'ipv6'],
])
// the metadata services a cloud answers on, named before link-local and
// private space so an allowlisted range can never reach one
const METADATA = blocks([
  ['169.254.169.254', 32, 'ipv4'],
  ['100.100.100.200', 32, 'ipv4'],
  ['fd00:ec2::254', 128, 'ipv6'],
])
const LINK_LOCAL = blocks([
  ['169.254.0.0', 16, 'ipv4'],
  ['fe80::', 10, 'ipv6'],
])
const PRIVATE = blocks([
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['fc00::', 7, 'ipv6'],
])
const RESERVED = blocks([
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['ff00::', 8, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
])

/** `::ffff:10.0.0.1` is 10.0.0.1, and is judged as that */
const unmapped = (address: string): { address: string; type: 'ipv4' | 'ipv6' } => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return { address: mapped[1]!, type: 'ipv4' }
  return { address, type: isIP(address) === 6 ? 'ipv6' : 'ipv4' }
}

type AddressClass =
  | 'public'
  | 'loopback'
  | 'unspecified'
  | 'metadata'
  | 'link-local'
  | 'private'
  | 'reserved'

export const classifyAddress = (raw: string): AddressClass => {
  const { address, type } = unmapped(raw)
  if (LOOPBACK.check(address, type)) return 'loopback'
  if (UNSPECIFIED.check(address, type)) return 'unspecified'
  if (METADATA.check(address, type)) return 'metadata'
  if (LINK_LOCAL.check(address, type)) return 'link-local'
  if (PRIVATE.check(address, type)) return 'private'
  if (RESERVED.check(address, type)) return 'reserved'
  return 'public'
}

/** an allowlist entry: a hostname, an address, or an address block */
export const allowlistEntryValid = (entry: string) => {
  const [network, prefix] = entry.split('/')
  if (isIP(network ?? '') !== 0) {
    if (prefix === undefined) return true
    const bits = Number(prefix)
    return Number.isInteger(bits) && bits >= 0 && bits <= (isIP(network!) === 6 ? 128 : 32)
  }
  return prefix === undefined && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(entry)
}

const allowlist = (entries: readonly string[]) => {
  const hosts = new Set<string>()
  const ranges = new BlockList()
  for (const entry of entries) {
    const [network, prefix] = entry.split('/')
    const family = isIP(network ?? '')
    if (family === 0) {
      hosts.add(entry.toLowerCase())
      continue
    }
    const type = family === 6 ? 'ipv6' : 'ipv4'
    if (prefix === undefined) ranges.addAddress(network!, type)
    else ranges.addSubnet(network!, Number(prefix), type)
  }
  return (hostname: string, address: string) => {
    if (hosts.has(hostname.toLowerCase())) return true
    const judged = unmapped(address)
    return ranges.check(judged.address, judged.type)
  }
}

const systemResolve = async (hostname: string): Promise<readonly ResolvedAddress[]> =>
  (await systemLookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }))

class TooLarge extends Error {}

/**
 * The outbound port over one policy.
 *
 * Built per policy rather than per request so the allowlist is parsed once;
 * each request gets its own connection pool, pinned to what that request
 * resolved, and closes it when the answer has been read.
 */
export const makeOutbound = (policy: OutboundPolicy) => {
  const allowed = allowlist(policy.privateAllowlist)
  const resolve = policy.resolve ?? systemResolve

  const fetch = (input: OutboundRequest): Effect.Effect<OutboundResponse, OutboundRefused | OutboundFailed> =>
    Effect.gen(function* () {
      let url: URL
      try {
        url = new URL(input.url)
      } catch {
        return yield* new OutboundRefused({ reason: 'scheme' })
      }
      const secure = url.protocol === 'https:'
      if (!secure && !(url.protocol === 'http:' && !policy.requireHttps)) {
        return yield* new OutboundRefused({ reason: 'scheme' })
      }
      if (url.username !== '' || url.password !== '') {
        return yield* new OutboundRefused({ reason: 'credentials' })
      }
      if (url.hash !== '' || input.url.includes('#')) {
        return yield* new OutboundRefused({ reason: 'fragment' })
      }
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      const literal = isIP(hostname)
      const addresses: readonly ResolvedAddress[] =
        literal !== 0
          ? [{ address: hostname, family: literal === 6 ? 6 : 4 }]
          : yield* Effect.tryPromise({
              try: () => resolve(hostname),
              catch: () => new OutboundRefused({ reason: 'unresolvable' }),
            })
      if (addresses.length === 0) return yield* new OutboundRefused({ reason: 'unresolvable' })
      // every address a name answers with has to pass: a name that resolves
      // to one public and one internal address is not a public name
      for (const { address } of addresses) {
        const judged = classifyAddress(address)
        if (judged === 'public') continue
        if (judged === 'loopback' && policy.allowLoopback) continue
        if (judged === 'private' && allowed(hostname, address)) continue
        return yield* new OutboundRefused({ reason: judged })
      }

      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
      const body =
        input.body instanceof URLSearchParams ? input.body.toString() : (input.body ?? undefined)
      const headers: Record<string, string> = {
        ...(input.body instanceof URLSearchParams
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
        ...input.headers,
      }

      return yield* Effect.tryPromise({
        try: async (interrupted) => {
          // the lookup the connection makes answers with what was checked,
          // and only that; the name still goes to TLS as the server name
          const agent = new Agent({
            connect: {
              timeout: timeoutMs,
              lookup: (_hostname, options, callback) => {
                const all = (options as { all?: boolean }).all === true
                if (all) {
                  callback(
                    null,
                    addresses.map((entry) => ({ address: entry.address, family: entry.family })),
                  )
                } else {
                  const first = addresses[0]!
                  ;(callback as (error: null, address: string, family: number) => void)(
                    null,
                    first.address,
                    first.family,
                  )
                }
              },
            },
          })
          try {
            const signal = AbortSignal.any([interrupted, AbortSignal.timeout(timeoutMs)])
            const response = await request(url, {
              method: input.method ?? 'GET',
              headers,
              ...(body === undefined ? {} : { body }),
              dispatcher: agent,
              signal,
            })
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of response.body) {
              size += (chunk as Buffer).length
              if (size > maxBytes) {
                response.body.destroy()
                throw new TooLarge()
              }
              chunks.push(chunk as Buffer)
            }
            const flat: Record<string, string> = {}
            for (const [name, value] of Object.entries(response.headers)) {
              if (value === undefined) continue
              flat[name.toLowerCase()] = Array.isArray(value) ? value[value.length - 1]! : value
            }
            return {
              status: response.statusCode,
              headers: flat,
              body: new Uint8Array(Buffer.concat(chunks)),
            } satisfies OutboundResponse
          } finally {
            await agent.close().catch(() => undefined)
          }
        },
        catch: (error) => {
          if (error instanceof TooLarge) return new OutboundFailed({ reason: 'too-large' })
          const name = (error as { name?: string } | undefined)?.name
          if (name === 'TimeoutError' || name === 'AbortError') {
            return new OutboundFailed({ reason: 'timeout' })
          }
          const code = (error as { code?: string } | undefined)?.code
          if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
            return new OutboundFailed({ reason: 'timeout' })
          }
          return new OutboundFailed({ reason: 'network' })
        },
      })
    }).pipe(Effect.withSpan('auth.outbound', { kind: 'client' }))

  return AuthOutbound.of({ fetch })
}
