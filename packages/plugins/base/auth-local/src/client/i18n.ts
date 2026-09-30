import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as authLocalErrors from '../api.ts'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof authLocalErrors>>()({
  INVALID_CREDENTIALS: m.error_invalidCredentials,
}).registry

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'auth-local/binding/password': m.binding_password,
  'auth-local/entrance/kind': m.entrance_kind,
}
