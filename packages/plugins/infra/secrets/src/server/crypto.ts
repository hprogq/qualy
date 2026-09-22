import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SecretRef } from '../plugin.ts'

// AES-256-GCM under the master key, with the reference as additional
// authenticated data.
//
// A fresh 96-bit nonce per encryption, which is the size GCM is specified
// for; the tag is the full 128 bits. The reference is bound in so that a
// ciphertext is only ever valid where it was written: copying a row onto
// another owner, or a sealed value into another flow, fails authentication
// rather than handing somebody else's secret over.

/** which master key sealed a value; stored beside it, for a rotation to read */
export const KEY_VERSION = 1

const ALGORITHM = 'aes-256-gcm'
export const NONCE_BYTES = 12
export const TAG_BYTES = 16

export interface Encrypted {
  readonly ciphertext: Uint8Array
  readonly nonce: Uint8Array
  readonly authTag: Uint8Array
}

/** what a ciphertext is bound to, in a form no two references share */
const aadOf = (ref: SecretRef) =>
  Buffer.from(
    ['qualy-secret', 'v1', ref.tenantId, ref.ownerKind, ref.ownerId, ref.key].join('\0'),
    'utf8',
  )

export const encrypt = (masterKey: Uint8Array, ref: SecretRef, plaintext: string): Encrypted => {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, masterKey, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aadOf(ref))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, nonce, authTag: cipher.getAuthTag() }
}

/** the plaintext, or undefined when the value does not authenticate */
export const decrypt = (
  masterKey: Uint8Array,
  ref: SecretRef,
  encrypted: Encrypted,
): string | undefined => {
  if (encrypted.nonce.length !== NONCE_BYTES || encrypted.authTag.length !== TAG_BYTES) {
    return undefined
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, encrypted.nonce, {
      authTagLength: TAG_BYTES,
    })
    decipher.setAAD(aadOf(ref))
    decipher.setAuthTag(encrypted.authTag)
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    return undefined
  }
}

/** one line of text: version, nonce, tag and ciphertext, each base64url */
export const encodeSealed = (encrypted: Encrypted) =>
  [
    `v${String(KEY_VERSION)}`,
    Buffer.from(encrypted.nonce).toString('base64url'),
    Buffer.from(encrypted.authTag).toString('base64url'),
    Buffer.from(encrypted.ciphertext).toString('base64url'),
  ].join('.')

export const decodeSealed = (text: string): Encrypted | undefined => {
  const parts = text.split('.')
  if (parts.length !== 4 || parts[0] !== `v${String(KEY_VERSION)}`) return undefined
  const [, nonce, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
  return { nonce: nonce!, authTag: authTag!, ciphertext: ciphertext! }
}
