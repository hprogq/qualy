import { ConfigProvider, Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { apiReferenceEnabled } from '../src/config.ts'

// Who gets to read this deployment's api.
//
// The reference and the openapi document describe every endpoint, every
// parameter and every error of the assembly that is running - which is a
// map of what is installed. Useful to whoever operates it, and to nobody
// else, so production publishes neither unless a deployment says to.
//
// The default is the case that matters: a deployment sets PORT and a
// database url and nothing about documentation, and `auto` has to read
// that silence as off. It used to read it as on, which is how both were
// served in production for as long as the Effect port existed.

const exposed = (env: Record<string, string>) =>
  Effect.runPromise(
    apiReferenceEnabled.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
  )

describe('the api reference in production', () => {
  it('is off when nothing asks for it', async () => {
    expect(await exposed({ NODE_ENV: 'production' })).toBe(false)
    expect(await exposed({ NODE_ENV: 'production', QUALY_API_DOCS: 'auto' })).toBe(false)
  })

  it('is on outside production, where the reader is the person writing the client', async () => {
    expect(await exposed({})).toBe(true)
    expect(await exposed({ NODE_ENV: 'development' })).toBe(true)
    expect(await exposed({ NODE_ENV: 'test' })).toBe(true)
  })

  it('takes an explicit answer either way, because a sandbox is a real case', async () => {
    expect(await exposed({ NODE_ENV: 'production', QUALY_API_DOCS: 'public' })).toBe(true)
    expect(await exposed({ NODE_ENV: 'development', QUALY_API_DOCS: 'off' })).toBe(false)
  })

  it('refuses a setting it does not know rather than guessing', async () => {
    // 'on' is the word somebody would reach for, and reading it as anything
    // silently would publish the map of a production assembly
    await expect(exposed({ NODE_ENV: 'production', QUALY_API_DOCS: 'on' })).rejects.toThrow()
  })
})
