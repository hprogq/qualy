import { Context, Effect, Layer, Scope } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest'
import type { UiText } from '@qualy/i18n-contract'
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

/**
 * How a driver asks to be presented on the sign-in screen.
 *
 * `component` says only that there is one: which renderer draws it is
 * answered by the driver's TYPE, which the method already carries and the
 * browser build filed the renderer under. The wire used to carry a module
 * key beside the mode, so every visitor to the login screen was told which
 * package and which file implement the way in.
 */
export type LoginPresentation =
  | { readonly mode: 'component' }
  /** a same-origin path; an absolute url is dropped rather than followed */
  | { readonly mode: 'redirect'; readonly href: string }

/**
 * The same statement as a declaration. A component is a module REFERENCE,
 * static so the build can collect it without running anything: the build
 * files it under the driver's type and nothing else ever needs it. A
 * redirect href stays a function of the provider row, because an SSO entry
 * point is per provider and never enters a browser bundle.
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

/**
 * How a driver finds the person a proof is about.
 *
 * Two answers, and they are the whole of it:
 *
 * - `user-field`: by a fact the person already has. The password door looks
 *   people up by their email; a campus door whose accounts ARE business
 *   numbers looks them up by that. Nothing about the door is stored on the
 *   person to make this work.
 * - `binding-subject`: by an account that lives elsewhere (an OAuth or OIDC
 *   provider), whose durable id is kept in a binding the person made.
 *
 * Which one is fixed by the driver, not by an administrator: it is what the
 * protocol proves.
 */
export type SubjectResolution =
  | { readonly mode: 'user-field'; readonly field: 'email' | 'businessNo' }
  | { readonly mode: 'binding-subject' }

/**
 * What an administrator, or only the person, may write about a person for
 * this kind of door. Absent when there is nothing to write: a door that goes
 * by the business number needs no binding at all.
 *
 * - `managed`: a credential whoever administers the person may set, reset
 *   or withdraw - a password. The driver turns what was typed into what is
 *   stored, so the core never learns what a password is or how it is kept.
 *   Only a `user-field` door can be managed: the person is found by their
 *   own field, and the binding holds nothing but the credential.
 * - `self`: an external account only the person can bind, by going through
 *   the driver's own flow. An administrator reads it and may withdraw it.
 *   Only a `binding-subject` door can be bound this way.
 */
export type AuthBindingDeclaration =
  | {
      readonly mode: 'managed'
      /** the secret typed for the person, and what makes one acceptable */
      readonly secret: {
        readonly label: UiText
        readonly hint?: UiText
        readonly minLength: number
        readonly maxLength: number
      }
      /**
       * What was typed, turned into what is stored.
       *
       * Answers `ok: false` rather than failing: a secret that cannot be
       * one is an answer to the person typing, not an error. The secret
       * leaves only as a digest - the core stores what it is handed.
       */
      readonly prepare: (input: {
        secret: string
      }) => Effect.Effect<
        { readonly ok: true; readonly credentialHash: string } | { readonly ok: false }
      >
    }
  | { readonly mode: 'self' }

/**
 * What one entrance of a driver's kind needs to be told, beyond its name.
 *
 * A CAS entrance needs the server's address; an OAuth one a client id and a
 * secret. The core cannot know any of that, so the driver says what to ask
 * for - the form is built from these - and turns what was typed into the
 * `config` it will read back when somebody signs in.
 *
 * `secret` fields never enter the config. They are encrypted by the secrets
 * capability under the entrance's id and the field's key, reported to a
 * screen only as stored or not, and read by the driver at sign-in.
 *
 * `required` says what the entrance needs before it can be put in service,
 * not what a save must contain: an entrance is set up over several saves,
 * and one that is missing something stays out of service until it has it.
 */
export interface EntranceField {
  readonly key: string
  readonly label: UiText
  readonly hint?: UiText
  readonly kind: 'text' | 'url' | 'secret'
  readonly required: boolean
}

export interface EntranceKind {
  /** what this kind of entrance is called when one is being added */
  readonly label: UiText
  readonly fields: readonly EntranceField[]
  /**
   * The config keys that say whose accounts the entrance speaks for: a CAS
   * server's address, an OAuth issuer. Once anybody has bound an account
   * through the entrance, even a binding since withdrawn, these no longer
   * change: every subject stored would start naming an account at another
   * provider.
   */
  readonly identityNamespaceKeys?: readonly string[]
  /**
   * The text and url values, with what was stored merged in, turned into the
   * stored config. Secrets are not among them. Absent means the values are
   * stored as they are.
   */
  readonly prepareConfig?: (input: {
    readonly values: Readonly<Record<string, string>>
    readonly previous: Readonly<Record<string, unknown>>
  }) => Effect.Effect<
    | { readonly ok: true; readonly config: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly invalid: string }
  >
}

/**
 * Who makes the doors of a driver's kind.
 *
 * - `system-singleton`: the platform, exactly one per tenant at a fixed
 *   address. A tenant administers it (name, audience, in service or not)
 *   and can neither add a second one nor delete it. The password door.
 * - `tenant-managed`: the tenant's administrators, as many as they need,
 *   each told what the driver asks for.
 */
