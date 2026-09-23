import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { SectionHead } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { AccountChanges, SignInRecords } from './security-records.tsx'

// What happened to the reader's account, apart from the security page's
// state of things now: the latest sign-ins and the latest changes, each
// with the way to the whole of it.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function AccountActivityPage() {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.activityTitle)} />
      <SignInRecords />
      <AccountChanges />
    </div>
  )
}
