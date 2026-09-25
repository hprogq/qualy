import { Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/unstable/httpapi'
import { LoginSessions, type EntranceField, type LoginDriver } from '@qualy/auth-contract/login'
import { Login } from '@qualy/auth-contract/plugin'
import {
  SignInFlowRejected,
  SignInMethodUnavailable,
  SignInPersonNotFound,
  signInFailureLocation,
} from '@qualy/auth-contract/sign-in-failure'
import { Api } from '@qualy/api-kit/local'
import { Api as ApiFeature } from '@qualy/api-kit/plugin'
import { message } from '@qualy/i18n-contract'
import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import {
  authCasApiGroup,
  CasResponseInvalid,
  CasTicketRejected,
  CasUpstreamUnavailable,
} from './api.ts'
import { settingsFrom, settingsOf } from './protocol/settings.ts'
import {
  businessNoOf,
  isServiceTicket,
  loginRedirect,
  serviceFor,
  validateTicket,
} from './protocol/validate.ts'

// Signing in through a CAS server: send the person there, take the ticket it
// sends them back with, ask the server who the ticket is for, and find that
// person here by their person identifier.
//
// The ticket is proof of nothing until the server confirms it, and the server
// confirms it only for the exact service address it was issued to, so that
// address is written once when the flow starts and kept in the flow. The flow
// in turn is what ties a return to a departure from this browser. Nobody is
// created or changed by signing in: a person the directory does not have is
// told so, and what the server says about them beyond the identifier is read
// for this request and forgotten.

const local = Api.local(authCasApiGroup)
const urls = HttpApiClient.urlBuilder(local)

const say = (id: string, fallback: string) => message(`auth-cas/${id}`, fallback)

const choice = (value: string, id: string, fallback: string) => ({
  value,
  label: say(`field/${id}`, fallback),
})

/** what an administrator is asked, in the order the form asks it */
const fields: readonly EntranceField[] = [
  {
    key: 'serverUrl',
    label: say('field/server-url', 'CAS server address'),
    hint: say(
      'field/server-url-hint',
      'The address the server’s pages sit under, such as https://cas.example.edu/cas',
    ),
    kind: 'url',
    required: true,
  },
  {
    key: 'protocol',
    label: say('field/protocol', 'Protocol'),
    kind: 'choice',
    required: true,
    options: [
      choice('cas3', 'protocol-cas3', 'CAS 3.0'),
      choice('cas2', 'protocol-cas2', 'CAS 2.0'),
      choice('cas1', 'protocol-cas1', 'CAS 1.0'),
      choice('custom', 'protocol-custom', 'Custom addresses'),
    ],
    defaultValue: 'cas3',
  },
  {
    key: 'identitySource',
    label: say('field/identity-source', 'Person identifier'),
    kind: 'choice',
    required: true,
    options: [
      choice('principal', 'identity-principal', 'The name they sign in with'),
      choice('attribute', 'identity-attribute-choice', 'An attribute the server returns'),
    ],
    defaultValue: 'principal',
  },
  {
    key: 'identityAttribute',
    label: say('field/attribute-name', 'Attribute name'),
    hint: say('field/attribute-name-hint', 'Exactly as the server spells it, such as id_number'),
    kind: 'text',
    required: true,
    visibleWhen: { field: 'identitySource', equals: 'attribute' },
  },
  {
    key: 'identityFallback',
    label: say('field/fallback', 'Use the sign-in name when the attribute is missing'),
    kind: 'toggle',
    required: false,
    defaultValue: false,
    visibleWhen: { field: 'identitySource', equals: 'attribute' },
  },
  {
    key: 'loginUrl',
    label: say('field/login-url', 'Sign-in address'),
    hint: say(
      'field/custom-hint',
      'Leave empty to use the CAS 3.0 address under the server address',
    ),
    kind: 'url',
    required: false,
    section: 'advanced',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'validateUrl',
    label: say('field/validate-url', 'Ticket validation address'),
    hint: say(
      'field/custom-hint',
      'Leave empty to use the CAS 3.0 address under the server address',
    ),
    kind: 'url',
    required: false,
    section: 'advanced',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'validateMethod',
    label: say('field/validate-method', 'Validation request'),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [choice('GET', 'validate-get', 'GET'), choice('POST', 'validate-post', 'POST form')],
    defaultValue: 'GET',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'responseFormat',
    label: say('field/response-format', 'Answer format'),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [
      choice('auto', 'format-auto', 'Detect'),
      choice('xml', 'format-xml', 'XML'),
      choice('json', 'format-json', 'JSON'),
    ],
    defaultValue: 'auto',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'renew',
    label: say('field/renew', 'Ask for the password every time'),
    kind: 'toggle',
    required: false,
    section: 'advanced',
    defaultValue: false,
  },
]

export const driver: LoginDriver = {
  type: 'cas',
  icon: 'campus',
  presentation: {
    mode: 'redirect',
    href: ({ code }) => urls.authCas.start({ params: { providerCode: code }, query: {} }),
  },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: say('entrance/kind', 'CAS single sign-on'),
      fields,
      // which server is believed, and where in its answer the person's
      // number is read: once somebody has come in, another answer to either
      // would let a different server, or a different attribute, name them
      identityNamespaceKeys: [
        'serverUrl',
        'protocol',
        'loginUrl',
        'validateUrl',
        'identitySource',
        'identityAttribute',
        'identityFallback',
      ],
      // the protocol version expanded into the endpoints it stands for, so
      // what an entrance in service calls is what was saved
      prepareConfig: ({ values }) => {
        const worked = settingsFrom(values)
        return Effect.succeed(
          !worked.ok
            ? worked
            : worked.settings === undefined
              ? { ok: true as const }
              : { ok: true as const, derived: { ...worked.settings } },
        )
      },
    },
  },
  // the person identifier the server's answer names, never a stored binding
  resolution: { mode: 'user-field', field: 'businessNo' },
  callback: ({ code }) => urls.authCas.callback({ params: { providerCode: code }, query: {} }),
  // an entrance told to ask for the password every time - on the way out,
  // and again when the ticket is validated - signs in only somebody who
  // just typed it, never a session the server was keeping
  provesPresence: ({ config }) => settingsOf(config)?.renew === true,
}

