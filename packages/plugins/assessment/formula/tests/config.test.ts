import { describe, expect, it } from 'vitest'
import { ConfigProvider, Effect, Layer } from 'effect'
import { FormulaSettings, config } from '../src/server/config.ts'

// What the manifest block turns into, without a database or a sandbox. The
// one switch here decides whether a published formula may be newly bound to
// a question; it is read from the manifest and from nowhere else, and a
// manifest that says nothing has it off.

const configured = (declared: Record<string, unknown>, env: Record<string, string> = {}) =>
  Effect.runPromise(
    // one provide, not two: the config layer is built with the provider
    // already in place, the way the host builds it
    Effect.flatMap(FormulaSettings, Effect.succeed).pipe(
      Effect.provide(
        config(declared, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

describe('what the manifest decides about new formula bindings', () => {
  it('reads the switch from the block', async () => {
    expect((await configured({ authoring: true })).authoring).toBe(true)
    expect((await configured({ authoring: false })).authoring).toBe(false)
  })

  it('is off when the manifest is silent', async () => {
    // a deployment that has not said so has not opened the writer
    expect((await configured({})).authoring).toBe(false)
  })

  it('refuses a block it cannot read', async () => {
    // a key that looks applied and is not is the failure the channel exists
    // to prevent; a value of the wrong type is the same failure
    await expect(configured({ writer: true })).rejects.toThrow()
    await expect(configured({ authoring: 'yes' })).rejects.toThrow()
  })

  it('takes nothing from the environment', async () => {
    // opening the writer is a reviewed change to the manifest, never a
    // variable set on one machine
    expect((await configured({}, { QUALY_FORMULA_AUTHORING: 'true' })).authoring).toBe(false)
  })
})
