import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'

// The grants one person holds. The api replaces the whole set in one
// transaction, so this screen sends the set it wants rather than a sequence
// of add and remove calls that could each be authorized differently.
//
// It reads access's own api directly. Both surfaces live under /iam and the
// generated client is one object, so a user screen naming a grant endpoint
// crosses no boundary the plugin graph cares about.
export function UserGrants({ userId }: { userId: string }) {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)

  const grants = useQuery(orpc.access.getUserRoleAssignments.queryOptions({ input: { userId } }))
  const items = grants.data?.assignments ?? []

  const revoke = useMutation({
    mutationFn: (assignmentId: string) =>
      api.access.syncUserRoleAssignments({
        userId,
        assignments: items
          .filter((grant) => grant.id !== assignmentId)
          .map((grant) => ({
            roleId: grant.roleId,
            orgNodeId: grant.orgNodeId,
            scope: grant.scope,
          })),
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.access.key() })
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
          <p className="text-sm text-muted-foreground">{format(m.grantsEmpty)}</p>
        ) : (
          <ul className="divide-y">
            {items.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{grant.roleName}</p>
                  <p className="text-xs text-muted-foreground">
                    {grant.orgNodeName} · {grant.scope}
                  </p>
                </div>
                {grant.manageable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    // per-row pending: revoking one grant must not freeze the
                    // controls of every other row
                    disabled={revoke.isPending && revoke.variables === grant.id}
                    onClick={() => revoke.mutate(grant.id)}
                  >
                    {format(m.delete)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </Panel>
  )
}
