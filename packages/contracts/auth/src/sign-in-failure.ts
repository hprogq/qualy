import { Schema } from 'effect'

// Where a sign-in that left this application lands when it did not work.
//
// A redirect driver's routes are addresses a browser is sent to, not calls a
// script makes, so a failure cannot come back as a response body: the person
// is sent to the sign-in page with the code in its address, and the page says
// it in their language. The codes every redirect driver shares are here; a
// driver's own (a CAS server refusing a ticket) are declared by the driver
// and read by the same page the same way.
//
// Nothing about the person is in the address: which of the account states
// refused them is for the sign-in record, not for whoever reads the URL.

/** the sign-in page, as the auth plugin declares it */
export const SIGN_IN_PAGE_PATH = '/login'

/** the entrance is not in service here, or cannot be used as it stands */
export class SignInMethodUnavailable extends Schema.TaggedError<SignInMethodUnavailable>()(
  'AUTH_METHOD_UNAVAILABLE',
  {},
  { httpApiStatus: 404, identifier: 'SignInMethodUnavailable' },
) {}

/** the return did not match a departure: expired, already used, or never issued */
export class SignInFlowRejected extends Schema.TaggedError<SignInFlowRejected>()(
  'AUTH_FLOW_REJECTED',
  {},
  { httpApiStatus: 400, identifier: 'SignInFlowRejected' },
) {}

/** the other side vouched for somebody this directory has no usable account for */
export class SignInPersonNotFound extends Schema.TaggedError<SignInPersonNotFound>()(
  'AUTH_PERSON_NOT_FOUND',
  {},
  { httpApiStatus: 403, identifier: 'SignInPersonNotFound' },
) {}

/** the other side vouched for an account nobody here has bound */
export class ExternalAccountUnbound extends Schema.TaggedError<ExternalAccountUnbound>()(
  'AUTH_EXTERNAL_ACCOUNT_UNBOUND',
  {},
  { httpApiStatus: 403, identifier: 'ExternalAccountUnbound' },
) {}

/** the account a bind brought back is already bound to somebody else */
export class BindingSubjectTaken extends Schema.TaggedError<BindingSubjectTaken>()(
  'AUTH_BINDING_SUBJECT_TAKEN',
  {},
  { httpApiStatus: 409, identifier: 'BindingSubjectTaken' },
) {}

/** the person already has an account bound at that entrance */
export class BindingAlreadyBound extends Schema.TaggedError<BindingAlreadyBound>()(
  'AUTH_BINDING_ALREADY_BOUND',
  {},
  { httpApiStatus: 409, identifier: 'BindingAlreadyBound' },
) {}

/**
 * A page of this application, told why the person is back on it.
 *
 * For a flow that did not start at the sign-in page - binding an account
 * from somebody's own account page - the page it started from is where it
 * ends, and says what happened there. Anything that is not a path inside
 * this application is the sign-in page instead.
 */
export const failureLocation = (
  path: string,
  failure: { readonly _tag: string; readonly retryAfterSeconds?: number },
): string => {
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(path, sentinel)
  } catch {
    return signInFailureLocation(failure)
  }
  if (!path.startsWith('/') || target.origin !== sentinel) return signInFailureLocation(failure)
  target.searchParams.set('error', failure._tag)
  if (failure.retryAfterSeconds !== undefined) {
    target.searchParams.set('retryAfter', String(failure.retryAfterSeconds))
  }
  return `${target.pathname}${target.search}`
}

/**
 * The sign-in page, told why the person is back on it.
 *
 * Takes the failure itself, so a refusal that says how long to wait - too
 * many attempts - carries that along.
 */
export const signInFailureLocation = (failure: {
  readonly _tag: string
  readonly retryAfterSeconds?: number
}): string => {
  const query = new URLSearchParams({ error: failure._tag })
  if (failure.retryAfterSeconds !== undefined) {
    query.set('retryAfter', String(failure.retryAfterSeconds))
  }
  return `${SIGN_IN_PAGE_PATH}?${query.toString()}`
}
