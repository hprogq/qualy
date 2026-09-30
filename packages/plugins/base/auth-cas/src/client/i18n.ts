import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as authCasErrors from '../api.ts'

import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof authCasErrors>>()({
  AUTH_CAS_TICKET_REJECTED: m.error_ticketRejected,
  AUTH_CAS_UPSTREAM_UNAVAILABLE: m.error_upstreamUnavailable,
  AUTH_CAS_RESPONSE_INVALID: m.error_responseInvalid,
}).registry
