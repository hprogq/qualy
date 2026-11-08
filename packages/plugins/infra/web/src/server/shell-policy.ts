import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import {
  SHELL_POLICY_DIRECTIVES,
  ShellPolicy,
  type ShellPolicyDirective,
  type ShellPolicyEntry,
} from '@qualy/api-kit/shell-policy'

// The shell's content security policy: the fixed part this plugin owns, the
// part other plugins contribute, and the one moment the two are joined.
//
// Why each line is what it is lives in docs/notes/auth-security.md; the
// short form:
//
// - script-src carries no 'unsafe-inline', and never will from a plugin: a
//   selected plugin may add only a named https origin its code must load
//   from (a CAPTCHA vendor that serves its widget from its own host), never
//   a keyword, nonce, hash or scheme. A document's own inline scripts -
//   the theme resolver that must run before the first paint, and what the
//   server streams into the document as it draws - run by a nonce made for
//   that one document (`scriptNonce`).
// - style-src keeps 'unsafe-inline' and NO hash: the editor injects
//   <style> elements at run time, and a hash or nonce anywhere in
//   style-src makes a browser ignore 'unsafe-inline' (CSP3), which would
//   block the editor's own styles.
// - frame-src allows blob: as well as 'self': the document viewer fetches
//   an attachment's bytes through the api and frames a blob it typed
//   itself, which is a blob: url, not a same-origin one.
// - frame-ancestors is ignored by a browser in report-only mode; the
//   X-Frame-Options header set beside this one covers framing until the
//   policy is enforced.

/** the report endpoint, in the shell's own namespace outside the api mount */
export const REPORT_PATH = '/csp-reports'
export const REPORTING_ENDPOINT = 'csp'

/** the header name for each mode */
export const CSP_HEADER = {
  report: 'Content-Security-Policy-Report-Only',
  enforce: 'Content-Security-Policy',
} as const

export type CspMode = keyof typeof CSP_HEADER

type Line = readonly [directive: string, sources: readonly string[]]

/**
 * The directives in the order they are written, with the sources this
 * plugin puts there. The contributable ones start from these and grow; the
 * others are written as they are.
 */
const FIXED: readonly Line[] = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'blob:']],
  ['font-src', ["'self'"]],
  ['connect-src', ["'self'"]],
  ['frame-src', ["'self'", 'blob:']],
  ['worker-src', ["'self'"]],
  ['media-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
]

/** directives a contribution may name; a lookup rather than `includes` on a tuple */
const contributable: ReadonlySet<string> = new Set(SHELL_POLICY_DIRECTIVES)

/**
 * A fetch source a plugin may state: a keyword, a scheme, or one https or
 * websocket host with an optional port. No wildcards, no paths, no plain
 * http - a policy that named those would be looser than the fixed part it
 * joins.
 */
const FETCH_SOURCE =
  /^(?:'self'|data:|blob:|(?:https|wss?):\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?)$/

/**
 * A script source a plugin may state: one https host with an optional port,
 * and nothing else. Kept apart from the fetch grammar on purpose - widening
 * that one must never widen what may run. Every keyword ('self',
 * 'unsafe-inline', 'unsafe-eval', 'strict-dynamic'), every nonce and hash,
 * data: and blob: stay the shell's to write or not.
 */
const SCRIPT_SOURCE = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/

const fetchSourceAccepted = (source: string) => FETCH_SOURCE.test(source)
const scriptSourceAccepted = (source: string) => SCRIPT_SOURCE.test(source)

export class ShellPolicyRefused extends Error {
  readonly _tag = 'ShellPolicyRefused'
}

/**
 * The header value, from the fixed lines and every entry registered.
 *
 * Refuses rather than repairs: an entry naming a directive outside the
 * contributable six, or a source the grammar above does not admit, is a
 * configuration error in the plugin that made it, and a policy silently
 * missing it would let a browser block that plugin's traffic in
 * production. Sources are deduplicated in first-seen order.
 */
