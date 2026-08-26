import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { NodePicker } from './NodePicker.tsx'

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

const styles = stylex.create({
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  anchorPicker: {
    width: '14rem',
  },
  nothingNote: {
    width: '100%',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

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
      // the target is said outright: the server refuses to infer it from
      // which parameters happen to be present
      query: {
        userId,
        target: scope,
        ...(scope === 'org-node' && anchor ? { orgNodeId: anchor, coverage } : {}),
      },
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
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault()
        grant.mutate()
      }}
    >
      <Feedback message={feedback} />
      <Field label={format(m.grantScope)}>
        {(id) => (
          <Select value={scope} onValueChange={(next) => setScope(next as 'tenant' | 'org-node')}>
            <SelectTrigger id={id} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tenant">{format(m.grantScopeTenant)}</SelectItem>
              <SelectItem value="org-node">{format(m.grantScopeNode)}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      {scope === 'org-node' && (
        <>
          <Field label={format(m.grantScopeNode)}>
            {(id) => (
              <NodePicker
                id={id}
                label={format(m.grantScopeNode)}
                nodes={anchors}
                value={anchor ?? ''}
                onChange={setOrgNodeId}
                placeholder={format(m.grantScopeNode)}
                xstyle={styles.anchorPicker}
              />
            )}
          </Field>
          <Field label={format(m.grantCoverage)}>
            {(id) => (
              <Select value={coverage} onValueChange={(next) => setCoverage(next as Coverage)}>
                <SelectTrigger id={id} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">{format(m.grantCoverageSelf)}</SelectItem>
                  <SelectItem value="subtree">{format(m.grantCoverageSubtree)}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </>
      )}

      <Field label={format(m.grantRole)}>
        {(id) => (
          <Select
            value={selected}
            disabled={roles.length === 0}
            onValueChange={(next) => setRoleId(next)}
          >
            <SelectTrigger id={id} className="w-56">
              <SelectValue placeholder={format(m.grantRole)} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Button type="submit" size="sm" disabled={grant.isPending || selected === ''}>
        {format(m.grantSubmit)}
      </Button>

      {/* an empty list is an answer, not a missing one: this caller holds
          nothing that may be passed on at this target */}
      {!options.isPending && roles.length === 0 && (
        <p data-testid="grant-nothing-offered" {...stylex.props(styles.nothingNote)}>
          {format(m.grantRolesEmpty)}
        </p>
      )}
    </form>
  )
}
