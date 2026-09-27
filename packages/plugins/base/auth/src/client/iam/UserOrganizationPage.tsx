import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useApiQuery, useLoadFailure, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightLeftIcon } from 'lucide-react'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  DefLine,
  DefList,
  EditorSkeleton,
  SectionHead,
  Tag,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { UserMoveDialog } from './UserMoveDialog.tsx'

// Where the person stands in the organization, and the one act that changes
// it.
//
// The chain is read as an address - kind, then name, a rung to a line -
// because a column of bare names only tells somebody who already knows the
// naming anything.
//
// Moving somebody is the dialog in UserMoveDialog.tsx, which the band above
// every section of the record opens as well.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 24 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  standing: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
})

export default function UserOrganizationPage() {
  const { userId } = usePageRouteParams('userId')
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  // a reading of this section that failed; the person not being there is the banner's to say
  const describe = useLoadFailure()
  const [picking, setPicking] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  // moving somebody is their account's business, not only their record's
  const manageable = user.data?.accountManageable ?? false
  const path = user.data?.orgPath ?? []

  return (
    <div {...stylex.props(styles.page)}>
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? describe.of(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record && (
          <section {...stylex.props(styles.section)}>
            <SectionHead
              title={format(m.personPlacement)}
              actions={
                manageable && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="move-open"
                    onClick={() => setPicking(true)}
                  >
                    <ArrowRightLeftIcon aria-hidden />
                    {format(m.moveLabel)}
                  </Button>
                )
              }
            />
            <Feedback message={feedback} />
            {moved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}
            <Card>
              {path.length === 0 ? (
                <CardEmpty>{format(m.placementEmpty)}</CardEmpty>
              ) : (
                <div data-testid="org-chain">
                  <DefList>
                    {path.map((node, depth) => (
                      <DefLine key={node.id} label={node.orgTypeName}>
                        <span data-org-node={node.id} {...stylex.props(styles.standing)}>
                          {node.name}
                          {depth === path.length - 1 && <Tag>{format(m.columnUnit)}</Tag>}
                        </span>
                      </DefLine>
                    ))}
                  </DefList>
                </div>
              )}
            </Card>
          </section>
        )}
      </AsyncSection>

      <UserMoveDialog
        userId={userId}
        open={picking}
        onClose={() => setPicking(false)}
        onStart={() => {
          setFeedback(null)
          setMoved(false)
        }}
        onDone={(outcome) => {
          if (outcome.moved) setMoved(true)
          else setFeedback(outcome.said)
        }}
      />
    </div>
  )
}
