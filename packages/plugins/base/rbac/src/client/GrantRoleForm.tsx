import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@qualy/ui/select'
import { toast } from '@qualy/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// Giving somebody a role, which is two questions in one form: where it
// applies and what the role is.
//
// The order between them is not free. Which roles may be given depends on
// the place - the server answers with the offices this reader may fill, at
// that anchor, for that person - so the place is chosen first and the role
// list is a function of it. Offices the reader may fill that do not fit the
// person or the place come back too, each with why, and are shown as such
// rather than left for the reader to wonder about; offices that are not the
// reader's to fill are none of their question and are not shown.
//
// The unit is chosen through the picker whoever owns the organization
// contributes: which units this reader may even see is that owner's
// question, and the server still judges the anchor when the grant is written.
type Coverage = 'self' | 'subtree'
type Scope = 'tenant' | 'org-node'
type Refused = ApiResult<typeof accessApi, 'access', 'getRoleGrantOptions'>['refused'][number]

const styles = stylex.create({
  // one question under another, each the width of the dialog
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { width: '100%' },
  pickerSeat: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  quietNote: {
    margin: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  // said where the role would be chosen, at the size of the field it stands for
  nothing: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBlock: 14,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.divider,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceInset,
  },
  nothingTitle: { fontSize: 14, lineHeight: 1.4, fontWeight: 600 },
  nothingWhy: { fontSize: 13, lineHeight: 1.5, color: tokens.mutedForeground },
  refusals: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    margin: 0,
    marginTop: 8,
    paddingTop: 10,
    paddingInline: 0,
    paddingBottom: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    listStyle: 'none',
  },
  refusal: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 13,
  },
  refusalName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  refusalWhy: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground },
})

/**
 * The form, in its dialog. Mounted afresh for every opening by whoever opens
 * it: what was picked the last time is not an answer to this question.
 */
export function GrantRoleDialog({
  userId,
  open,
  onClose,
  grantable,
}: {
  userId: string
  open: boolean
  onClose: () => void
  /** where the reader may give anything at all, as the server said */
  grantable: { tenant: boolean; organization: boolean }
}) {
  const api = useApi(accessApi)
  const run = useRunApi()
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const formId = useId()
  const [feedback, setFeedback] = useState<string | null>(null)
  // a unit first where the reader may give there at all: that is where
  // nearly every office is held
  const [scope, setScope] = useState<Scope>(grantable.organization ? 'org-node' : 'tenant')
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
    enabled: open && targeted,
  })
  const roles = options.data?.roles ?? []
  const refused = options.data?.refused ?? []
  // one office on offer is the answer already; among several, the reader
  // says which, and nothing is given until they do
  const selected = roles.some((role) => role.id === roleId)
    ? roleId
    : roles.length === 1
      ? roles[0]!.id
      : ''
  const loaded = targeted && options.data !== undefined

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
      const name = roles.find((role) => role.id === selected)?.name ?? ''
      await queryClient.invalidateQueries({ queryKey: query.access.key() })
      toast.success(format(m.grantDone, { role: name }))
      onClose()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const picker: OrgNodePickerContext = {
    value: anchor === undefined ? [] : [anchor],
    onChange: (ids) => setOrgNodeId(ids[0] ?? ''),
    single: true,
    radio: true,
  }

  const why = (refusal: Refused['refusal']) =>
    format(
      refusal === 'user-type'
        ? m.refusedUserType
        : refusal === 'org-type'
          ? m.refusedOrgType
          : refusal === 'person-disabled'
            ? m.refusedPersonDisabled
            : refusal === 'self-escalation'
              ? m.refusedSelfEscalation
              : m.refusedUnavailable,
    )

  const placeholder = !targeted
    ? format(m.grantPickUnitFirst)
    : !loaded
      ? format(m.grantRolesLoading)
      : roles.length === 0
        ? format(m.grantRolesNone)
        : format(m.grantRoleChoose)

  // everything refused for the one reason that is the person's, not the role's
  const personDisabled =
    refused.length > 0 && refused.every((role) => role.refusal === 'person-disabled')

  return (
    <FormDialog
      open={open}
      title={format(m.grantOpen)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button type="submit" form={formId} disabled={grant.isPending || selected === ''}>
            {format(m.grantSubmit)}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        data-testid="grant-form"
        data-scope={scope}
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          if (selected !== '' && !grant.isPending) grant.mutate()
        }}
      >
        <Feedback message={feedback} />
        {grantable.tenant && grantable.organization && (
          <Field label={format(m.grantScope)}>
            {() => (
              <ToggleGroup
                fill
                aria-label={format(m.grantScope)}
                value={scope}
                onValueChange={(next) => {
                  if (next === '') return
                  setScope(next as Scope)
                  setRoleId('')
                  setFeedback(null)
                }}
              >
                <ToggleGroupItem value="org-node">{format(m.grantScopeNode)}</ToggleGroupItem>
                <ToggleGroupItem value="tenant">{format(m.grantScopeTenant)}</ToggleGroupItem>
              </ToggleGroup>
            )}
          </Field>
        )}

        {scope === 'org-node' && (
          <>
            <Field label={format(m.grantAnchor)}>
              {() => (
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
            </Field>
            <Field label={format(m.grantCoverage)}>
              {() => (
                <ToggleGroup
                  fill
                  aria-label={format(m.grantCoverage)}
                  value={coverage}
                  onValueChange={(next) => {
                    if (next === '') return
                    setCoverage(next as Coverage)
                  }}
                >
                  <ToggleGroupItem value="self">{format(m.grantCoverageSelf)}</ToggleGroupItem>
                  <ToggleGroupItem value="subtree">
                    {format(m.grantCoverageSubtree)}
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </Field>
          </>
        )}

        {loaded && roles.length === 0 ? (
          // Nothing to choose is an answer, not a missing one: said where the
          // role would be chosen, with the offices that do not fit and why,
          // so the reader knows whether to pick another unit or look elsewhere.
          <div
            data-testid="grant-nothing-offered"
            data-refused={refused.length}
            {...stylex.props(styles.nothing)}
          >
            <span {...stylex.props(styles.nothingTitle)}>{format(m.grantRolesNone)}</span>
            <span {...stylex.props(styles.nothingWhy)}>
              {format(
                personDisabled
                  ? m.grantNonePersonDisabled
                  : refused.length > 0
                    ? scope === 'tenant'
                      ? m.grantNoneRefusedTenant
                      : m.grantNoneRefusedUnit
                    : scope === 'tenant'
                      ? m.grantNoneTenant
                      : m.grantNoneUnit,
              )}
            </span>
            {!personDisabled && refused.length > 0 && (
              <ul {...stylex.props(styles.refusals)}>
                {refused.map((role) => (
                  <li
                    key={role.id}
                    data-testid="grant-refused"
                    data-refusal={role.refusal}
                    {...stylex.props(styles.refusal)}
                  >
                    <span {...stylex.props(styles.refusalName)}>{role.name}</span>
                    <span {...stylex.props(styles.refusalWhy)}>{why(role.refusal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Field label={format(m.grantRole)}>
            {(id) => (
              <Select
                value={selected}
                disabled={!loaded || roles.length === 0}
                onValueChange={(next) => setRoleId(next)}
              >
                <SelectTrigger id={id} xstyle={styles.field}>
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                  {refused.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>{format(m.grantRefusedGroup)}</SelectLabel>
                        {refused.map((role) => (
                          <SelectItem
                            key={role.id}
                            value={role.id}
                            disabled
                            description={why(role.refusal)}
                          >
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
      </form>
    </FormDialog>
  )
}