export const composeShellPolicy = (
  entries: readonly ShellPolicyEntry[],
  options: {
    /**
     * A document a server rendered streams inline scripts of its own - its
     * payload, the scripts that place late html - whose bytes no constant
     * can hash. Such a document runs its inline scripts by a nonce made for
     * it alone, which this policy names beside 'self'.
     */
    readonly scriptNonce?: string
  } = {},
): string => {
  const nonce = options.scriptNonce
  if (nonce !== undefined && !/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(nonce)) {
    throw new ShellPolicyRefused('a script nonce is base64 of at least 16 characters')
  }
  const added = new Map<ShellPolicyDirective, string[]>()
  for (const entry of entries) {
    for (const [directive, sources] of Object.entries(entry)) {
      if (directive === 'owner') continue
      if (!contributable.has(directive)) {
        throw new ShellPolicyRefused(
          `${entry.owner} contributes to ${directive}, which a plugin may not change; only ${SHELL_POLICY_DIRECTIVES.join(', ')} take contributions`,
        )
      }
      if (!Array.isArray(sources)) {
        throw new ShellPolicyRefused(`${entry.owner} contributes a non-list to ${directive}`)
      }
      const script = directive === 'script-src'
      for (const source of sources as readonly unknown[]) {
        const accepted =
          typeof source === 'string' &&
          (script ? scriptSourceAccepted(source) : fetchSourceAccepted(source))
        if (!accepted) {
          throw new ShellPolicyRefused(
            script
              ? `${entry.owner} contributes ${JSON.stringify(source)} to script-src, which takes an https://host[:port] and nothing else; how scripts run is the shell's alone`
              : `${entry.owner} contributes ${JSON.stringify(source)} to ${directive}, which is not 'self', data:, blob:, an https://host[:port] or a ws(s)://host[:port]`,
          )
        }
        const list = added.get(directive as ShellPolicyDirective) ?? []
        if (!list.includes(source)) list.push(source)
        added.set(directive as ShellPolicyDirective, list)
      }
    }
  }
  const lines = FIXED.map(([directive, fixed]) => {
    // a document's own inline scripts run by the nonce made for it alone
    const sources =
      nonce !== undefined && directive === 'script-src' ? [...fixed, `'nonce-${nonce}'`] : fixed
    const extra = (added.get(directive as ShellPolicyDirective) ?? []).filter(
      (source) => !sources.includes(source),
    )
    return `${directive} ${[...sources, ...extra].join(' ')}`
  })
  lines.push(`report-to ${REPORTING_ENDPOINT}`, `report-uri ${REPORT_PATH}`)
  return lines.join('; ')
}

/**
 * The frozen header value, readable once the assembly barrier has run.
 *
 * Frozen at the barrier because that is the first moment every plugin's
 * layer has built and registered. Read later by the shell's routes, which
 * build after the barrier; asking earlier is a programming error, not a
 * state to handle.
 */
export class ShellPolicyHeader extends Context.Service<
  ShellPolicyHeader,
  {
    readonly value: () => string
    /**
     * The policy a document a server draws goes out under: what every plugin
     * contributed, frozen with the value, naming the nonce made for that
     * document alone.
     */
    readonly forDocument: (nonce: string) => string
  }
>()('@qualy/plugin-web/ShellPolicyHeader') {}

export const policyLayer: Layer.Layer<ShellPolicyHeader, never, ShellPolicy | Assembled> =
  Layer.effect(
    ShellPolicyHeader,
    Effect.gen(function* () {
      const registry = yield* ShellPolicy
      const assembled = yield* Assembled
      let frozen: string | undefined
      let contributed: readonly ShellPolicyEntry[] | undefined
      yield* assembled.register({
        name: 'web/shell-policy',
        run: Effect.gen(function* () {
          const entries = yield* registry.entries
          contributed = entries
          frozen = yield* Effect.try({
            try: () => composeShellPolicy(entries),
            catch: (cause) =>
              cause instanceof ShellPolicyRefused ? cause : new ShellPolicyRefused(String(cause)),
          })
          yield* Effect.logDebug(
            `shell policy frozen with ${entries.length} contribution(s) from ${
              entries.map((entry) => entry.owner).join(', ') || 'nobody'
            }`,
          )
        }),
      })
      return ShellPolicyHeader.of({
        value: () => {
          if (frozen === undefined) {
            throw new Error('the shell policy was read before the assembly barrier froze it')
          }
          return frozen
        },
        forDocument: (nonce) => {
          if (contributed === undefined) {
            throw new Error('the shell policy was read before the assembly barrier froze it')
          }
          return composeShellPolicy(contributed, { scriptNonce: nonce })
        },
      })
    }),
  )
