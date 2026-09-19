import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { assembledLayer, runBootHooks } from '@qualy/api-kit/assembled'
import { ShellPolicy, shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import {
  composeShellPolicy,
  INLINE_BOOT_SCRIPT_HASH,
  policyLayer,
  ShellPolicyHeader,
  ShellPolicyRefused,
} from '../src/server/shell-policy.ts'
import { MAX_TRACKED_KEYS, makeReportDeduper, parseReports } from '../src/server/csp-reports.ts'

// The policy as a string, and the two things that decide it: what the
// shell writes on its own, and what a plugin may add. Then the freeze - one
// composition at the barrier, nothing registered afterwards counts.

const FIXED = [
  "default-src 'self'",
  `script-src 'self' '${INLINE_BOOT_SCRIPT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'report-to csp',
  'report-uri /csp-reports',
].join('; ')

describe('composing the shell policy', () => {
  it('writes the fixed policy when nobody contributes', () => {
    expect(composeShellPolicy([])).toBe(FIXED)
  })

  it('adds contributed sources to their directive, once each, in first-seen order', () => {
    const composed = composeShellPolicy([
      {
        owner: '@qualy/plugin-storage-cos',
        'connect-src': ['https://files-123.cos.ap-beijing.myqcloud.com'],
      },
      {
        owner: 'other',
        'connect-src': ['wss://live.example:8443', 'https://files-123.cos.ap-beijing.myqcloud.com'],
        // already in the fixed line: not written twice
        'img-src': ['blob:', 'https://cdn.example'],
      },
    ])
    expect(composed).toContain(
      "connect-src 'self' https://files-123.cos.ap-beijing.myqcloud.com wss://live.example:8443;",
    )
    expect(composed).toContain("img-src 'self' data: blob: https://cdn.example;")
    // every other line is untouched
    expect(composed.replace(/connect-src [^;]+/, "connect-src 'self'")).toBe(
      FIXED.replace("img-src 'self' data: blob:", "img-src 'self' data: blob: https://cdn.example"),
    )
  })

  it('leaves the fixed lines to the shell', () => {
    for (const directive of [
      'script-src',
      'style-src',
      'base-uri',
      'object-src',
      'form-action',
      'frame-ancestors',
      'default-src',
      'sandbox',
    ]) {
      expect(() => composeShellPolicy([{ owner: 'x', [directive]: ["'self'"] } as never])).toThrow(
        ShellPolicyRefused,
      )
    }
  })

  it('refuses a source outside the grammar', () => {
    for (const source of [
      'http://plain.example',
      '*.example',
      "'unsafe-inline'",
      'https://host.example/path',
      "'none'",
      '',
      'https://',
      'HTTPS://Upper.example',
    ]) {
      expect(() => composeShellPolicy([{ owner: 'x', 'connect-src': [source] }])).toThrow(
        ShellPolicyRefused,
      )
    }
    for (const source of [
      'https://h',
      'https://a.b-c.example:8443',
      'ws://h:1',
      'wss://h',
      'data:',
      'blob:',
      "'self'",
    ]) {
      expect(() => composeShellPolicy([{ owner: 'x', 'font-src': [source] }])).not.toThrow()
    }
  })

  it('names the plugin that made a bad contribution', () => {
    expect(() =>
      composeShellPolicy([{ owner: '@qualy/plugin-x', 'worker-src': ['ftp://x'] }]),
    ).toThrow(/@qualy\/plugin-x contributes "ftp:\/\/x" to worker-src/)
  })
})

describe('freezing at the barrier', () => {
  const base = Layer.mergeAll(shellPolicyLayer, assembledLayer)
  const frozen = policyLayer.pipe(Layer.provideMerge(base))

  it('composes once when the boot hooks run, and later registrations do not count', async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* ShellPolicy
        const header = yield* ShellPolicyHeader
        yield* registry.register({ owner: 'a', 'connect-src': ['https://a.example'] })
        const early = Exit.isFailure(yield* Effect.exit(Effect.sync(() => header.value())))
        yield* runBootHooks
        const first = header.value()
        yield* registry.register({ owner: 'b', 'connect-src': ['https://b.example'] })
        return { early, first, later: header.value() }
      }).pipe(Effect.provide(frozen)),
    )
    expect(seen.early).toBe(true)
    expect(seen.first).toContain("connect-src 'self' https://a.example;")
    expect(seen.later).toBe(seen.first)
    expect(seen.later).not.toContain('b.example')
  })

  it('fails the boot, by hook name, on a contribution it refuses', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const registry = yield* ShellPolicy
        yield* registry.register({ owner: '@qualy/plugin-x', 'connect-src': ['http://x'] })
        yield* runBootHooks
      }).pipe(Effect.provide(frozen)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const text = Cause.pretty(exit.cause)
      expect(text).toContain('web/shell-policy')
      expect(text).toContain('@qualy/plugin-x')
    }
  })
})

describe('reading a report', () => {
  it('reads the report-uri body', () => {
    expect(
      parseReports(
        'application/csp-report',
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://qualy.example/',
            'violated-directive': 'script-src-elem',
            'effective-directive': 'script-src-elem',
            'blocked-uri': 'inline',
            'source-file': 'https://qualy.example/',
            'line-number': 12,
            disposition: 'report',
            'script-sample': 'never logged',
          },
        }),
      ),
    ).toEqual([
      {
        documentUri: 'https://qualy.example/',
        effectiveDirective: 'script-src-elem',
        blockedUri: 'inline',
        sourceFile: 'https://qualy.example/',
        lineNumber: 12,
        disposition: 'report',
      },
    ])
  })

  it('reads the reporting api body and skips other report types', () => {
    expect(
      parseReports(
        'application/reports+json',
        JSON.stringify([
          { type: 'deprecation', body: { id: 'x' } },
          {
            type: 'csp-violation',
            body: {
              documentURL: 'https://qualy.example/batches',
              effectiveDirective: 'connect-src',
              blockedURL: 'https://elsewhere.example/api',
              sourceFile: 'https://qualy.example/assets/index-abc.js',
              lineNumber: 1,
              disposition: 'enforce',
            },
          },
        ]),
      ),
    ).toEqual([
      {
        documentUri: 'https://qualy.example/batches',
        effectiveDirective: 'connect-src',
        blockedUri: 'https://elsewhere.example/api',
        sourceFile: 'https://qualy.example/assets/index-abc.js',
        lineNumber: 1,
        disposition: 'enforce',
      },
    ])
  })

  it('answers undefined to what it cannot read, and an empty list to nothing', () => {
    expect(parseReports('application/csp-report', 'not json')).toBeUndefined()
    expect(parseReports('application/csp-report', '{"other": 1}')).toBeUndefined()
    expect(parseReports('application/reports+json', '{"not": "a list"}')).toBeUndefined()
    expect(parseReports('application/reports+json', '[]')).toEqual([])
  })

  it('logs a key once a minute and carries the suppressed count forward', () => {
    const deduplicate = makeReportDeduper(60_000)
    expect(deduplicate('k', 0)).toEqual({ log: true, suppressed: 0 })
    expect(deduplicate('k', 1_000)).toEqual({ log: false, suppressed: 1 })
    expect(deduplicate('k', 59_999)).toEqual({ log: false, suppressed: 2 })
    expect(deduplicate('other', 2_000)).toEqual({ log: true, suppressed: 0 })
    expect(deduplicate('k', 60_000)).toEqual({ log: true, suppressed: 2 })
    expect(deduplicate('k', 60_001)).toEqual({ log: false, suppressed: 1 })
  })

  it('holds a bounded number of keys however many distinct ones arrive', () => {
    // The key is three fields off an unauthenticated body, so the window
    // bounds nothing on its own: inside one window there is never anything
    // old enough to expire, and the table grew with whatever was posted.
    const deduplicate = makeReportDeduper(60_000)
    for (let i = 0; i < MAX_TRACKED_KEYS * 3; i++) deduplicate(`key-${i}`, 1_000)
    // the oldest keys went, so the first one is logged as new again
    expect(deduplicate('key-0', 1_000)).toEqual({ log: true, suppressed: 0 })
    // while one still inside the table is remembered
    const recent = `key-${MAX_TRACKED_KEYS * 3 - 1}`
    expect(deduplicate(recent, 1_000)).toEqual({ log: false, suppressed: 1 })
  })

  it('reads a bounded number of reports out of one body', () => {
    const many = Array.from({ length: 200 }, () => ({
      type: 'csp-violation',
      body: { effectiveDirective: 'script-src', blockedURL: 'https://evil.test/x' },
    }))
    const read = parseReports('application/reports+json', JSON.stringify(many))
    expect(read).toHaveLength(32)
  })
})
