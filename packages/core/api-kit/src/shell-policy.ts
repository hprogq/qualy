import { Context, Effect, Layer } from 'effect'

// What a plugin may add to the browser shell's content security policy,
// collected rather than named.
//
// The policy is one header string on the shell, and most of it is the
// shell's own business: which scripts run, which styles apply, where a
// form may post. But a few directives name hosts the browser is allowed to
// reach, and some of those hosts are a plugin's deployment fact - the cloud
// bucket a browser uploads to comes from that plugin's configuration, read
// at the time its layer builds. So those directives travel the other way:
// a plugin registers its sources while its own layer is built, and the
// shell reads whatever registered.
//
// The registry belongs to the host base, beside Readiness and Assembled,
// rather than to the plugin that serves the shell: a registering plugin
// must find it in scope whatever order the plugins build in, and a
// deployment without a shell at all (headless, the web plugin disabled)
// must still boot with the registering plugin selected. What is done with
// the entries - validation, freezing, the header - is the shell's
// interpretation and lives with it.

/**
 * The directives a plugin may contribute sources to.
 *
 * Only the ones that name where the browser may fetch from. The
 * script-src, style-src, base-uri, object-src and form-action lines decide
 * what runs and where a page may send itself, and are the shell's alone.
 */
export const SHELL_POLICY_DIRECTIVES = [
  'connect-src',
  'img-src',
  'frame-src',
  'worker-src',
  'font-src',
  'media-src',
] as const

export type ShellPolicyDirective = (typeof SHELL_POLICY_DIRECTIVES)[number]

/**
 * Sources per directive, as a plugin states them.
 *
 * A source is one of `'self'`, `data:`, `blob:`, `https://host[:port]`,
 * `ws://host[:port]` or `wss://host[:port]`; anything else is refused when
 * the shell freezes its policy, before the port binds.
 */
export type ShellPolicyContribution = {
  readonly [Directive in ShellPolicyDirective]?: readonly string[]
}

/** one plugin's contribution, with the plugin that made it */
export interface ShellPolicyEntry extends ShellPolicyContribution {
  /** the plugin id, which is what a refusal names */
  readonly owner: string
}

export class ShellPolicy extends Context.Service<
  ShellPolicy,
  {
    /** a plugin offering its sources, during its own layer's build */
    readonly register: (entry: ShellPolicyEntry) => Effect.Effect<void>
    /** every entry registered so far, in registration order */
    readonly entries: Effect.Effect<readonly ShellPolicyEntry[]>
  }
>()('@qualy/api-kit/ShellPolicy') {}

export const shellPolicyLayer: Layer.Layer<ShellPolicy> = Layer.sync(ShellPolicy, () => {
  const entries: ShellPolicyEntry[] = []
  return ShellPolicy.of({
    register: (entry) =>
      Effect.sync(() => {
        entries.push(entry)
      }),
    entries: Effect.sync(() => [...entries]),
  })
})
