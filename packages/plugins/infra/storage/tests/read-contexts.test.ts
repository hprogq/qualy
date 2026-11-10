import { Effect, Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineReadContext } from '../src/content.ts'
import { compileReadContexts, readContext } from '../src/server/read-contexts.ts'

declare module '@qualy/plugin-storage/content' {
  interface ReadContextTypes {
    readonly 'test/entry': { readonly entryId: string }
    readonly 'test/review': { readonly instanceId: string }
  }
}
const Entry = defineReadContext('test/entry', Schema.Struct({ entryId: Schema.String }))
const actor = { tenantId: 't', userId: 'u', sessionId: 's' }

describe('typed storage read contexts', () => {
  it('correlates the contract, params and bound authorizer', () => {
    expectTypeOf(Entry.at({ entryId: 'e' }).context).toEqualTypeOf<{ readonly entryId: string }>()
    const invalid = () => {
      // @ts-expect-error The context key has to be declared.
      defineReadContext('test/missing', Schema.String)
      // @ts-expect-error The schema cannot describe another context.
      defineReadContext('test/entry', Schema.Struct({ instanceId: Schema.String }))
      // @ts-expect-error Review params do not belong to an entry.
      Entry.at({ instanceId: 'i' })
      readContext(
        Entry,
        // @ts-expect-error The authorizer cannot consume another context.
        Effect.succeed({
          authorize: (_input: { context: { instanceId: string } }) => Effect.succeed([]),
        }),
      )
    }
    expectTypeOf(invalid).toBeFunction()
  })
  it('decodes before invoking a single selected authorizer, without fallback', async () => {
    let calls = 0
    const feature = readContext(
      Entry,
      Effect.succeed({
        authorize: ({ context }) => {
          calls++
          return Effect.succeed(context.entryId === 'visible' ? ['a', 'foreign'] : [])
        },
      }),
    )
    expect(feature._tag).toBe('Contribute')
    if (feature._tag !== 'Contribute') throw new Error('expected contribution')
    const catalog = await Effect.runPromise(
      compileReadContexts([
        {
          pluginId: 'test',
          value: feature.value as Parameters<typeof compileReadContexts<never>>[0][number]['value'],
        },
      ]),
    )
    expect(
      await Effect.runPromise(
        catalog.authorize({
          ...Entry.at({ entryId: 'visible' }),
          principal: actor,
          attachmentIds: ['a'],
        }),
      ),
    ).toEqual(['a'])
    expect(calls).toBe(1)
    for (const input of [
      { key: 'test/missing', context: {} },
      { key: 'test/entry', context: { entryId: 'visible', extra: true } },
      { key: 'test/entry', context: { instanceId: 'i' } },
    ]) {
      const exit = await Effect.runPromiseExit(
        catalog.authorize({ ...input, principal: actor, attachmentIds: ['a'] }),
      )
      expect(exit._tag).toBe('Failure')
    }
    expect(calls).toBe(1)
  })
})
