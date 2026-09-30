import { Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/http-api'
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
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'
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

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

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

/** what an administrator is asked, in the order the form asks it */
const fields: readonly EntranceField[] = [
  {
    key: 'serverUrl',
    label: text(m.field_serverUrl),
    hint: text(m.field_serverUrlHint),
    kind: 'url',
    required: true,
  },
  {
    key: 'protocol',
    label: text(m.field_protocol),
    kind: 'choice',
    required: true,
    options: [
      { value: 'cas3', label: text(m.field_protocolCas3) },
      { value: 'cas2', label: text(m.field_protocolCas2) },
      { value: 'cas1', label: text(m.field_protocolCas1) },
      { value: 'custom', label: text(m.field_protocolCustom) },
    ],
    defaultValue: 'cas3',
  },
  {
    key: 'identitySource',
    label: text(m.field_identitySource),
    kind: 'choice',
    required: true,
    options: [
      { value: 'principal', label: text(m.field_identityPrincipal) },
      { value: 'attribute', label: text(m.field_identityAttributeChoice) },
    ],
    defaultValue: 'principal',
  },
  {
    key: 'identityAttribute',
    label: text(m.field_attributeName),
    hint: text(m.field_attributeNameHint),
    kind: 'text',
    required: true,
    visibleWhen: { field: 'identitySource', equals: 'attribute' },
  },
  {
    key: 'identityFallback',
    label: text(m.field_fallback),
    kind: 'toggle',
    required: false,
    defaultValue: false,
    visibleWhen: { field: 'identitySource', equals: 'attribute' },
  },
  {
    key: 'loginUrl',
    label: text(m.field_loginUrl),
    hint: text(m.field_customHint),
    kind: 'url',
    required: false,
    section: 'advanced',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'validateUrl',
    label: text(m.field_validateUrl),
    hint: text(m.field_customHint),
    kind: 'url',
    required: false,
    section: 'advanced',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'validateMethod',
    label: text(m.field_validateMethod),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [
      { value: 'GET', label: text(m.field_validateGet) },
      { value: 'POST', label: text(m.field_validatePost) },
    ],
    defaultValue: 'GET',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'responseFormat',
    label: text(m.field_responseFormat),
    kind: 'choice',
    required: true,
    section: 'advanced',
    options: [
      { value: 'auto', label: text(m.field_formatAuto) },
      { value: 'xml', label: text(m.field_formatXml) },
      { value: 'json', label: text(m.field_formatJson) },
    ],
    defaultValue: 'auto',
    visibleWhen: { field: 'protocol', equals: 'custom' },
  },
  {
    key: 'renew',
    label: text(m.field_renew),
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
      label: text(m.entrance_kind),
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
          // the ticket was validated under these settings: with renew, the
          // server refuses one it issued from a standing session
          present: settings.renew === true,
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
