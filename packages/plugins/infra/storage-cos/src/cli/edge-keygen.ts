import fs from 'node:fs'
import { exportJWK, generateKeyPair } from 'jose'
import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import { ALGORITHM } from '../edgeone/protocol.ts'

// `qualy cos edge-keygen --private-out <file> [--kid <name>]` - a key pair
// for EdgeOne download credentials.
//
// The private half signs and belongs to the server alone: it is written to
// the file named, readable by its owner only, to become
// QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY. The public half verifies and is not
// a secret: it is printed as the JWK Set the edge function's VERIFY_KEYS
// holds. Rotating means a new kid: publish the new public key beside the
// old one, switch the server, and drop the old key once the last credential
// signed with it has expired.

const valueOf = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return undefined
  const value = args[at + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new CliRefused(`--${name} needs a value`)
  }
  return value
}

const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '')

export async function run(context: CliContext): Promise<void> {
  const out = valueOf(context.args, 'private-out')
  if (out === undefined) {
    throw new CliRefused(
      'name the file the private key goes to with --private-out; it is never printed',
    )
  }
  if (fs.existsSync(out)) throw new CliRefused(`${out} already exists; nothing was overwritten`)
  const kid = valueOf(context.args, 'kid') ?? `download-${today()}`

  const { privateKey, publicKey } = await generateKeyPair(ALGORITHM, { extractable: true })
  const shape = { kid, alg: ALGORITHM, use: 'sig' }
  const secret = { ...(await exportJWK(privateKey)), ...shape }
  const published = { ...(await exportJWK(publicKey)), ...shape }

  fs.writeFileSync(out, `${JSON.stringify(secret)}\n`, { mode: 0o600, flag: 'wx' })
  console.log(
    `cos: private key ${kid} written to ${out} (for QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY)`,
  )
  console.log('cos: VERIFY_KEYS for the edge function:')
  console.log(JSON.stringify({ keys: [published] }))
}
