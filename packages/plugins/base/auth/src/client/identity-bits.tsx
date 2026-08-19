import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme, type ThemeChoice } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
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
