import { createHash, randomBytes } from 'node:crypto'
import { stringifySetCookie } from 'cookie'

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

export interface CookieSettings {
  name: string
  secure: boolean
}

export function sessionCookie(settings: CookieSettings, token: string, expiresAt: Date): string {
  return stringifySetCookie({
    name: settings.name,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: settings.secure,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  })
}

export function clearSessionCookie(settings: CookieSettings): string {
  return stringifySetCookie({
    name: settings.name,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: settings.secure,
    maxAge: 0,
  })
}
