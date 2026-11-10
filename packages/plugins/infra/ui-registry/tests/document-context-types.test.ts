import { Effect } from 'effect'
import { expectTypeOf, it } from 'vitest'
import { documentContext, type DocumentContextProvider } from '../src/document-context.ts'

declare module '@qualy/ui-contract' {
  interface DocumentContextTypes {
    readonly 'test/strict-context': { readonly label: string }
  }
}

it('ties a contributed context to its declared value', () => {
  const provider: DocumentContextProvider<'test/strict-context'> = {
    key: 'test/strict-context',
    bind: Effect.succeed(() => Effect.succeed({ label: 'visible' })),
  }
  expectTypeOf(provider.key).toEqualTypeOf<'test/strict-context'>()
  documentContext(provider)
  const rejectedContributions = () => {
    // @ts-expect-error An undeclared context is not a contribution contract.
    documentContext({ key: 'test/missing', bind: Effect.succeed(() => Effect.succeed({})) })
    documentContext({
      key: 'test/strict-context',
      // @ts-expect-error The key determines the result; callers cannot choose another shape.
      bind: Effect.succeed(() => Effect.succeed({ label: 1 })),
    })
  }
  expectTypeOf(rejectedContributions).toBeFunction()
})
