import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { ResourceState } from '@qualy/ui/resource-state'
import { EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { SessionsCard, SignInRecords } from '../account/security-records.tsx'

// How one person comes in, as whoever administers their account reads it:
// where they are signed in now, with the way to end it, and every attempt to
// come in as them - the refused ones too. The same records the person reads
// of themselves, and more: ending their sessions is the administrator's.
//
// What was done to the account is the audit trail's, and a section of its
// own beside this one for whoever may read the trail.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function UserActivityPage() {
  const { userId } = usePageRouteParams('userId')
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  // a reading of this section that failed; the person not being there is the banner's to say
  const describe = useLoadFailure()
  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  // the same gate the records are read behind: the account, not the record
  const allowed = user.data?.accountManageable ?? false

  return (
    <div {...stylex.props(styles.page)} data-testid="user-activity">
      <SectionHead title={format(m.activityTitle)} />
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? describe.of(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record !== undefined &&
          (allowed ? (
            <>
              <SessionsCard person={{ userId, name: record.displayName }} />
              <SignInRecords person={{ userId, name: record.displayName }} />
            </>
          ) : (
            // a reader who may read the person but not their account: said
            // plainly, rather than as two cards that each failed
            <ResourceState
              kind="denied"
              size="section"
              framed
              data-testid="user-activity-denied"
              title={format(m.personActivityDenied)}
              description={format(m.personActivityDeniedHint)}
            />
          ))}
      </AsyncSection>
    </div>
  )
}
