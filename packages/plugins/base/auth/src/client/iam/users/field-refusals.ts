import { getApiErrorCode } from '@qualy/web-i18n'
import { normalizeEmail } from '@qualy/auth-contract/email'

// Which field of a person a refusal is about, when it is about one.
//
// A value somebody else in the tenant already holds is fixed in the field it
// was typed in, so it is said under that field; everything else a form was
// refused for is the form's to say above it.

export type PersonField = 'email' | 'businessNo'

export const refusedField = (error: unknown): PersonField | undefined => {
  const code = getApiErrorCode(error)
  if (code === 'USER_EMAIL_CONFLICT') return 'email'
  // the one unique index a person's write can hit besides the address
  if (code === 'USER_CONFLICT') return 'businessNo'
  return undefined
}

/** whether an address typed is one the directory would store; empty is not judged here */
export const emailShaped = (typed: string): boolean =>
  typed.trim() === '' || normalizeEmail(typed) !== null
