import { localeNames, useLocale } from '@qualy/web-i18n'
import { useChooseLocale } from './locale-choice.ts'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'

import { ThemeChoicePicker } from './identity-bits.tsx'
import * as m from '#messages'

// The preferences row on the drawer's foot: appearance and language, both
// held by the browser, adjusted in place. The same choices the top bar's
// account menu offers a desktop - said flat here, because a drawer is
// already the bottom of a stack and must not open menus of its own.

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
})

export default function DrawerAccount() {
  const locale = useLocale()
  const setLocale = useChooseLocale()
  return (
    <div data-testid="drawer-account" {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{m.preference_appearance()}</span>
      <ThemeChoicePicker />
      <span {...stylex.props(styles.spacer)} />
      <span {...stylex.props(styles.label)}>{m.preference_language()}</span>
      <ToggleGroup
        value={locale}
        aria-label={m.preference_language()}
        onValueChange={(next) => next !== '' && setLocale(next as SupportedLocale)}
      >
        {supportedLocales.map((candidate) => (
          <ToggleGroupItem key={candidate} value={candidate}>
            {localeNames[candidate]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
