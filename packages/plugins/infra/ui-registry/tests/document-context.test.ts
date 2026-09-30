import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_CONTEXT_BUDGET,
  DocumentContext,
  compileDocumentContext,
  type DocumentContextProvider,
} from '../src/document-context.ts'

// What a whole page reads with its manifest: every provider's answer by its
// key, for the reader and in the language asked, and never more than a page
// should carry.

const provider = (
  key: `${string}/${string}`,
  answer: (locale: string) => unknown,
): DocumentContextProvider => ({
  key,
  bind: Effect.succeed((reader) => Effect.succeed(answer(reader.locale))),
})

const ask = (
  contributions: { pluginId: string; value: DocumentContextProvider<any> }[],
  locale: 'zh-CN' | 'en-US' = 'en-US',
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const context = yield* DocumentContext
      return yield* context.of({ principal: undefined, locale })
    }).pipe(Effect.provide(compileDocumentContext(contributions) as Layer.Layer<DocumentContext>)),
  )

describe('the document context', () => {
  it("is every provider's answer, by its key, in the page's language", async () => {
    const exit = await ask(
      [
        { pluginId: 'a', value: provider('a/words', (locale) => ({ hello: locale })) },
        { pluginId: 'b', value: provider('b/flags', () => ['x']) },
      ],
      'zh-CN',
    )
    expect(exit).toEqual(Exit.succeed({ 'a/words': { hello: 'zh-CN' }, 'b/flags': ['x'] }))
  })

  it('refuses a key two plugins provide', async () => {
    const exit = await ask([
      { pluginId: 'a', value: provider('a/words', () => 1) },
      { pluginId: 'b', value: provider('a/words', () => 2) },
    ])
    expect(Exit.isFailure(exit) && String(exit.cause)).toMatch(/provided by both a and b/)
  })

  it('refuses to carry more than a page should', async () => {
    const exit = await ask([
      {
        pluginId: 'a',
        value: provider('a/words', () => 'x'.repeat(DOCUMENT_CONTEXT_BUDGET)),
      },
    ])
    expect(Exit.isFailure(exit) && String(exit.cause)).toMatch(/over the \d+ every page carries/)
  })
})
