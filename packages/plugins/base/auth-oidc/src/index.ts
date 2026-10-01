import { Effect, Redacted } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/http-api'
import {
  LoginSessions,
  type BindingRejection,
  type EntranceField,
  type LoginDriver,
} from '@qualy/auth-contract/login'
import { AuthOutbound } from '@qualy/auth-contract/outbound'
import { Login } from '@qualy/auth-contract/plugin'
import { AuthRequired, CurrentViewer } from '@qualy/auth-contract/session'
import {
  BindingAlreadyBound,
  BindingSubjectTaken,
  ExternalAccountUnbound,
  SignInFlowRejected,
  SignInMethodUnavailable,
  SignInPersonNotFound,
  failureLocation,
  signInFailureLocation,
} from '@qualy/auth-contract/sign-in-failure'
import { Api } from '@qualy/api-kit/local'
import { Api as ApiFeature } from '@qualy/api-kit/plugin'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'
import { Plugin } from '@qualy/plugin-kit'
import { authOidcApiGroup, OidcRejected, OidcUnavailable } from './api.ts'
import {
  authorizeRedirect,
  beginning,
  configurationFor,
  identify,
  settingsOf,
  sortFailure,
} from './oidc.ts'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// Signing in through any OpenID Connect provider, and binding an account of
// one to yourself.
//
// The protocol is openid-client's; this driver decides what is asked of it
// and what comes of the answer. The account is the ID Token's `sub` under
// this entrance's issuer and client - which is why both are what the
// entrance's accounts are said to belong to, and cannot change once one is
// bound. Nobody is found by email and nobody is created: an account nobody
// bound signs nobody in, and binding one starts from the person's own
// account page, for whoever is signed in there.

const local = Api.local(authOidcApiGroup)
const urls = HttpApiClient.urlBuilder(local)

const manual = { field: 'discoveryMode', equals: 'manual' } as const

const fields: readonly EntranceField[] = [
  {
    key: 'issuer',
    label: text(m.field_issuer),
    hint: text(m.field_issuerHint),
    kind: 'url',
    required: true,
  },
  {
    key: 'discoveryMode',
    label: text(m.field_discovery),
    kind: 'choice',
    required: true,
    options: [
      { value: 'discovery', label: text(m.field_discoveryAuto) },
      { value: 'manual', label: text(m.field_discoveryManual) },
    ],
    defaultValue: 'discovery',
  },
  {
    key: 'authorizationEndpoint',
    label: text(m.field_authorizationEndpoint),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'tokenEndpoint',
    label: text(m.field_tokenEndpoint),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'jwksUri',
    label: text(m.field_jwksUri),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'userinfoEndpoint',
    label: text(m.field_userinfoEndpoint),
    kind: 'url',
    required: false,
    visibleWhen: manual,
  },
  {
    key: 'clientId',
    label: text(m.field_clientId),
    kind: 'text',
    required: true,
  },
  {
    key: 'clientSecret',
    label: text(m.field_clientSecret),
    kind: 'secret',
    required: true,
  },
  {
    key: 'scopes',
    label: text(m.field_scopes),
    hint: text(m.field_scopesHint),
    kind: 'text',
    required: false,
    section: 'advanced',
  },
  {
    key: 'tokenAuthMethod',
    label: text(m.field_tokenAuth),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [
      { value: 'auto', label: text(m.field_tokenAuthAuto) },
      { value: 'basic', label: text(m.field_tokenAuthBasic) },
      { value: 'post', label: text(m.field_tokenAuthPost) },
    ],
    defaultValue: 'auto',
  },
  {
    key: 'clockSkewSeconds',
    label: text(m.field_clockSkew),
    kind: 'number',
    required: true,
    section: 'advanced',
    min: 0,
    max: 300,
    step: 1,
    defaultValue: 60,
  },
]

export const driver: LoginDriver = {
  failures: {
    AUTH_OIDC_REJECTED: text(m.error_rejected),
    AUTH_OIDC_UNAVAILABLE: text(m.error_unavailable),
  },
  type: 'oidc',
  icon: 'key',
  presentation: {
    mode: 'redirect',
    href: ({ code }) => urls.authOidc.start({ params: { providerCode: code }, query: {} }),
  },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: text(m.entrance_kind),
      fields,
      // a `sub` means one account to one issuer, and may mean another to
      // another client of it (pairwise subjects). Where its keys and tokens
      // come from counts as much: a key set moved elsewhere signs any `sub`
      // under the issuer's name, so every endpoint, and whether they are
      // discovered, is fixed with them
      identityNamespaceKeys: [
        'issuer',
        'clientId',
        'discoveryMode',
        'authorizationEndpoint',
        'tokenEndpoint',
        'jwksUri',
        'userinfoEndpoint',
      ],
    },
  },
  resolution: { mode: 'binding-subject' },
  binding: {
    mode: 'self',
    start: ({ code }) =>
      urls.authOidc.start({ params: { providerCode: code }, query: { intent: 'bind' } }),
  },
  callback: ({ code }) => urls.authOidc.callback({ params: { providerCode: code }, query: {} }),
  // any provider can be asked to sign the person in afresh (prompt=login,
  // max_age=0); whether one did is read from the ID Token's auth_time when
  // the person comes back, and only then does the sign-in count
  provesPresence: () => true,
  reauthenticate: ({ code }) =>
    urls.authOidc.start({ params: { providerCode: code }, query: { intent: 'reauthenticate' } }),
}

