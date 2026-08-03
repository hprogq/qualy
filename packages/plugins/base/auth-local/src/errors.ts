import { defineDomainErrors } from '@qualy/api-contract'

// uniform credential failure: never distinguishes unknown identifier from
// wrong password (timing is equalized in the handler as well)
export const authLocalErrors = defineDomainErrors({
  INVALID_CREDENTIALS: { status: 401, message: 'invalid credentials' },
})
