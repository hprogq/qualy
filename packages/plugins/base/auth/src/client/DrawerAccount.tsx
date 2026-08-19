import { localeNames, useI18n, useLocale } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { authMessages as m } from './i18n.ts'
import { ThemeChoicePicker } from './identity-bits.tsx'

// The preferences row on the drawer's foot: appearance and language, both
// held by the browser, adjusted in place. The same choices the top bar's
// account menu offers a desktop - said flat here, because a drawer is
// already the bottom of a stack and must not open menus of its own.

export default function DrawerAccount() {
  const { format } = useI18n()
  const [locale, setLocale] = useLocale()
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
        {format(m.appearance)}
      </span>
      <ThemeChoicePicker />
      <span className="flex-1" />
      <span className="shrink-0 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
        {format(m.language)}
      </span>
      <ToggleGroup
        type="single"
        spacing={0}
        variant="outline"
        size="sm"
        value={locale}
        aria-label={format(m.language)}
        onValueChange={(next) => next !== '' && setLocale(next as SupportedLocale)}
      >
        {supportedLocales.map((candidate) => (
          <ToggleGroupItem key={candidate} value={candidate} className="px-2 text-xs">
            {localeNames[candidate]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
