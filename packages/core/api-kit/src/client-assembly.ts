import { Context, Effect, Layer, Scope } from 'effect'
import {
  isReleaseId,
  SERVER_MAX_CLIENT_PROTOCOL,
  SERVER_MIN_CLIENT_PROTOCOL,
  type ClientUnsupportedReason,
} from '@qualy/release-contract'

// Whether the release a page claims to be may still talk to this process.
//
// Once a build carries only the ACTIVE plugins, two releases of the same
// product are not interchangeable: a page built when the formula plugin was
// on has screens whose api this server may no longer serve, and a page built
// before a plugin was added will ask a manifest for surfaces its own bundle
// does not contain. Neither half can notice that on its own - the protocol
// generation is about the api's shape, not about which plugins are in it.
//
// The host can notice, and only the host. A page names its release on every
// request; whoever installed that release knows which assembly it was built
// from, and this process knows its own. So the comparison happens here and
// the browser is told nothing but "reload": it never learns either hash, and
// never learns that assemblies are a thing.
//
// The judgement travels the way a readiness probe does, for the same reason:
// the host must not reach into the plugin that owns the release store, and
// an assembly without that plugin has no releases to judge.

/**
 * What a claimed release is, to this process.
 *
 * `compatible` is deliberately one answer for two cases - this process's own
 * release, and an older one built from the same assembly - because the
 * middleware does the same thing with both, and an older page continuing to
 * work is the whole point of keeping releases around.
 */
export type ReleaseStanding = 'compatible' | 'other-assembly' | 'unknown'

export class ClientAssembly extends Context.Service<
  ClientAssembly,
  {
    /**
     * Offers the judgement for as long as the registering layer lives.
     *
     * One at a time: a second would mean two answers to one question with
     * nothing to choose between them, which is a broken assembly rather than
     * a condition anything can handle.
     */
    readonly register: (
      judge: (releaseId: string) => ReleaseStanding,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** read per request; `compatible` where nothing can judge */
    readonly standingOf: (releaseId: string) => ReleaseStanding
  }
>()('@qualy/api-kit/ClientAssembly') {}

export const clientAssemblyLayer: Layer.Layer<ClientAssembly> = Layer.sync(ClientAssembly, () => {
  let judge: ((releaseId: string) => ReleaseStanding) | undefined
  return ClientAssembly.of({
    register: (offered) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          if (judge !== undefined) throw new Error('the client assembly judge is registered twice')
          judge = offered
        }),
        () =>
          Effect.sync(() => {
            judge = undefined
          }),
      ).pipe(Effect.orDie, Effect.asVoid),
    // Nothing registered means nothing serves releases here - a headless
    // deployment, or a test. A release header then names a build this process
    // has no opinion about, and having no opinion is not grounds for refusing
    // a request: the api is not the web page's alone.
    standingOf: (releaseId) => judge?.(releaseId) ?? 'compatible',
  })
})

/** the generations of the api a server still speaks */
export interface ProtocolWindow {
  readonly min: number
  readonly max: number
}

export const SERVER_PROTOCOL_WINDOW: ProtocolWindow = {
  min: SERVER_MIN_CLIENT_PROTOCOL,
  max: SERVER_MAX_CLIENT_PROTOCOL,
}

/** the declared generation as a number, or nothing where it is not one */
const generationOf = (declared: string): number | undefined =>
  /^\d{1,7}$/.test(declared) ? Number(declared) : undefined

/**
 * Why this server will not talk to a page, or nothing when it will.
 *
 * One judgement for every way a page can say who it is: the HTTP transport
 * names both in headers, a live channel in its query, and the two must not
 * come to different answers. Something that names neither is not a web page
 * - the cli, an integration, a test client - and goes through.
 */
export const clientRefusal = (
  declared: { readonly protocol: string | undefined; readonly release: string | undefined },
  standingOf: (releaseId: string) => ReleaseStanding,
  window: ProtocolWindow = SERVER_PROTOCOL_WINDOW,
): ClientUnsupportedReason | undefined => {
  if (declared.protocol !== undefined) {
    const generation = generationOf(declared.protocol)
    if (generation === undefined || generation < window.min || generation > window.max) {
      return 'protocol'
    }
  }
  if (declared.release === undefined) return undefined
  const standing: ReleaseStanding = isReleaseId(declared.release)
    ? standingOf(declared.release)
    : 'unknown'
  if (standing === 'compatible') return undefined
  return standing === 'unknown' ? 'release' : 'assembly'
}
