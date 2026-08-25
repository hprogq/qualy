import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme, type ThemeChoice } from '@qualy/web-runtime'
import { localeNames, useI18n, useLocale } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { authMessages as m } from './i18n.ts'

// The theme control the account surfaces share, wherever one is standing -
// the top bar's menu on a desktop, the navigation drawer on a phone. A
// component-only module, so fast refresh can replace it in place.

/** the three appearances, chosen in place; held by the browser alone */
export function ThemeChoicePicker() {
  const { choice, setChoice } = useTheme()
  const { format } = useI18n()
  const options: { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
    { value: 'light', label: format(m.themeLight), icon: SunIcon },
    { value: 'dark', label: format(m.themeDark), icon: MoonIcon },
    { value: 'system', label: format(m.themeSystem), icon: MonitorIcon },
  ]
  return (
    <ToggleGroup
      type="single"
      spacing={0}
      variant="outline"
      size="sm"
      value={choice}
      aria-label={format(m.appearance)}
      onValueChange={(next) => next !== '' && setChoice(next as ThemeChoice)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
          <option.icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/**
 * The language, chosen in place beside the appearance - no submenu to hover
 * open. A select rather than a toggle row: the list of languages only
 * grows, and a row of N toggles would outgrow the menu long before the
 * product runs out of translators. Each option names itself in its own
 * language, which is the one label its reader is sure to know.
 */
export function LocaleChoicePicker() {
  const [locale, setLocale] = useLocale()
  const { format } = useI18n()
  return (
    <Select value={locale} onValueChange={(next) => setLocale(next as SupportedLocale)}>
      <SelectTrigger size="sm" aria-label={format(m.language)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedLocales.map((candidate) => (
          <SelectItem key={candidate} value={candidate}>
            {localeNames[candidate]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
