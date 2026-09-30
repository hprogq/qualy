import type { SupportedLocale } from '@qualy/i18n-contract'
import { reopenInLocale, useI18n, useLocale } from '@qualy/web-i18n'
import { toast } from '@qualy/ui/toast'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { authApi } from './api.ts'

/**
 * Choosing a language: kept for this browser and, for somebody signed in,
 * for their account, and then the page opens again in it. A page keeps one
 * language while it is open; the reload asks first when something would be
 * lost, as any reload does.
 */
export function useChooseLocale(): (next: SupportedLocale) => void {
  const locale = useLocale()
  const api = useApi(authApi)
  const run = useRunApi()
  const { formatError } = useI18n()
  return (next) => {
    if (next === locale) return
    // not kept, not switched: the page stays as it is and says why
    void run(api.auth.putLocale({ payload: { locale: next } }))
      .then(() => reopenInLocale(next))
      .catch((error: unknown) => toast.error(formatError(error)))
  }
}
