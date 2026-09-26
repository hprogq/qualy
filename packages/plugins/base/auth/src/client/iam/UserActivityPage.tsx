import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { LockKeyholeIcon } from 'lucide-react'
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
  denied: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.divider,
    backgroundColor: tokens.surface,
  },
})

export default function UserActivityPage() {
  const { userId } = usePageRouteParams('userId')
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  // the same gate the records are read behind: the account, not the record
  const allowed = user.data?.accountManageable ?? false

  return (
    <div {...stylex.props(styles.page)} data-testid="user-activity">
      <SectionHead title={format(m.activityTitle)} />
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
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
            <Empty data-testid="user-activity-denied" xstyle={styles.denied}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LockKeyholeIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{format(m.personActivityDenied)}</EmptyTitle>
                <EmptyDescription>{format(m.personActivityDeniedHint)}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ))}
      </AsyncSection>
    </div>
  )
}
