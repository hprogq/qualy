import { createHash, randomBytes } from 'node:crypto'

// opaque bearer token in an http-only cookie; the database only ever sees
// the sha256 of the raw value (decision record in STATUS: no jwt — instant
// revocation and xss immunity outweigh statelessness for a same-origin,
// single-process deployment)

export function createSessionToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashSessionToken(token) }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
