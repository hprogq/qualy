import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import * as stylex from '@stylexjs/stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { PlusIcon } from 'lucide-react'
import {
  Card,
  CardEmpty,
  Cell,
  LeadWord,
  SectionHead,
  Table,
  TableHead,
  Status,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'

import { GrantOrigin } from './GrantOrigin.tsx'
import { GrantRoleDialog } from './GrantRoleForm.tsx'
import { accessApi } from './api.ts'
import { useMoment } from './when.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// What one person has been granted, as a section of their record.
//
// Two lists, not one. A grant confined to one object - a round's reviewer,
// say - confers nothing outside that object, is made and withdrawn through
// the object's owner, and beside organizational authority with the same
// revoke press it read as the same thing. So the ordinary grants come first
// with their form, and the confined ones follow as something to read and
// follow to its source: whoever owns the object explains it through the
// presenter it registered, and where nobody has, the kind is named plainly.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 28 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  // where the grant came from and how long it holds, said by whoever knows
  origin: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 2,
  },
  // stacked, the press keeps to the far end of whatever line it lands on
  // rather than starting a new one under the first word
  end: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
})

type Grant = {
  id: string
  roleName: string
  roleStatus: 'draft' | 'active' | 'disabled'
  target:
    | { kind: 'tenant' }
    | { kind: 'org-node'; orgNodeId: string; orgNodeName: string; coverage: 'self' | 'subtree' }
  manageable: boolean
  resource: { namespace: string; type: string; id: string } | null
  validFrom: string | null
  validUntil: string | null
}

