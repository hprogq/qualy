import { Effect, Redacted } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/unstable/httpapi'
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
import { message } from '@qualy/i18n-contract'
import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { authOidcApiGroup, OidcRejected, OidcUnavailable } from './api.ts'
import {
  authorizeRedirect,
  beginning,
  configurationFor,
  identify,
  settingsOf,
  sortFailure,
} from './oidc.ts'

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

const say = (id: string, fallback: string) => message(`auth-oidc/${id}`, fallback)

const choice = (value: string, id: string, fallback: string) => ({
  value,
  label: say(`field/${id}`, fallback),
})

const manual = { field: 'discoveryMode', equals: 'manual' } as const

const fields: readonly EntranceField[] = [
  {
    key: 'issuer',
    label: say('field/issuer', 'Issuer'),
    hint: say('field/issuer-hint', 'The provider’s address, exactly as its tokens name it'),
    kind: 'url',
    required: true,
  },
  {
    key: 'discoveryMode',
    label: say('field/discovery', 'Endpoints'),
    kind: 'choice',
    required: true,
    options: [
      choice('discovery', 'discovery-auto', 'Discover from the issuer'),
      choice('manual', 'discovery-manual', 'Enter by hand'),
    ],
    defaultValue: 'discovery',
  },
  {
    key: 'authorizationEndpoint',
    label: say('field/authorization-endpoint', 'Authorization endpoint'),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'tokenEndpoint',
    label: say('field/token-endpoint', 'Token endpoint'),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'jwksUri',
    label: say('field/jwks-uri', 'Key set (JWKS) address'),
    kind: 'url',
    required: true,
    visibleWhen: manual,
  },
  {
    key: 'userinfoEndpoint',
    label: say('field/userinfo-endpoint', 'UserInfo endpoint'),
    kind: 'url',
    required: false,
    visibleWhen: manual,
  },
  {
    key: 'clientId',
    label: say('field/client-id', 'Client ID'),
    kind: 'text',
    required: true,
  },
  {
    key: 'clientSecret',
    label: say('field/client-secret', 'Client secret'),
    kind: 'secret',
    required: true,
  },
  {
    key: 'scopes',
    label: say('field/scopes', 'Scopes'),
    hint: say('field/scopes-hint', 'Separated by spaces; openid is always asked for. Empty means openid profile email'),
    kind: 'text',
    required: false,
    section: 'advanced',
  },
  {
    key: 'tokenAuthMethod',
    label: say('field/token-auth', 'Client authentication'),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [
      choice('auto', 'token-auth-auto', 'Automatic'),
      choice('basic', 'token-auth-basic', 'HTTP Basic'),
      choice('post', 'token-auth-post', 'In the request body'),
    ],
    defaultValue: 'auto',
  },
  {
    key: 'clockSkewSeconds',
    label: say('field/clock-skew', 'Clock tolerance, in seconds'),
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
  type: 'oidc',
  presentation: {
    mode: 'redirect',
    href: ({ code }) => urls.authOidc.start({ params: { providerCode: code }, query: {} }),
  },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: say('entrance/kind', 'OpenID Connect'),
      fields,
      // a `sub` means one account to one issuer, and may mean another to
      // another client of it (pairwise subjects); the endpoints do not count
      identityNamespaceKeys: ['issuer', 'clientId'],
    },
  },
  resolution: { mode: 'binding-subject' },
  binding: {
    mode: 'self',
    start: ({ code }) =>
      urls.authOidc.start({ params: { providerCode: code }, query: { intent: 'bind' } }),
  },
  callback: ({ code }) => urls.authOidc.callback({ params: { providerCode: code }, query: {} }),
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
}

const carriedOf = (payload: Redacted.Redacted<string>): Carried | undefined => {
  try {
    const parsed = JSON.parse(Redacted.value(payload)) as Partial<Carried>
    return typeof parsed.verifier === 'string' && typeof parsed.nonce === 'string'
      ? { verifier: parsed.verifier, nonce: parsed.nonce }
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
        const started = yield* sessions
          .startFlow({
            provider,
            purpose: binding ? 'bind' : 'login',
            ...(binding
              ? { binding: { userId: viewer!.userId, sessionId: viewer!.sessionId } }
              : {}),
            ...(query.returnTo === undefined ? {} : { returnPath: query.returnTo }),
            payload: Redacted.make(JSON.stringify({ verifier, nonce } satisfies Carried)),
          })
          .pipe(Effect.result)
        if (started._tag === 'Failure') {
          const refusal = started.failure
          return refusal._tag === 'TOO_MANY_ATTEMPTS'
            ? failed(refusal)
            : failed(new SignInMethodUnavailable())
        }
        return away(
          authorizeRedirect(configured.config, {
            callback: callback.value.toString(),
            scope: configured.settings.scope,
            state: Redacted.value(started.success.state),
            challenge,
            nonce,
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
        const user = yield* sessions.completeLogin({
          tenantId: provider.tenantId,
          providerId: provider.providerId,
          userId: binding.userId,
          bindingId: binding.id,
          ...(answer.label === undefined ? {} : { bindingDisplayLabel: answer.label }),
        })
        if (user === undefined) return failed(new SignInPersonNotFound())
        return away(flow.returnPath ?? '/', 303)
      }),
    ),
)

const plugin = Plugin.define(
  '@qualy/plugin-auth-oidc',
  { dependsOn: ['@qualy/plugin-auth'] },
  Ui.i18n('./client/i18n'),
  Login.driver(driver),
  ApiFeature.group(authOidcApiGroup, handlers),
)

export default plugin

export const apiHandlers = handlers
