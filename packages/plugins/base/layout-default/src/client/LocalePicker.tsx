import { localeNames, useI18n, useLocale } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { layoutMessages as m } from './i18n.ts'

// The language picker in the shell's header. Switching activates the
// catalogs and re-renders; no data is refetched.
export function LocalePicker() {
  const [locale, setLocale] = useLocale()
  const { format } = useI18n()
  return (
    <Select value={locale} onValueChange={(next) => setLocale(next as SupportedLocale)}>
      <SelectTrigger size="sm" aria-label={format(m.language)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {supportedLocales.map((candidate) => (
          <SelectItem key={candidate} value={candidate}>
            {localeNames[candidate]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