export default function UserRoleGrantsPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(accessApi)
  const run = useRunApi()
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { formatError } = useI18n()
  const describe = useLoadFailure()
  const moment = useMoment()
  // whose authority is waiting on an answer; taking one away is not undone
  // by pressing again
  const [revoking, setRevoking] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [granting, setGranting] = useState(false)
  // each opening is a form of its own, mounted afresh
  const [opening, setOpening] = useState(0)

  const grants = useQuery(query.access.getUserRoleGrants.queryOptions({ params: { userId } }))
  const items: readonly Grant[] = grants.data?.grants ?? []
  const grantable = grants.data?.grantable ?? { tenant: false, organization: false }
  const organizational = items.filter((grant) => grant.resource === null)
  const confined = items.filter((grant) => grant.resource !== null)

  // one grant at a time: replacing the whole set meant proposing to delete
  // every grant this caller could not see
  const revoke = useMutation({
    mutationFn: (grantId: string) => run(api.access.deleteRoleGrant({ params: { grantId } })),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.access.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const where = (grant: Grant) =>
    grant.target.kind === 'tenant'
      ? m.grants_tenantWide()
      : grant.target.coverage === 'subtree'
        ? m.grants_atSubtree({ node: grant.target.orgNodeName })
        : m.grants_atNode({ node: grant.target.orgNodeName })

  const window = (grant: Grant) => (
    <>
      {grant.validFrom !== null && (
        <span>{m.grants_validFrom({ when: moment(grant.validFrom) })}</span>
      )}
      {grant.validUntil !== null && (
        <span data-testid="grant-until">
          {m.grants_validUntil({ when: moment(grant.validUntil) })}
        </span>
      )}
    </>
  )

  return (
    <div {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.section)}>
        <SectionHead
          title={m.grants_organizational()}
          // a count is a fact of the reading, and there is none before it
          // arrives or when it fails
          count={grants.data === undefined ? undefined : organizational.length}
          aside={m.grants_organizationalHint()}
          actions={
            // only for a reader who may give a role somewhere: a form that
            // could only ever say "nothing here for you" is not an errand
            (grantable.tenant || grantable.organization) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpening((count) => count + 1)
                  setGranting(true)
                }}
              >
                <PlusIcon aria-hidden />
                {m.grants_open()}
              </Button>
            )
          }
        />
        <Feedback message={feedback} />
        <AsyncSection
          pending={grants.isPending}
          error={grants.isError ? describe.of(grants.error) : null}
          // on the section's own ground, where the grants would have stood
          // in a card, and under the section's heading
          framed
          headingLevel={3}
          retrying={grants.isFetching}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void grants.refetch()}
        >
          <Card>
            {organizational.length === 0 ? (
              <CardEmpty>{m.grants_organizationalEmpty()}</CardEmpty>
            ) : (
              <Table columns="minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr) 4.5rem">
                <TableHead>
                  <span>{m.grants_role()}</span>
                  <span>{m.grants_scope()}</span>
                  <span>{m.grants_columnWindow()}</span>
                  <span />
                </TableHead>
                {organizational.map((grant) => (
                  <TableRow
                    key={grant.id}
                    data-testid="grant-row"
                    data-grant-kind="organizational"
                    data-role-status={grant.roleStatus}
                  >
                    <Cell lead>
                      <LeadWord>{grant.roleName}</LeadWord>
                      {grant.roleStatus === 'disabled' && (
                        <Status tone="bad">{m.badge_disabled()}</Status>
                      )}
                    </Cell>
                    <Cell title={where(grant)} unlabelled>
                      {where(grant)}
                    </Cell>
                    <Cell
                      tone={
                        grant.validFrom === null && grant.validUntil === null ? 'quiet' : 'muted'
                      }
                    >
                      {grant.validFrom === null && grant.validUntil === null ? (
                        m.grants_windowOpen()
                      ) : (
                        <span {...stylex.props(styles.origin)}>{window(grant)}</span>
                      )}
                    </Cell>
                    <span {...stylex.props(styles.end)}>
                      {grant.manageable && (
                        <Button
                          variant="ghost"
                          size="xs"
                          // per-row pending: revoking one grant must not freeze
                          // the controls of every other row
                          disabled={revoke.isPending && revoke.variables === grant.id}
                          onClick={() => setRevoking(grant.id)}
                        >
                          {m.action_revoke()}
                        </Button>
                      )}
                    </span>
                  </TableRow>
                ))}
              </Table>
            )}
          </Card>
        </AsyncSection>
      </section>

      {/* the same reading as the section above: when it failed, the one
          state there says so for both, and "none within one object" here
          would be an answer nobody was given */}
      {!(grants.isError && grants.data === undefined) && (
        <section {...stylex.props(styles.section)}>
          <SectionHead
            title={m.grants_confined()}
            count={grants.data === undefined ? undefined : confined.length}
            aside={m.grants_confinedHint()}
          />
          {grants.data !== undefined && (
            <Card>
              {confined.length === 0 ? (
                <CardEmpty>{m.grants_confinedEmpty()}</CardEmpty>
              ) : (
                <Table columns="minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr)">
                  <TableHead>
                    <span>{m.grants_role()}</span>
                    <span>{m.grants_scope()}</span>
                    <span>{m.grants_columnOrigin()}</span>
                  </TableHead>
                  {confined.map((grant) => (
                    <TableRow
                      key={grant.id}
                      height="regular"
                      data-testid="grant-row"
                      data-grant-kind="confined"
                      data-role-status={grant.roleStatus}
                    >
                      <Cell lead>
                        <LeadWord>{grant.roleName}</LeadWord>
                        {grant.roleStatus === 'disabled' && (
                          <Status tone="bad">{m.badge_disabled()}</Status>
                        )}
                      </Cell>
                      <Cell title={where(grant)} unlabelled>
                        {where(grant)}
                      </Cell>
                      <Cell>
                        <span {...stylex.props(styles.origin)}>
                          <GrantOrigin grant={grant} />
                          {window(grant)}
                        </span>
                      </Cell>
                    </TableRow>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </section>
      )}

      <GrantRoleDialog
        key={opening}
        userId={userId}
        open={granting}
        grantable={grantable}
        onClose={() => setGranting(false)}
      />

      <ConfirmDialog
        open={revoking !== null}
        tone="destructive"
        title={m.grants_revokeTitle()}
        description={m.grants_revokeHint()}
        confirmLabel={m.action_revoke()}
        cancelLabel={commonMessages.action_cancel()}
        pending={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const id = revoking
          setRevoking(null)
          if (id !== null) revoke.mutate(id)
        }}
      />
    </div>
  )
}
