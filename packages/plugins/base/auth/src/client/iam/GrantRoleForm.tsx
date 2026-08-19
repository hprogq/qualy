import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// Giving somebody a role, which is two questions in one form: what the role is
// and where it applies.
//
// The order between them is not free. Which roles may be granted depends on
// the target - the server answers with the ones this caller holds widely
// enough to pass on, at that anchor, for that person's user type - so the
// target is chosen first and the role list is a function of it. Asking for the
// role first would mean offering roles that the target then invalidates, and
// the refusal would arrive from the server as a rejected submission.
type Coverage = 'self' | 'subtree'

export function GrantRoleForm({
  userId,
  nodes,
}: {
  userId: string
  /** the org tree this caller may anchor a grant in, from the user options */
  nodes: readonly { orgNodeId: string; name: string; depth: number; manageable: boolean }[]
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [scope, setScope] = useState<'tenant' | 'org-node'>('tenant')
  const [orgNodeId, setOrgNodeId] = useState('')
  const [coverage, setCoverage] = useState<Coverage>('subtree')
  const [roleId, setRoleId] = useState('')

  const anchors = nodes.filter((node) => node.manageable)
  const anchor = scope === 'org-node' ? orgNodeId || anchors[0]?.orgNodeId : undefined

  // the target is part of the query key, so changing it refetches rather than
  // leaving a role list that was answered for somewhere else
  const options = useQuery(
    orpc.access.getRoleGrantOptions.queryOptions({
      query: { userId, ...(anchor ? { orgNodeId: anchor, coverage } : {}) },
    }),
  )
  const roles = options.data?.roles ?? []
  const selected =
    roleId && roles.some((role) => role.id === roleId) ? roleId : (roles[0]?.id ?? '')

  const grant = useMutation({
    mutationFn: () =>
      run(
        api.access.createRoleGrant({
          payload: {
            userId,
            roleId: selected,
            target: anchor ? { kind: 'org-node', orgNodeId: anchor, coverage } : { kind: 'tenant' },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setRoleId('')
      await queryClient.invalidateQueries({ queryKey: orpc.access.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        grant.mutate()
      }}
    >
      <Feedback message={feedback} />
      <Field label={format(m.grantScope)}>
        {(id) => (
          <select
            id={id}
            className="h-9 rounded-md border px-2 text-sm"
            value={scope}
            onChange={(event) => setScope(event.target.value as 'tenant' | 'org-node')}
          >
            <option value="tenant">{format(m.grantScopeTenant)}</option>
            <option value="org-node">{format(m.grantScopeNode)}</option>
          </select>
        )}
      </Field>

      {scope === 'org-node' && (
        <>
          <Field label={format(m.grantScopeNode)}>
            {(id) => (
              <select
                id={id}
                className="h-9 rounded-md border px-2 text-sm"
                value={anchor ?? ''}
                onChange={(event) => setOrgNodeId(event.target.value)}
              >
                {anchors.map((node) => (
                  <option key={node.orgNodeId} value={node.orgNodeId}>
                    {`${' '.repeat(node.depth * 2)}${node.name}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={format(m.grantCoverage)}>
            {(id) => (
              <select
                id={id}
                className="h-9 rounded-md border px-2 text-sm"
                value={coverage}
                onChange={(event) => setCoverage(event.target.value as Coverage)}
              >
                <option value="self">{format(m.grantCoverageSelf)}</option>
                <option value="subtree">{format(m.grantCoverageSubtree)}</option>
              </select>
            )}
          </Field>
        </>
      )}

      <Field label={format(m.grantRole)}>
        {(id) => (
          <select
            id={id}
            className="h-9 rounded-md border px-2 text-sm"
            value={selected}
            disabled={roles.length === 0}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Button type="submit" size="sm" disabled={grant.isPending || selected === ''}>
        {format(m.grantSubmit)}
      </Button>

      {/* an empty list is an answer, not a missing one: this caller holds
          nothing that may be passed on at this target */}
      {!options.isPending && roles.length === 0 && (
        <p data-testid="grant-nothing-offered" className="w-full text-sm text-muted-foreground">
          {format(m.grantRolesEmpty)}
        </p>
      )}
    </form>
  )
}
