import { Context, Effect } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest'

// The login surface a driver plugin needs, and the catalog of drivers itself.
//
// A driver proves who somebody is; the core turns that proof into a session.
// Under cordis the driver pushed itself into the core's registry from its own
// constructor, which a static graph cannot express: the core would have to be
// built after every driver to be complete, and before them to answer their
// calls. The catalog is therefore pulled from the manifest, exactly as the
// permission catalog is, and the core is handed a finished one.

/** how a driver asks to be presented on the sign-in screen */
export type LoginPresentation =
  | { readonly mode: 'component'; readonly component: string }
  /** a same-origin path; an absolute url is dropped rather than followed */
  | { readonly mode: 'redirect'; readonly href: string }

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
  readonly describe: (provider: { readonly code: string }) => LoginPresentation
}

/** every login driver this assembly serves, resolved from the manifest */
export class LoginDrivers extends Context.Service<LoginDrivers, readonly LoginDriver[]>()(
  '@qualy/auth-contract/LoginDrivers',
) {}

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
    readonly code: string | null
    readonly name: string
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
