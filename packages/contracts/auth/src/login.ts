import { Context, Effect, Layer, Scope } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest'
import type { ClientComponentRef } from '@qualy/ui-contract'

// The login surface a driver plugin needs, and the registry of drivers itself.
//
// A driver proves who somebody is; the core turns that proof into a session.
// A driver registers itself while its own layer is built and the core reads
// the registry per request, which is the shape the router upstream uses for
// routes: nothing has to be built after everything else to be complete,
// because nothing reads the registry until a request arrives.
//
// The alternative, deriving the catalog from the manifest, needed a generated
// module, a subpath export and a declaration per driver - four places to
// change to add a way of signing in.

/** how a driver asks to be presented on the sign-in screen */
export type LoginPresentation =
  | { readonly mode: 'component'; readonly component: string }
  /** a same-origin path; an absolute url is dropped rather than followed */
  | { readonly mode: 'redirect'; readonly href: string }

/**
 * The same statement as a declaration. A component is a module REFERENCE,
 * static so the build can collect it without running anything - the wire key
 * is derived from the declaring plugin and this reference by the methods
 * endpoint, the same derivation the manifest and the build use. A redirect
 * href stays a function of the provider row, because an SSO entry point is
 * per provider and never enters a browser bundle.
 */
export type LoginPresentationDeclaration =
  | { readonly mode: 'component'; readonly component: ClientComponentRef }
  | { readonly mode: 'redirect'; readonly href: (provider: { readonly code: string }) => string }

/** props every embedded credential renderer receives from the login shell */
export interface LoginMethodRendererProps {
  method: LoginMethod & { mode: 'component' }
  onAuthenticated: () => void
}

/** a provider row paired with how its driver asks to be presented */
export type LoginMethod = {
  readonly code: string
  readonly type: string
  readonly name: string
} & LoginPresentation

export interface LoginDriver {
  readonly type: string
  readonly presentation: LoginPresentationDeclaration
}

/** every login driver this assembly serves, as its drivers registered them */
export class LoginDrivers extends Context.Service<
  LoginDrivers,
  {
    /**
     * Adds a driver for as long as the registering layer lives.
     *
     * Scoped, so a plugin that goes away takes its driver with it rather than
     * leaving the sign-in screen offering a way in that nothing implements.
     */
    readonly register: (
      driver: LoginDriver,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** the driver and its declaring plugin, or none if no plugin implements it */
    readonly forType: (
      type: string,
    ) => Effect.Effect<{ driver: LoginDriver; owner: string } | undefined>
  }
>()('@qualy/auth-contract/LoginDrivers') {}

/**
 * The registry itself, provided by whoever consumes it.
 *
 * A Map in a closure rather than a field that is reassigned: registration
 * mutates the container, and every reader holds the same one.
 */
export const loginDriversLayer: Layer.Layer<LoginDrivers> = Layer.sync(LoginDrivers, () => {
  const drivers = new Map<string, { driver: LoginDriver; owner: string }>()
  return LoginDrivers.of({
    register: (driver, owner) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // Two plugins claiming one provider type would leave whichever
          // registered last deciding how the other is presented. It is a
          // broken assembly rather than a condition anything can handle, so
          // the layer refuses to build.
          if (drivers.has(driver.type)) {
            throw new Error(`login driver type ${driver.type} is registered twice`)
          }
          drivers.set(driver.type, { driver, owner: owner ?? 'an unnamed contributor' })
        }),
        () => Effect.sync(() => drivers.delete(driver.type)),
      ).pipe(Effect.orDie, Effect.asVoid),
    forType: (type) => Effect.sync(() => drivers.get(type)),
  })
})

/**
 * A layer that contributes one driver, which is a whole driver plugin's
 * contribution to the running application.
 */
export const registerLoginDriver = (
  driver: LoginDriver,
  owner?: string,
): Layer.Layer<never, never, LoginDrivers> =>
  Layer.effectDiscard(Effect.flatMap(LoginDrivers, (drivers) => drivers.register(driver, owner)))

export interface ResolvedProvider {
  readonly tenantId: string
  readonly providerId: string
}

export interface SignedInUser {
  readonly id: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly userType: { readonly id: string; readonly code: string; readonly name: string }
  readonly primaryOrgNode: {
    readonly id: string
    readonly name: string
    readonly orgType: { readonly id: string; readonly name: string }
    /**
     * Root first, the node itself last: where this person stands, spelled out
     * level by level. Each step carries what that level is called - "College",
     * "Class" - so a screen can label it without knowing the tenant's tree.
     */
    readonly lineage: readonly {
      readonly id: string
      readonly name: string
      readonly typeName: string
    }[]
  }
  readonly tenant: { readonly id: string; readonly slug: string; readonly name: string }
}

export interface FoundIdentity {
  readonly id: string
  readonly userId: string
  readonly credentialHash: string | null
  readonly allowsLocalLogin: boolean
}

/**
 * What the core offers a driver.
 *
 * A tag rather than a direct import: a driver depends on the core package
 * already, but a service tag is a value, and keeping the value here is what
 * lets the core stay unaware of which drivers exist.
 */
export interface LoginSessionsShape {
  /**
   * A public provider code resolved against the anonymous tenant.
   *
   * The expected type is checked here so a row belonging to one driver
   * cannot be driven through another's route.
   */
  readonly resolveProvider: (input: {
    providerCode: string
    expectedType: string
  }) => Effect.Effect<ResolvedProvider | undefined>
  readonly findIdentity: (input: {
    tenantId: string
    providerId: string
    identifier: string
  }) => Effect.Effect<FoundIdentity | undefined>
  /**
   * The driver proved the user; create the session and set the cookie.
   *
   * Answers undefined when the account state forbids signing in after all,
   * so a driver reports one uniform refusal rather than describing the
   * account to whoever asked.
   */
  readonly completeLogin: (input: {
    tenantId: string
    userId: string
    identityId?: string
  }) => Effect.Effect<SignedInUser | undefined, never, HttpServerRequest>
}

export class LoginSessions extends Context.Service<LoginSessions, LoginSessionsShape>()(
  '@qualy/auth-contract/LoginSessions',
) {}
