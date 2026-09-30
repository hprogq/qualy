import * as stylex from '@stylexjs/stylex'
import { SectionHead } from '@qualy/ui/screen'

import { AccountChanges, SignInRecords } from './security-records.tsx'
import * as m from '#messages'

// What happened to the reader's account, apart from the security page's
// state of things now: the latest sign-ins and the latest changes, each
// with the way to the whole of it.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function AccountActivityPage() {
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={m.activity_title()} />
      <SignInRecords />
      <AccountChanges />
    </div>
  )
}