const away = (location: string, status: 302 | 303 = 302) =>
  HttpServerResponse.redirect(location, { status })

/** back to the sign-in page, which says why */
const failed = (failure: { readonly _tag: string; readonly retryAfterSeconds?: number }) =>
  away(signInFailureLocation(failure), 303)

/** why a bind did not go through, as the account page is told */
const bindFailure = (reason: BindingRejection) => {
  switch (reason) {
    case 'subject-taken':
      return new BindingSubjectTaken()
    case 'already-bound':
      return new BindingAlreadyBound()
    case 'provider-unavailable':
    case 'audience-excluded':
    case 'demo-account':
      return new SignInMethodUnavailable()
    case 'user-unavailable':
      return new SignInPersonNotFound()
    case 'not-a-bind':
      return new SignInFlowRejected()
  }
}

/** what a departure keeps for the return, sealed in the flow */
interface Carried {
  readonly verifier: string
  readonly nonce: string
  /**
   * For a sign-in the provider was asked to make afresh: when it was asked,
   * in seconds. An authentication the provider reports as older than this
   * happened before anybody asked.
   */
  readonly askedAt?: number
}

const carriedOf = (payload: Redacted.Redacted<string>): Carried | undefined => {
  try {
    const parsed = JSON.parse(Redacted.value(payload)) as Partial<Carried>
    return typeof parsed.verifier === 'string' && typeof parsed.nonce === 'string'
      ? {
          verifier: parsed.verifier,
          nonce: parsed.nonce,
          ...(typeof parsed.askedAt === 'number' ? { askedAt: parsed.askedAt } : {}),
        }
      : undefined
  } catch {
    return undefined
  }
}

/** the entrance's configuration, or why there is none to be had */
const configurationOf = Effect.fn('authOidc.configuration')(function* (provider: {
  readonly providerId: string
  readonly version: number
  readonly config: Readonly<Record<string, unknown>>
  readonly secret: (key: string) => Effect.Effect<Redacted.Redacted<string>, unknown>
}) {
  const settings = settingsOf(provider.config)
  if (settings === undefined) return undefined
  const secret = yield* provider.secret('clientSecret').pipe(Effect.option)
  if (secret._tag === 'None') return undefined
  const outbound = yield* AuthOutbound
  const made = yield* Effect.tryPromise(() =>
    configurationFor(
      `${provider.providerId}:${provider.version}`,
      settings,
      Redacted.value(secret.value),
      outbound,
    ),
  ).pipe(Effect.result)
  return made._tag === 'Failure'
    ? ({ kind: 'failed', settings, failure: sortFailure(made.failure.cause) } as const)
    : ({ kind: 'ready', settings, config: made.success } as const)
})