export type ProviderProvisioning =
  | { readonly mode: 'system-singleton'; readonly code: string }
  | { readonly mode: 'tenant-managed'; readonly entrance: EntranceKind }

export interface LoginDriver {
  readonly type: string
  readonly presentation: LoginPresentationDeclaration
  readonly provisioning: ProviderProvisioning
  readonly resolution: SubjectResolution
  readonly binding?: AuthBindingDeclaration
}

/**
 * Why a driver declaration cannot be served, or undefined when it can.
 *
 * A managed credential is written beside a person the door finds by their
 * own field; a self binding holds the external subject the door finds them
 * by. The other two pairings describe a door that could never let anybody
 * in, and an assembly that contains one is broken rather than degraded.
 */
export const driverContradiction = (driver: LoginDriver): string | undefined => {
  if (driver.binding?.mode === 'managed' && driver.resolution.mode !== 'user-field') {
    return `login driver ${driver.type} manages a credential but does not find people by a field of their own`
  }
  if (driver.binding?.mode === 'self' && driver.resolution.mode !== 'binding-subject') {
    return `login driver ${driver.type} lets people bind an account but does not find them by it`
  }
  if (driver.resolution.mode === 'binding-subject' && driver.binding?.mode !== 'self') {
    return `login driver ${driver.type} finds people by a binding nobody can make`
  }
  return undefined
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
    /** every driver this assembly serves, in the order they registered */
    readonly all: Effect.Effect<readonly { driver: LoginDriver; owner: string }[]>
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
          const contradiction = driverContradiction(driver)
          if (contradiction !== undefined) throw new Error(contradiction)
          drivers.set(driver.type, { driver, owner: owner ?? 'an unnamed contributor' })
        }),
        () => Effect.sync(() => drivers.delete(driver.type)),
      ).pipe(Effect.orDie, Effect.asVoid),
    forType: (type) => Effect.sync(() => drivers.get(type)),
    all: Effect.sync(() => [...drivers.values()]),
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

/**
 * Why an attempt failed, precisely, for the record alone.
 *
 * A driver states what IT could see - a proof that did not verify, an
 * identity that does not exist - and the core adds what only it knows when a
 * proven user still may not come in. The wire answer stays the driver's one
 * uniform refusal; none of this reaches an anonymous caller.
 */
export type SignInFailureReason =
  | 'invalid-credentials'
  | 'binding-not-found'
  | 'user-not-found'
  | 'user-disabled'
  | 'user-deleted'
  | 'user-type-disabled'
  | 'tenant-disabled'

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

/** a live binding, with what a driver needs to check the proof against it */
export interface FoundBinding {
  readonly id: string
  readonly userId: string
  readonly credentialHash: string | null
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
  /**
   * The living person whose own field holds this value, when this door's
   * audience admits their kind; undefined otherwise, indistinguishably.
   *
   * For a `user-field` driver. The value is compared as stored, so a driver
   * normalizes what was typed first (an email with `normalizeEmail`).
   * Whether the account may still come in is `completeLogin`'s question.
   */
  readonly findUserByField: (input: {
    tenantId: string
    providerId: string
    field: 'email' | 'businessNo'
    value: string
  }) => Effect.Effect<{ readonly userId: string } | undefined>
  /** the person's live binding to this door, for a door that keeps a credential */
  readonly findBindingForUser: (input: {
    tenantId: string
    providerId: string
    userId: string
  }) => Effect.Effect<FoundBinding | undefined>
  /**
   * The live binding holding this external subject, for a living person
   * this door's audience admits; for a `binding-subject` driver.
   */
  readonly findBindingBySubject: (input: {
    tenantId: string
    providerId: string
    subject: string
  }) => Effect.Effect<FoundBinding | undefined>
  /**
   * Records a refused attempt, then the driver answers its uniform refusal.
   *
   * The core writes the event so every driver produces the same record: the
   * resolved provider is the attempt's context, the ids say how far it got,
   * and what the caller typed is deliberately not part of the shape. Nothing
   * before a resolved provider is recorded at all - a URL that names no
   * door is noise for the access log, not an attempt on an account.
   */
  readonly failAttempt: (
    provider: ResolvedProvider,
    input: {
      reason: SignInFailureReason
      userId?: string
      bindingId?: string
    },
  ) => Effect.Effect<void>
  /**
   * The driver proved the user; create the session and set the cookie.
   *
   * Answers undefined when the account state forbids signing in after all -
   * recording the refusal with the precise reason itself - so a driver
   * reports one uniform refusal rather than describing the account to
   * whoever asked. On success the session (which remembers this door and
   * this binding), the binding's last-used stamp and the sign-in event
   * commit as one transaction. The only place a session is ever created.
   */
  readonly completeLogin: (input: {
    tenantId: string
    providerId: string
    userId: string
    bindingId?: string
  }) => Effect.Effect<SignedInUser | undefined, never, HttpServerRequest>
}

export class LoginSessions extends Context.Service<LoginSessions, LoginSessionsShape>()(
  '@qualy/auth-contract/LoginSessions',
) {}