/** the person is sent somewhere; every answer here is one */
const away = (location: string, status: 302 | 303 = 302) =>
  HttpServerResponse.redirect(location, { status })

/** back to the sign-in page, which says why */
const failed = (failure: { readonly _tag: string; readonly retryAfterSeconds?: number }) =>
  away(signInFailureLocation(failure), 303)

const handlers = HttpApiBuilder.group(local, 'authCas', (handlers) =>
  handlers
    .handle(
      'start',
      Effect.fn('authCas.start')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'cas',
        })
        const settings = provider === undefined ? undefined : settingsOf(provider.config)
        if (provider === undefined || settings === undefined) {
          return failed(new SignInMethodUnavailable())
        }
        const callback = yield* sessions.callbackUrl(provider).pipe(Effect.option)
        if (callback._tag === 'None') return failed(new SignInMethodUnavailable())
        // written once, from the state the flow is issued under, and kept in
        // the flow: validation sends this same string back
        let service = ''
        const started = yield* sessions
          .startFlow({
            provider,
            purpose: 'login',
            ...(query.returnTo === undefined ? {} : { returnPath: query.returnTo }),
            payload: (state) => {
              service = serviceFor(callback.value, Redacted.value(state))
              return Redacted.make(service)
            },
          })
          .pipe(Effect.result)
        if (started._tag === 'Failure') {
          const refusal = started.failure
          return refusal._tag === 'TOO_MANY_ATTEMPTS'
            ? failed(refusal)
            : failed(new SignInMethodUnavailable())
        }
        return away(loginRedirect(settings, service))
      }),
    )
    .handle(
      'callback',
      Effect.fn('authCas.callback')(function* ({ params, query }) {
        const sessions = yield* LoginSessions
        const provider = yield* sessions.resolveProvider({
          providerCode: params.providerCode,
          expectedType: 'cas',
        })
        const settings = provider === undefined ? undefined : settingsOf(provider.config)
        if (provider === undefined || settings === undefined) {
          return failed(new SignInMethodUnavailable())
        }
        if (query.flow === undefined) return failed(new SignInFlowRejected())
        const taken = yield* sessions
          .consumeFlow({ provider, state: query.flow })
          .pipe(Effect.result)
        if (taken._tag === 'Failure' || taken.success.payload === undefined) {
          return failed(new SignInFlowRejected())
        }
        const flow = taken.success
        // a return without a ticket - the person gave up, or the server
        // declined to sign them in - and anything that is not a service
        // ticket are refused without asking the server
        if (query.ticket === undefined || !isServiceTicket(query.ticket)) {
          yield* sessions.failAttempt(provider, { reason: 'external-rejected' })
          return failed(new CasTicketRejected())
        }
        const answer = yield* validateTicket(settings, Redacted.value(flow.payload!), query.ticket)
        if (answer.kind === 'unavailable') {
          yield* Effect.logWarning('cas validation did not answer').pipe(
            Effect.annotateLogs({ provider: provider.code, reason: answer.reason }),
          )
          yield* sessions.failAttempt(provider, { reason: 'external-unavailable' })
          return failed(new CasUpstreamUnavailable())
        }
        if (answer.kind === 'unreadable') {
          yield* Effect.logWarning(
            'cas validation answered in a form this driver cannot read',
          ).pipe(Effect.annotateLogs({ provider: provider.code }))
          yield* sessions.failAttempt(provider, { reason: 'external-invalid' })
          return failed(new CasResponseInvalid())
        }
        if (answer.kind === 'failure') {
          // the server's own code, which says nothing about the person
          yield* Effect.logInfo('cas refused a ticket').pipe(
            Effect.annotateLogs({ provider: provider.code, code: answer.code }),
          )
          yield* sessions.failAttempt(provider, { reason: 'external-rejected' })
          return failed(new CasTicketRejected())
        }
        const businessNo = businessNoOf(answer.principal, settings.identity)
        const person =
          businessNo === undefined
            ? undefined
            : yield* sessions.findUserByField({
                tenantId: provider.tenantId,
                providerId: provider.providerId,
                field: 'businessNo',
                value: businessNo,
              })
        if (person === undefined) {
          yield* sessions.failAttempt(provider, { reason: 'user-not-found' })
          return failed(new SignInPersonNotFound())
        }
        const user = yield* sessions.completeLogin({
          tenantId: provider.tenantId,
          providerId: provider.providerId,
          userId: person.userId,
        })
        // an account that may not come in was recorded with its reason
        if (user === undefined) return failed(new SignInPersonNotFound())
        return away(flow.returnPath ?? '/', 303)
      }),
    ),
)

const plugin = Plugin.define(
  '@qualy/plugin-auth-cas',
  { dependsOn: ['@qualy/plugin-auth'] },
  Ui.i18n('./client/i18n'),
  Login.driver(driver),
  ApiFeature.group(authCasApiGroup, handlers),
)

export default plugin

export const apiHandlers = handlers