const handlers = HttpApiBuilder.group(local, 'authOidc', (handlers) =>
  handlers
    .handle(
      'start',
      Effect.fn('authOidc.start')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'oidc',
        })
        if (provider === undefined) return failed(new SignInMethodUnavailable())
        const viewer = (yield* CurrentViewer).principal
        const binding = query.intent === 'bind'
        if (binding && viewer === undefined) return failed(new AuthRequired())
        const configured = yield* configurationOf(provider)
        if (configured === undefined) return failed(new SignInMethodUnavailable())
        if (configured.kind === 'failed') {
          yield* Effect.logWarning('oidc provider could not be configured').pipe(
            Effect.annotateLogs({ provider: provider.code, reason: configured.failure.reason }),
          )
          return failed(new OidcUnavailable())
        }
        const callback = yield* sessions.callbackUrl(provider).pipe(Effect.option)
        if (callback._tag === 'None') return failed(new SignInMethodUnavailable())
        const { verifier, challenge, nonce } = yield* Effect.promise(beginning)
        // a sign-in asked for afresh: the provider is told to ask for the
        // credentials whatever session it keeps, and the moment of asking is
        // kept to hold its answer against
        const afresh = query.intent === 'reauthenticate'
        const carried: Carried = {
          verifier,
          nonce,
          ...(afresh ? { askedAt: Math.floor(Date.now() / 1000) } : {}),
        }
        const started = yield* sessions
          .startFlow({
            provider,
            purpose: binding ? 'bind' : 'login',
            ...(binding
              ? { binding: { userId: viewer!.userId, sessionId: viewer!.sessionId } }
              : {}),
            ...(query.returnTo === undefined ? {} : { returnPath: query.returnTo }),
            payload: Redacted.make(JSON.stringify(carried)),
          })
          .pipe(Effect.result)
        if (started._tag === 'Failure') {
          const refusal = started.failure
          // a bind goes back to the page it was asked from, and says why there
          const refused = (failure: {
            readonly _tag: string
            readonly retryAfterSeconds?: number
          }) =>
            binding ? away(failureLocation(query.returnTo ?? '/', failure), 303) : failed(failure)
          return refusal._tag === 'TOO_MANY_ATTEMPTS' ||
            refusal._tag === 'AUTH_REAUTHENTICATION_REQUIRED'
            ? refused(refusal)
            : refused(new SignInMethodUnavailable())
        }
        return away(
          authorizeRedirect(configured.config, {
            callback: callback.value.toString(),
            scope: configured.settings.scope,
            state: Redacted.value(started.success.state),
            challenge,
            nonce,
            afresh,
          }),
        )
      }),
    )
    .handle(
      'callback',
      Effect.fn('authOidc.callback')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const request = yield* HttpServerRequest.HttpServerRequest
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'oidc',
        })
        if (provider === undefined) return failed(new SignInMethodUnavailable())
        if (query.state === undefined) return failed(new SignInFlowRejected())
        const taken = yield* sessions
          .consumeFlow({ provider, state: query.state })
          .pipe(Effect.result)
        const carried =
          taken._tag === 'Success' && taken.success.payload !== undefined
            ? carriedOf(taken.success.payload)
            : undefined
        if (taken._tag === 'Failure' || carried === undefined) {
          return failed(new SignInFlowRejected())
        }
        const flow = taken.success
        const back = (failure: { readonly _tag: string }) =>
          flow.purpose === 'bind'
            ? away(failureLocation(flow.returnPath ?? '/', failure), 303)
            : failed(failure)

        const configured = yield* configurationOf(provider)
        if (configured === undefined) return back(new SignInMethodUnavailable())
        if (configured.kind === 'failed') return back(new OidcUnavailable())
        const callback = yield* sessions.callbackUrl(provider).pipe(Effect.option)
        if (callback._tag === 'None') return back(new SignInMethodUnavailable())
        // the address the provider sent the person back to, under the public
        // origin it was issued with: the library reads the response from it
        // and checks the redirect it was issued to
        const returned = new URL(request.url, callback.value.origin)
        const answer = yield* Effect.promise(() =>
          identify(configured.config, returned, {
            verifier: carried.verifier,
            state: query.state!,
            nonce: carried.nonce,
          }),
        )
        if (answer.kind !== 'account') {
          yield* Effect.logWarning('oidc provider did not name an account').pipe(
            Effect.annotateLogs({ provider: provider.code, reason: answer.reason }),
          )
          if (flow.purpose === 'login') {
            yield* sessions.failAttempt(provider, {
              reason: answer.kind === 'rejected' ? 'external-rejected' : 'external-unavailable',
            })
          }
          return back(answer.kind === 'rejected' ? new OidcRejected() : new OidcUnavailable())
        }

        if (flow.purpose === 'bind') {
          const bound = yield* sessions
            .bindSubject({
              provider,
              flow,
              subject: answer.subject,
              ...(answer.label === undefined ? {} : { displayLabel: answer.label }),
            })
            .pipe(Effect.result)
          if (bound._tag === 'Failure') return back(bindFailure(bound.failure.reason))
          return away(flow.returnPath ?? '/', 303)
        }

        const binding = yield* sessions.findBindingBySubject({
          tenantId: provider.tenantId,
          providerId: provider.providerId,
          subject: answer.subject,
        })
        if (binding === undefined) {
          yield* sessions.failAttempt(provider, { reason: 'binding-not-found' })
          return failed(new ExternalAccountUnbound())
        }
        // asked for afresh, and the provider says the person authenticated
        // after the asking: that is them at the keyboard now. A provider that
        // let an older session through signs the person in all the same, and
        // that sign-in shows nothing more than any other
        const present =
          carried.askedAt !== undefined &&
          answer.authTime !== undefined &&
          answer.authTime >= carried.askedAt - configured.settings.clockSkewSeconds
        if (carried.askedAt !== undefined && !present) {
          yield* Effect.logInfo(
            'oidc provider answered a fresh sign-in with an earlier authentication',
          ).pipe(Effect.annotateLogs({ provider: provider.code }))
        }
        const user = yield* sessions.completeLogin({
          tenantId: provider.tenantId,
          providerId: provider.providerId,
          userId: binding.userId,
          bindingId: binding.id,
          ...(answer.label === undefined ? {} : { bindingDisplayLabel: answer.label }),
          present,
        })
        if (user === undefined) return failed(new SignInPersonNotFound())
        return away(flow.returnPath ?? '/', 303)
      }),
    ),
)

const plugin = Plugin.define(
  '@qualy/plugin-auth-oidc',
  { dependsOn: ['@qualy/plugin-auth'] },
  Login.driver(driver),
  ApiFeature.group(authOidcApiGroup, handlers),
)

export default plugin

export const apiHandlers = handlers
