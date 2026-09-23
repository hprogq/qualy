import { useSearchParams } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { SectionHead, Segmented } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { AccountChanges, SignInRecords } from './security-records.tsx'

// What happened to the reader's account, apart from the security page's
// state of things now: every time somebody came in or was refused, and every
// change made to it. One of the two at a time - each has its own filters and
// its own pages - and which one is in the address, so it can be linked to.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

type View = 'sign-ins' | 'changes'

export default function AccountActivityPage() {
  const { format } = useI18n()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'changes' ? 'changes' : 'sign-ins'
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.activityTitle)} />
      <Segmented
        label={format(m.activityTitle)}
        value={view}
        onChange={(next) => setParams(next === 'sign-ins' ? {} : { view: next }, { replace: true })}
        options={[
          { value: 'sign-ins', label: format(m.activitySignIns) },
          { value: 'changes', label: format(m.activityChanges) },
        ]}
      />
      {/* keyed, so each view starts on its own first page and filters */}
      {view === 'sign-ins' ? <SignInRecords key="sign-ins" /> : <AccountChanges key="changes" />}
    </div>
  )
}
