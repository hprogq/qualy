import { formatPlatformFailure as formatError, reopenInLocale, useLocale } from '@qualy/web-i18n'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@qualy/ui/admin'
import * as m from '#messages'
import { type SupportedLocale } from '@qualy/i18n-contract'

import { toast } from '@qualy/ui/toast'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { authApi } from './api.ts'

/** Save the choice only after the reader agrees to reopen the document. */
export function useChooseLocale(options: { savedLocale?: SupportedLocale | null } = {}) {
  const locale = useLocale()
  const api = useApi(authApi)
  const run = useRunApi()

  const [chosen, setChosen] = useState<SupportedLocale>()
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const choose = (next: SupportedLocale) => {
    const saved = options.savedLocale === undefined ? locale : options.savedLocale
    if (next !== saved && !saving.current) setChosen(next)
  }
  const confirm = () => {
    if (chosen === undefined || saving.current) return
    saving.current = true
    setPending(true)
    void run(api.auth.putLocale({ payload: { locale: chosen } }))
      .then(() => {
        setChosen(undefined)
        reopenInLocale(chosen)
      })
      .catch((error: unknown) => toast.error(formatError(error)))
      .finally(() => {
        saving.current = false
        setPending(false)
      })
  }
  const confirmation = (
    <ConfirmDialog
      open={chosen !== undefined}
      title={m.preference_localeConfirmTitle()}
      description={m.preference_localeConfirmHint()}
      descriptionData={{ 'data-locale-choice': chosen ?? '' }}
      confirmLabel={m.preference_localeConfirmAction()}
      cancelLabel={m.action_cancel()}
      pending={pending}
      onConfirm={confirm}
      onCancel={() => {
        if (!saving.current) setChosen(undefined)
      }}
    />
  )
  return { choose, confirmation }
}
