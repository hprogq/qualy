import { useQuery } from '@tanstack/react-query'
import { useApi, useDocumentContext, useRunApi } from '@qualy/web-runtime'
import type { TermRef } from '@qualy/settings-contract'
import { TERMS_CONTEXT } from '../terms-context.ts'
import { settingsApi } from './api.ts'

// The word a tenant uses, read from a screen.
//
// Every page already has it: the manifest carries the tenant's words for
// every declared term, said in the page's language, so a screen reads a
// term synchronously and never waits or flickers for it. The terminology
// screen alone asks the api, for everything a term is in every language.

/** where the terminology screen keeps what it edits; invalidated after a save */
export const TERMINOLOGY_KEY = ['settings', 'terminology'] as const

export function useTerminology() {
  const api = useApi(settingsApi)
  const run = useRunApi()
  return useQuery({
    queryKey: TERMINOLOGY_KEY,
    queryFn: () => run(api.settings.getTerminology({})),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** the tenant's word for a term in the page's language */
export function useTerm(term: TermRef): string {
  const words = useDocumentContext<Readonly<Record<string, string>>>(TERMS_CONTEXT)
  // every declared term is in the context; its id stands in only where no
  // settings plugin provides one, which is a harness and never a product
  return words?.[term.id] ?? term.id
}
