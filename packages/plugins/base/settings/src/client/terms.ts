import { useQuery } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import {
  effectiveText,
  type LocalizedTextOverride,
  type TermDefinition,
} from '@qualy/settings-contract'
import { settingsApi } from './api.ts'

// The word a tenant uses, read from a screen.
//
// One query for the whole tenant, shared by every `useTerm` on every screen:
// a page that asks twenty times still asks the server once. Switching locale
// re-renders from the same answer, because the answer carries every locale.
// And the answer is presentation - a screen that cannot reach it shows the
// plugin's default word rather than refusing to open.

/** where the tenant's words live in the query cache; invalidated after a save */
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

/** the tenant's word for a term in the reader's locale, or the plugin's default until it arrives */
export function useTerm(term: TermDefinition): string {
  const { locale } = useI18n()
  const terminology = useTerminology()
  const found = terminology.data?.terms.find((one) => one.id === term.id)
  return effectiveText(term, found?.override as LocalizedTextOverride | undefined, locale)
}
