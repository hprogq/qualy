import { useId, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Checkbox } from '@qualy/ui/checkbox'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import {
  deviceOfCookieHeader,
  SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_MAX_AGE_SECONDS,
} from '@qualy/auth-contract/device'
import { authMessages as m } from '../i18n.ts'

// Whether this is a computer others use, asked once for every way in.
//
// The answer lives in a cookie of the page's own, so it goes with whichever
// way the person takes - a form's post or a redirect's first step - and the
// server reads it where the sign-in starts. It is remembered at this browser:
// a lab machine keeps the box ticked for the next person too.

const remembered = (): boolean => {
  try {
    return deviceOfCookieHeader(document.cookie) === 'shared'
  } catch {
    return false
  }
}

const remember = (shared: boolean) => {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${SIGN_IN_DEVICE_COOKIE}=${shared ? 'shared' : ''}; Path=/; SameSite=Lax; Max-Age=${shared ? SIGN_IN_DEVICE_MAX_AGE_SECONDS : 0}${secure}`
}

const styles = stylex.create({
  // on its own at the foot of the page: as wide as its words and centred
  // there as one piece, not lined up with the ways in it is kept apart from
  seat: {
    display: 'flex',
    justifyContent: 'center',
  },
  choice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    textAlign: 'start',
  },
  // the box on the label's line
  box: { marginTop: 2 },
  words: { display: 'flex', flexDirection: 'column', gap: 2 },
  label: { fontSize: 14, cursor: 'pointer' },
  hint: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
})

export function SharedDeviceChoice() {
  const { format } = useI18n()
  const id = useId()
  const [shared, setShared] = useState(remembered)
  return (
    <div data-testid="sign-in-shared-device-seat" {...stylex.props(styles.seat)}>
      <div {...stylex.props(styles.choice)}>
        <Checkbox
          id={id}
          data-testid="sign-in-shared-device"
          className={stylex.props(styles.box).className}
          checked={shared}
          onCheckedChange={(next) => {
            remember(next === true)
            setShared(next === true)
          }}
        />
        <div {...stylex.props(styles.words)}>
          <label htmlFor={id} {...stylex.props(styles.label)}>
            {format(m.sharedDevice)}
          </label>
          <p {...stylex.props(styles.hint)}>{format(m.sharedDeviceHint)}</p>
        </div>
      </div>
    </div>
  )
}
