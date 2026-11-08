import type { SupportedLocale } from '@qualy/i18n-contract'
import * as m from '#messages'

export function formatList(items: readonly string[], locale: SupportedLocale): string {
  return items.join(m.list_separator({}, { locale }))
}
