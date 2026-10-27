import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalJWKSet, importJWK, type CryptoKey, type JWK } from 'jose'
import { run as keygen } from '../src/cli/edge-keygen.ts'
import { run as build } from '../src/cli/edge-build.ts'
import { signGrant, verifyGrant } from '../src/edgeone/protocol.ts'

// What an operator runs to set up an EdgeOne delivery. The private key is
// the one thing here that must never be printed or left readable; the public
// key and the script are what get pasted elsewhere, and both have to work
// with what the server signs.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-edgeone-cli-'))
afterEach(() => vi.restoreAllMocks())

const printed = () => {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void lines.push(String(line)))
  return lines
}

describe('qualy cos edge-keygen', () => {
  it('writes the private half for the owner only, prints the public half, and the two pair', async () => {
    const out = path.join(scratch, 'signing.jwk')
    const lines = printed()
    await keygen({ args: ['--private-out', out, '--kid', 'download-test'] })

    expect(fs.statSync(out).mode & 0o777).toBe(0o600)
    const secret = JSON.parse(fs.readFileSync(out, 'utf8')) as JWK
    expect(secret).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'download-test', alg: 'ES256' })
    expect(lines.join('\n')).not.toContain(secret.d!)

    const jwks = JSON.parse(lines.at(-1)!) as { keys: JWK[] }
    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0]!.d).toBeUndefined()

    const issuedAt = Math.floor(Date.now() / 1000)
    const token = await signGrant({
      signing: { key: (await importJWK(secret, 'ES256')) as CryptoKey, kid: secret.kid! },
      issuer: 'https://qualy.example.cn',
      audience: 'https://files.qualy.example.cn',
      issuedAt,
      lifetime: 60,
      grant: {
        key: 'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002',
        revision: null,
        filename: 'a.pdf',
        mime: 'application/pdf',
      },
    })
    const verified = await verifyGrant(token, {
      keys: createLocalJWKSet(jwks),
      issuer: 'https://qualy.example.cn',
      audience: 'https://files.qualy.example.cn',
      now: issuedAt,
    })
    expect(verified.ok).toBe(true)
  })

  it('refuses to print a private key, or to overwrite one', async () => {
    await expect(keygen({ args: [] })).rejects.toThrow(/--private-out/)
    const out = path.join(scratch, 'existing.jwk')
    fs.writeFileSync(out, 'kept')
    await expect(keygen({ args: ['--private-out', out] })).rejects.toThrow(/already exists/)
    expect(fs.readFileSync(out, 'utf8')).toBe('kept')
  })
})

describe('qualy cos edge-build', () => {
  it('writes the one script the platform runs', async () => {
    const out = path.join(scratch, 'delivery.js')
    printed()
    await build({ args: ['--out', out] })
    const script = fs.readFileSync(out, 'utf8')
    expect(script).toMatch(/addEventListener\(["']fetch["']/)
    expect(script).not.toMatch(/^\s*import\s/m)
  })
})
