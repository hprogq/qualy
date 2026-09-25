import { Effect, Logger } from 'effect'
import { describe, expect, it } from 'vitest'
import { reportSecretHealth, type SecretHealth } from '../src/server/secret-health.ts'

// What start says about entrance secrets that no longer decrypt: each door on
// its own, and the master key once that is the likelier story - every stored
// secret failing at once, or several of them.

const said = async (health: SecretHealth) => {
  const lines: { level: string; message: string }[] = []
  const capture = Logger.layer([
    Logger.make((options) => {
      lines.push({ level: options.logLevel, message: String(options.message) })
    }),
  ])
  await Effect.runPromise(reportSecretHealth(health).pipe(Effect.provide(capture)))
  return lines
}

const door = (providerCode: string) => ({
  tenantSlug: 'default',
  providerCode,
  key: 'clientSecret',
})

describe('entrance secrets that do not decrypt', () => {
  it('are named door by door, and nothing is said when every one opens', async () => {
    expect(await said({ stored: 4, unreadable: [] })).toEqual([])
    const one = await said({ stored: 4, unreadable: [door('cas')] })
    expect(one.map((line) => line.level)).toEqual(['Warn'])
    expect(one[0]!.message).toContain('default/cas')
  })

  it('point at the master key when all of them, or several, fail at once', async () => {
    const all = await said({ stored: 2, unreadable: [door('cas'), door('oidc')] })
    expect(all.map((line) => line.level)).toEqual(['Warn', 'Warn', 'Error'])
    expect(all[2]!.message).toContain('QUALY_SECRETS_MASTER_KEY')
    const several = await said({
      stored: 9,
      unreadable: [door('a'), door('b'), door('c')],
    })
    expect(several.at(-1)).toMatchObject({ level: 'Error' })
  })
})
