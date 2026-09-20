import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// Giving somebody a role, which is two questions in one form: what the role is
// and where it applies.
//
// The order between them is not free. Which roles may be granted depends on
// the target - the server answers with the ones this caller holds widely
// enough to pass on, at that anchor, for that person's user type - so the
// target is chosen first and the role list is a function of it. Asking for the
// role first would mean offering roles that the target then invalidates, and
// the refusal would arrive from the server as a rejected submission.
//
// The unit is chosen through the picker whoever owns the organization
// contributes: which units this reader may even see is that owner's question,
// and the server still judges the anchor when the grant is written.
type Coverage = 'self' | 'subtree'

const styles = stylex.create({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 8,
  },
  scopeField: {
    width: '11rem',
  },
  coverageField: {
    width: '12rem',
  },
  roleField: {
    width: '14rem',
  },
  pickerSeat: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '32rem',
    flexDirection: 'column',
  },
  quietNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

export function GrantRoleForm({
  userId,
  onGranted,
}: {
  userId: string
  /** the grant landed; whoever opened the form may put it away */
  onGranted?: () => void
}) {
  const api = useApi(accessApi)
  const run = useRunApi()
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [scope, setScope] = useState<'tenant' | 'org-node'>('tenant')
  const [orgNodeId, setOrgNodeId] = useState('')
  const [coverage, setCoverage] = useState<Coverage>('subtree')
  const [roleId, setRoleId] = useState('')

  const anchor = scope === 'org-node' ? orgNodeId || undefined : undefined
  // a unit-anchored grant has no target until a unit is chosen, and the
  // server refuses to infer one from which parameters happen to be present
  const targeted = scope === 'tenant' || anchor !== undefined

  // the target is part of the query key, so changing it refetches rather than
  // leaving a role list that was answered for somewhere else
  const options = useQuery({
    ...query.access.getRoleGrantOptions.queryOptions({
      query: {
        userId,
        target: scope,
        ...(anchor !== undefined ? { orgNodeId: anchor, coverage } : {}),
      },
    }),
    enabled: targeted,
  })
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
            target:
              anchor !== undefined
                ? { kind: 'org-node', orgNodeId: anchor, coverage }
                : { kind: 'tenant' },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setRoleId('')
      await queryClient.invalidateQueries({ queryKey: query.access.key() })
      onGranted?.()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const picker: OrgNodePickerContext = {
    value: anchor === undefined ? [] : [anchor],
    onChange: (ids) => setOrgNodeId(ids[0] ?? ''),
    single: true,
  }

  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault()
        grant.mutate()
      }}
    >
      <Feedback message={feedback} />
      <div {...stylex.props(styles.row)}>
        <Field label={format(m.grantScope)}>
          {(id) => (
            <Select
              value={scope}
              onValueChange={(next) => setScope(next as 'tenant' | 'org-node')}
            >
              <SelectTrigger id={id} xstyle={styles.scopeField}>
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
          <Field label={format(m.grantCoverage)}>
            {(id) => (
              <Select value={coverage} onValueChange={(next) => setCoverage(next as Coverage)}>
                <SelectTrigger id={id} xstyle={styles.coverageField}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">{format(m.grantCoverageSelf)}</SelectItem>
                  <SelectItem value="subtree">{format(m.grantCoverageSubtree)}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
      </div>

      {scope === 'org-node' && (
        <div data-testid="grant-anchor" {...stylex.props(styles.pickerSeat)}>
          <UiSlot
            token={orgNodePicker}
            context={picker}
            fallback={
              <p {...stylex.props(styles.quietNote)}>{format(m.grantAnchorUnavailable)}</p>
            }
          />
        </div>
      )}

      <div {...stylex.props(styles.row)}>
        <Field label={format(m.grantRole)}>
          {(id) => (
            <Select
              value={selected}
              disabled={roles.length === 0}
              onValueChange={(next) => setRoleId(next)}
            >
              <SelectTrigger id={id} xstyle={styles.roleField}>
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
      </div>

      {/* an empty list is an answer, not a missing one: this caller holds
          nothing that may be passed on at this target */}
      {targeted && !options.isPending && roles.length === 0 && (
        <p data-testid="grant-nothing-offered" {...stylex.props(styles.quietNote)}>
          {format(m.grantRolesEmpty)}
        </p>
      )}
    </form>
  )
}
