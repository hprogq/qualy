import { Context, Data, Effect, Layer, Redacted, Scope } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest'
import type { UiText } from '@qualy/i18n-contract'
import type { ClientComponentRef } from '@qualy/ui-contract'
import type { TooManyAttempts } from './session.ts'

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
      /**
       * Whether what was typed is the credential a stored digest was made
       * from. Asked when a person changes their own: the one who knows the
       * old one is the one who may set a new one.
       */
      readonly verify: (input: {
        secret: string
        credentialHash: string
      }) => Effect.Effect<boolean>
    }
  | {
      readonly mode: 'self'
      /**
       * Where a signed-in person begins binding an account of this kind to
       * themselves: a same-origin path of one of the driver's own routes.
       * Absent when the driver offers no way to bind from the account page.
       */
      readonly start?: (provider: { readonly code: string }) => string
    }

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
interface EntranceFieldBase {
  readonly key: string
  readonly label: UiText
  readonly hint?: UiText
  readonly required: boolean
  /**
   * Shown, stored and asked of the entrance only while another field of the
   * same form holds this value: the custom endpoints of a CAS entrance whose
   * protocol is set to custom. A plain equality and nothing more - a form
   * that needs more than that is asking the wrong question of its fields.
   */
  readonly visibleWhen?: { readonly field: string; readonly equals: string | boolean }
  /** where the form puts it; advanced fields fold away until asked for */
  readonly section?: 'basic' | 'advanced'
}

/** one of a fixed set, stored as the option's value */
export interface EntranceChoice {
  readonly value: string
  readonly label: UiText
}

export type EntranceField = EntranceFieldBase &
  (
    | { readonly kind: 'text' | 'url' | 'secret' }
    | {
        readonly kind: 'choice'
        readonly options: readonly EntranceChoice[]
        /** what the field holds until somebody chooses; required fields want one */
        readonly defaultValue?: string
      }
    | { readonly kind: 'toggle'; readonly defaultValue?: boolean }
    | {
        readonly kind: 'number'
        readonly min?: number
        readonly max?: number
        /** 1 for whole numbers; absent for any finite number */
        readonly step?: number
        readonly defaultValue?: number
      }
  )

/** what a non-secret field holds, once read: text and urls as strings */
export type EntranceValue = string | boolean | number

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
   * What the driver works out from the settings, checked and stored beside
   * them.
   *
   * `values` is every visible non-secret field as it will stand, defaults
   * applied, already parsed to its kind. The settings themselves are stored
   * by the core under their own keys; what this answers goes under `derived`
   * - a CAS entrance's endpoints, expanded once from its server and protocol,
   * so a later release that derives them differently does not move an
   * entrance nobody touched. Absent means nothing is derived. An answer of
   * `ok: false` names the field that cannot stand as it is.
   */
  readonly prepareConfig?: (input: {
    readonly values: Readonly<Record<string, EntranceValue>>
  }) => Effect.Effect<
    | { readonly ok: true; readonly derived?: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly invalid: string }
  >
}

/** the config key the core stores what `prepareConfig` derived under */
export const DERIVED_CONFIG_KEY = 'derived'

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
  | {
      readonly mode: 'system-singleton'
      readonly code: string
      /** what the kind is called on the screens that list the tenant's ways in */
      readonly label: UiText
    }
  | { readonly mode: 'tenant-managed'; readonly entrance: EntranceKind }

