import { useId, useState } from 'react'
import { Checkbox } from '@qualy/ui/checkbox'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import {
  deviceOfCookieHeader,
  SECURE_SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_MAX_AGE_SECONDS,
} from '@qualy/auth-contract/device'
import * as m from '#messages'

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
  const https = location.protocol === 'https:'
  const name = https ? SECURE_SIGN_IN_DEVICE_COOKIE : SIGN_IN_DEVICE_COOKIE
  const secure = https ? '; Secure' : ''
  // Write both answers. Removing the host cookie for "personal" would let a
  // sibling's older Domain cookie become authoritative again.
  document.cookie = `${name}=${shared ? 'shared' : 'personal'}; Path=/; SameSite=Lax; Max-Age=${SIGN_IN_DEVICE_MAX_AGE_SECONDS}${secure}`
  // Remove the old host-scoped spelling during the HTTPS migration. A
  // sibling's Domain cookie cannot be removed here, but the __Host value wins.
  if (https) document.cookie = `${SIGN_IN_DEVICE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0; Secure`
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
            {m.login_sharedDevice()}
          </label>
          <p {...stylex.props(styles.hint)}>{m.login_sharedDeviceHint()}</p>
        </div>
      </div>
    </div>
  )
}
