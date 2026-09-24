import { Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { decodePluginConfig } from '../src/config.ts'

// A manifest block with a key its plugin does not read is refused, including
// the block of a plugin that reads none.

const decoded = (schema: Schema.Codec<unknown, unknown>, block: unknown) =>
  Effect.runPromiseExit(decodePluginConfig(schema, block))

const message = (exit: Exit.Exit<unknown, Schema.SchemaError>) =>
  Exit.isFailure(exit) ? String(exit.cause) : 'accepted'

describe('a plugin manifest block', () => {
  it('names a key the plugin does not read', async () => {
    const schema = Schema.Struct({ sampleRate: Schema.optional(Schema.Number) })
    expect(Exit.isSuccess(await decoded(schema, { sampleRate: 0.5 }))).toBe(true)
    expect(message(await decoded(schema, { sampleRtae: 0.5 }))).toContain('sampleRtae')
  })

  it('may be empty for a plugin that takes nothing, and nothing else', async () => {
    const none = Schema.Struct({})
    expect(Exit.isSuccess(await decoded(none, {}))).toBe(true)
    expect(message(await decoded(none, { apiKey: 're_committed' }))).toContain('apiKey')
    expect(Exit.isFailure(await decoded(none, 'yes'))).toBe(true)
    expect(Exit.isFailure(await decoded(none, []))).toBe(true)
  })
})
