import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { GrantRoleForm } from './GrantRoleForm.tsx'
import { authApi } from '../api.ts'

// The grants one person holds. The api replaces the whole set in one
// transaction, so this screen sends the set it wants rather than a sequence
// of add and remove calls that could each be authorized differently.
//
// It reads access's own api directly. Both surfaces live under /iam and the
// generated client is one object, so a user screen naming a grant endpoint
// crosses no boundary the plugin graph cares about.
const styles = stylex.create({
  emptyNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  grantRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingBlock: 8,
  },
  grantText: {
    minWidth: 0,
  },
  grantRole: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  grantWhere: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
})

export function UserGrants({
  userId,
  nodes,
}: {
  userId: string
  /** the org tree this caller may anchor a new grant in */
  nodes: readonly { orgNodeId: string; name: string; depth: number; manageable: boolean }[]
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  // whose authority is waiting on an answer; taking one away is not undone
  // by pressing again
  const [revoking, setRevoking] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const grants = useQuery(query.access.getUserRoleGrants.queryOptions({ params: { userId } }))
  const items = grants.data?.grants ?? []

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

  return (
    <Panel title={format(m.grantsSection)} description={format(m.grantsHint)}>
      <Feedback message={feedback} />
      <AsyncSection
        pending={grants.isPending}
        error={grants.isError ? formatError(grants.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void grants.refetch()}
      >
        {items.length === 0 ? (
          <p {...stylex.props(styles.emptyNote)}>{format(m.grantsEmpty)}</p>
        ) : (
          <ul>
            {items.map((grant) => (
              <li key={grant.id} {...stylex.props(styles.grantRow)}>
                <div {...stylex.props(styles.grantText)}>
                  <p {...stylex.props(styles.grantRole)}>{grant.roleName}</p>
                  <p {...stylex.props(styles.grantWhere)}>
                    {grant.target.kind === 'tenant'
                      ? format(m.tenantWideGrant)
                      : `${grant.target.orgNodeName} · ${grant.target.coverage}`}
                  </p>
                </div>
                {grant.manageable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    // per-row pending: revoking one grant must not freeze the
                    // controls of every other row
                    disabled={revoke.isPending && revoke.variables === grant.id}
                    onClick={() => setRevoking(grant.id)}
                  >
                    {format(m.delete)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
      <GrantRoleForm userId={userId} nodes={nodes} />
      <ConfirmDialog
        open={revoking !== null}
        tone="destructive"
        title={format(m.revokeGrantTitle)}
        description={format(m.revokeGrantHint)}
        confirmLabel={format(m.delete)}
        cancelLabel={format(commonMessages.cancel)}
        pending={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const id = revoking
          setRevoking(null)
          if (id !== null) revoke.mutate(id)
        }}
      />
    </Panel>
  )
}
