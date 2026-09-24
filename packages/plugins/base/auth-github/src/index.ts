import { Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/unstable/httpapi'
import {
  LoginSessions,
  type BindingRejection,
  type EntranceField,
  type LoginDriver,
} from '@qualy/auth-contract/login'
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
import { authGithubApiGroup, GithubRejected, GithubUnavailable } from './api.ts'
import { authorizeRedirect, endpointsOf, identify, pkce } from './oauth.ts'

// Signing in with a GitHub account, and binding one to yourself.
//
// A thin OAuth web flow written here rather than a general client: the
// authorization code with a mandatory S256 challenge, the code traded for a
// token, the token asked who it is for, and the token dropped. The account's
// numeric id is the subject; its login is only what the account is called,
// refreshed on every sign-in because its owner can rename it any day.
//
// Nobody is found by email and nobody is created. An account nobody has
// bound signs nobody in: the person binds it from their own account first,
// signed in some other way, and the binding is written for whoever began
// that flow - never for anybody the callback names.

const local = Api.local(authGithubApiGroup)
const urls = HttpApiClient.urlBuilder(local)

const say = (id: string, fallback: string) => message(`auth-github/${id}`, fallback)

const fields: readonly EntranceField[] = [
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
    key: 'enterpriseUrl',
    label: say('field/enterprise-url', 'GitHub Enterprise Server address'),
    hint: say('field/enterprise-url-hint', 'Leave empty for github.com'),
    kind: 'url',
    required: false,
    section: 'advanced',
  },
]

export const driver: LoginDriver = {
  type: 'github',
  icon: 'github',
  presentation: {
    mode: 'redirect',
    href: ({ code }) => urls.authGithub.start({ params: { providerCode: code }, query: {} }),
  },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: say('entrance/kind', 'GitHub'),
      fields,
      // an account id means one account on one server; on another server
      // the same number is somebody else
      identityNamespaceKeys: ['enterpriseUrl'],
    },
  },
  resolution: { mode: 'binding-subject' },
  binding: {
    mode: 'self',
    start: ({ code }) =>
      urls.authGithub.start({ params: { providerCode: code }, query: { intent: 'bind' } }),
  },
  callback: ({ code }) => urls.authGithub.callback({ params: { providerCode: code }, query: {} }),
}

const away = (location: string, status: 302 | 303 = 302) =>
  HttpServerResponse.redirect(location, { status })

/** back to the sign-in page, which says why */
const failed = (failure: { readonly _tag: string; readonly retryAfterSeconds?: number }) =>
  away(signInFailureLocation(failure), 303)

/** the settings as a GitHub entrance reads them */
const settingsOf = (config: Readonly<Record<string, unknown>>) => {
  const clientId = typeof config['clientId'] === 'string' ? config['clientId'] : undefined
  const enterprise =
    typeof config['enterpriseUrl'] === 'string' ? config['enterpriseUrl'] : undefined
  return clientId === undefined ? undefined : { clientId, endpoints: endpointsOf(enterprise) }
}

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

const handlers = HttpApiBuilder.group(local, 'authGithub', (handlers) =>
  handlers
    .handle(
      'start',
      Effect.fn('authGithub.start')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'github',
        })
        const settings = provider === undefined ? undefined : settingsOf(provider.config)
        if (provider === undefined || settings === undefined) {
          return failed(new SignInMethodUnavailable())
        }
        // a bind is for whoever is signed in, in the session they are in
        const viewer = (yield* CurrentViewer).principal
        const binding = query.intent === 'bind'
        if (binding && viewer === undefined) return failed(new AuthRequired())
        const callback = yield* sessions.callbackUrl(provider).pipe(Effect.option)
        if (callback._tag === 'None') return failed(new SignInMethodUnavailable())
        const { verifier, challenge } = pkce()
        const started = yield* sessions
          .startFlow({
            provider,
            purpose: binding ? 'bind' : 'login',
            ...(binding
              ? { binding: { userId: viewer!.userId, sessionId: viewer!.sessionId } }
              : {}),
            ...(query.returnTo === undefined ? {} : { returnPath: query.returnTo }),
            payload: Redacted.make(verifier),
          })
          .pipe(Effect.result)
        if (started._tag === 'Failure') {
          const refusal = started.failure
          return refusal._tag === 'TOO_MANY_ATTEMPTS'
            ? failed(refusal)
            : failed(new SignInMethodUnavailable())
        }
        return away(
          authorizeRedirect(settings.endpoints, {
            clientId: settings.clientId,
            callback: callback.value.toString(),
            state: Redacted.value(started.success.state),
            challenge,
          }),
        )
      }),
    )
    .handle(
      'callback',
      Effect.fn('authGithub.callback')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'github',
        })
        const settings = provider === undefined ? undefined : settingsOf(provider.config)
        if (provider === undefined || settings === undefined) {
          return failed(new SignInMethodUnavailable())
        }
        if (query.state === undefined) return failed(new SignInFlowRejected())
        const taken = yield* sessions
          .consumeFlow({ provider, state: query.state })
          .pipe(Effect.result)
        if (taken._tag === 'Failure' || taken.success.payload === undefined) {
          return failed(new SignInFlowRejected())
        }
        const flow = taken.success
        // a bind goes back to where it was asked from, a sign-in to the door
        const back = (failure: { readonly _tag: string }) =>
          flow.purpose === 'bind'
            ? away(failureLocation(flow.returnPath ?? '/', failure), 303)
            : failed(failure)

        if (query.error !== undefined || query.code === undefined) {
          if (flow.purpose === 'login') {
            yield* sessions.failAttempt(provider, { reason: 'external-rejected' })
          }
          return back(new GithubRejected())
        }
        const clientSecret = yield* provider.secret('clientSecret').pipe(Effect.option)
        if (clientSecret._tag === 'None') return back(new SignInMethodUnavailable())
        const callback = yield* sessions.callbackUrl(provider).pipe(Effect.option)
        if (callback._tag === 'None') return back(new SignInMethodUnavailable())

        const answer = yield* identify(settings.endpoints, {
          clientId: settings.clientId,
          clientSecret: clientSecret.value,
          code: query.code,
          verifier: Redacted.value(flow.payload!),
          callback: callback.value.toString(),
        })
        if (answer.kind !== 'account') {
          yield* Effect.logWarning('github did not name an account').pipe(
            Effect.annotateLogs({ provider: provider.code, reason: answer.reason }),
          )
          if (flow.purpose === 'login') {
            yield* sessions.failAttempt(provider, {
              reason: answer.kind === 'rejected' ? 'external-rejected' : 'external-unavailable',
            })
          }
          return back(answer.kind === 'rejected' ? new GithubRejected() : new GithubUnavailable())
        }

        if (flow.purpose === 'bind') {
          const bound = yield* sessions
            .bindSubject({ provider, flow, subject: answer.subject, displayLabel: answer.login })
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
          bindingDisplayLabel: answer.login,
        })
        if (user === undefined) return failed(new SignInPersonNotFound())
        return away(flow.returnPath ?? '/', 303)
      }),
    ),
)

const plugin = Plugin.define(
  '@qualy/plugin-auth-github',
  { dependsOn: ['@qualy/plugin-auth'] },
  Ui.i18n('./client/i18n'),
  Login.driver(driver),
  ApiFeature.group(authGithubApiGroup, handlers),
)

export default plugin

export const apiHandlers = handlers