export interface LoginDriver {
  readonly type: string
  readonly presentation: LoginPresentationDeclaration
  readonly provisioning: ProviderProvisioning
  readonly resolution: SubjectResolution
  readonly binding?: AuthBindingDeclaration
  /**
   * Where this driver's kind of entrance expects somebody to be sent back to,
   * as a same-origin path of one of its own routes.
   *
   * Declaring it says the entrance sends people away and takes them back,
   * which is what makes this deployment's public address something it needs:
   * an entrance of this kind cannot be put in service until there is one, and
   * a production process that finds one in service without it refuses to
   * start. The absolute address handed to the other server is built by the
   * core, from the address the deployment is configured with.
   */
  readonly callback?: (provider: { readonly code: string }) => string
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
  if (driver.provisioning.mode === 'tenant-managed') {
    const fields = driver.provisioning.entrance.fields
    const keys = new Set(fields.map((field) => field.key))
    for (const field of fields) {
      if (field.key === DERIVED_CONFIG_KEY) {
        return `login driver ${driver.type} declares a field named ${DERIVED_CONFIG_KEY}, which the core keeps for itself`
      }
      if (field.visibleWhen !== undefined && !keys.has(field.visibleWhen.field)) {
        return `login driver ${driver.type} shows ${field.key} on a field it does not declare`
      }
      if (
        field.kind === 'choice' &&
        field.defaultValue !== undefined &&
        !field.options.some((option) => option.value === field.defaultValue)
      ) {
        return `login driver ${driver.type} defaults ${field.key} to a value it does not offer`
      }
    }
  }
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

/** this deployment has no public address, so nothing can be sent back to it */
export class PublicOriginUnavailable extends Data.TaggedError('PublicOriginUnavailable')<{
  readonly tenantSlug: string
}> {}

/** a stored secret of an entrance that is not there */
export class ProviderSecretMissing extends Data.TaggedError('ProviderSecretMissing')<{
  readonly key: string
}> {}

/**
 * One entrance, resolved: who it belongs to, what it was told, and a way to
 * ask for what it was told in confidence.
 *
 * The settings are the plain ones; a secret is fetched one key at a time and
 * arrives redacted, so a driver that logs the whole thing logs nothing.
 */
export interface ResolvedProvider {
  readonly tenantId: string
  readonly tenantSlug: string
  readonly providerId: string
  /** the driver's kind, which is also the route it was reached through */
  readonly type: string
  readonly code: string
  readonly version: number
  readonly config: Readonly<Record<string, unknown>>
  readonly secret: (key: string) => Effect.Effect<Redacted.Redacted<string>, ProviderSecretMissing>
}

/** why a flow could not be taken up; the caller decides what to say */
export type FlowRejection =
  | 'unknown'
  | 'expired'
  | 'consumed'
  | 'provider-mismatch'
  | 'session-mismatch'

export class AuthFlowRejected extends Data.TaggedError('AuthFlowRejected')<{
  readonly reason: FlowRejection
}> {}

/**
 * What a driver puts aside when a flow starts: a value, or one built from the
 * flow's own state.
 *
 * The second is for a protocol whose return address has to carry the state -
 * CAS has no state parameter of its own, so the service it is asked to
 * validate against is the callback with the state in it. The core makes the
 * state first, hands it over, and seals what comes back, so the exact string
 * sent away is the one kept, byte for byte, and never rebuilt on the way back.
 */
export type FlowPayload =
  | Redacted.Redacted<string>
  | ((state: Redacted.Redacted<string>) => Redacted.Redacted<string>)

/** why an account could not be bound to a person, as the driver reports it */
export type BindingRejection =
  /** the flow was not a bind, or not this entrance's */
  | 'not-a-bind'
  /** the entrance went out of service or away since the flow began */
  | 'provider-unavailable'
  /** the entrance no longer admits this person's kind */
  | 'audience-excluded'
  /** the person was disabled or deleted since the flow began */
  | 'user-unavailable'
  /** this person already has an account bound at this entrance */
  | 'already-bound'
  /** somebody else has this account bound here */
  | 'subject-taken'

export class AuthBindingRejected extends Data.TaggedError('AuthBindingRejected')<{
  readonly reason: BindingRejection
}> {}

/**
 * Something the person's session holds from the other side, kept with the
 * session and only there: an upstream session credential, tokens a later
 * request spends on the person's behalf. The core seals it and never reads
 * it; the driver that wrote it is the one that knows what it is.
 */
export interface SessionGrantInput {
  /** the driver's own word for what it keeps, one per session and entrance */
  readonly kind: string
  readonly state: Redacted.Redacted<string>
  readonly expiresAt?: Date
}

/** a flow that has just started; the state travels to the other server */
export interface StartedFlow {
  readonly flowId: string
  readonly state: Redacted.Redacted<string>
  readonly expiresAt: Date
}

/** a flow taken up exactly once */
export interface ConsumedFlow {
  readonly flowId: string
  readonly purpose: 'login' | 'bind'
  /** whose flow it was, for a bind */
  readonly userId?: string
  readonly sessionId?: string
  /** where the person asked to be returned to, if anywhere safe */
  readonly returnPath?: string
  /** what the driver put aside when it started, opened again */
  readonly payload?: Redacted.Redacted<string>
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
  /** the other side refused the proof it was shown */
  | 'external-rejected'
  /** the other side could not be asked */
  | 'external-unavailable'
  /** the other side answered in a form the driver cannot read */
  | 'external-invalid'

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
   * Where this entrance's kind expects to be called back, absolute.
   *
   * Built from the deployment's public address and the path the driver
   * declares, so a driver never has to know how it is reached.
   */
  readonly callbackUrl: (
    provider: ResolvedProvider,
  ) => Effect.Effect<URL, PublicOriginUnavailable>
  /**
   * Starts one redirect through somebody else's server.
   *
   * The state is a secret the other server carries and hands back; only its
   * digest is stored. A payload - a verifier, a nonce - is sealed under the
   * flow's own identity and cannot be opened as any other flow's. A bind
   * pins the session it began in, so an account bound on the way back is
   * bound for the person who asked, in the session they asked from.
   */
  readonly startFlow: (input: {
    provider: ResolvedProvider
    purpose: 'login' | 'bind'
    /** for a bind: who is doing it, and from which session */
    binding?: { userId: string; sessionId: string }
    returnPath?: string
    payload?: FlowPayload
  }) => Effect.Effect<StartedFlow, AuthFlowRejected | TooManyAttempts>
  /**
   * Takes a flow up, once and only once.
   *
   * A flow that is unknown, expired, already taken up, or belongs to another
   * entrance is refused - and burned in the same breath, so a state that
   * reaches the wrong route is spent rather than left for a second attempt.
   */
  readonly consumeFlow: (input: {
    provider: ResolvedProvider
    state: string
  }) => Effect.Effect<ConsumedFlow, AuthFlowRejected>
  /**
   * Binds an external account to the person a bind flow belongs to.
   *
   * Takes the consumed flow rather than a person: who is binding is whoever
   * began the flow, in the session they began it in, and the core checks the
   * flow was a bind this entrance just took up. A driver cannot name a
   * person from anything that arrived on the way back. In one transaction:
   * the entrance still serves and admits the person's kind, the person is
   * still there and has no account bound here yet, and nobody else has this
   * one.
   */
  readonly bindSubject: (input: {
    provider: ResolvedProvider
    flow: ConsumedFlow
    subject: string
    /** what the account is called over there, for the screens; never looked up by */
    displayLabel?: string
  }) => Effect.Effect<{ readonly bindingId: string }, AuthBindingRejected>
  /**
   * Whether one more sign-in attempt may be made from where this request
   * came from, and - when the driver has one - at this identifier.
   *
   * Asked before anything expensive: before a password hash is checked,
   * before an upstream is called. The identifier is weighed the same way
   * whether or not anybody answers to it, so the refusal says nothing about
   * which addresses exist.
   */
  readonly admitAttempt: (input: {
    provider: ResolvedProvider
    identifier?: string
  }) => Effect.Effect<void, TooManyAttempts>
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
    /** what the bound account is called over there now, when the driver learned it */
    bindingDisplayLabel?: string
    /** what the new session keeps from the other side, written with it */
    grants?: readonly SessionGrantInput[]
  }) => Effect.Effect<SignedInUser | undefined, never, HttpServerRequest>
}

export class LoginSessions extends Context.Service<LoginSessions, LoginSessionsShape>()(
  '@qualy/auth-contract/LoginSessions',
) {}
