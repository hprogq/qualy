import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { ShieldOffIcon } from 'lucide-react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Blank } from '@qualy/ui/screen'
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
// person or the place come back too, each with why, and so do offices the
// reader holds without being the one to fill them: both are shown as such
// rather than left for the reader to wonder about. Offices neither held nor
// the reader's to fill are none of their question and are not shown.
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
  // said where the role would be chosen, on the ground the field stood on
  nothing: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.divider,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceInset,
  },
  // each office with why, read down the left like the rest of the form
  refusals: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    listStyle: 'none',
    textAlign: 'start',
  },
  refusal: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: 8,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
    lineHeight: 1.45,
  },
  // a tenant's own office names run long and share their openings: the
  // whole name, over two lines when it needs them
  refusalName: { minWidth: 0, overflowWrap: 'anywhere' },
  refusalWhy: { flexShrink: 0, maxWidth: '45%', fontSize: 12, color: tokens.mutedForeground },
})

/**
 * What the offices refused here have in common, which decides the one
 * sentence said above them: a reason that is the unit's sends the reader to
 * another unit, one that is the person's or the reader's own does not.
 */
type RefusalSummary = 'none' | 'person-disabled' | 'org-type' | 'user-type' | 'authority' | 'mixed'

const summarize = (refused: readonly Refused[]): RefusalSummary => {
  if (refused.length === 0) return 'none'
  const first = refused[0]!.refusal
  if (!refused.every((role) => role.refusal === first)) return 'mixed'
  return first === 'person-disabled' ||
    first === 'org-type' ||
    first === 'user-type' ||
    first === 'authority'
    ? first
    : 'mixed'
}

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
  const reach = options.data?.reach ?? 'within'
  // One office on offer is the answer already; among several, the reader
  // says which, and nothing is given until they do. The administrator role
  // is never the answer on the reader's behalf: it is everything at once,
  // and two presses were enough to hand it over.
  const selected = roles.some((role) => role.id === roleId)
    ? roleId
    : roles.length === 1 && !roles[0]!.administrator
      ? roles[0]!.id
      : ''
  const chosen = roles.find((role) => role.id === selected)
  // asked once more before the administrator role is given
  const [confirming, setConfirming] = useState(false)
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
      const name = chosen?.name ?? ''
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

  const placeholder = !targeted
    ? format(m.grantPickUnitFirst)
    : !loaded
      ? format(m.grantRolesLoading)
      : roles.length === 0
        ? format(m.grantRolesNone)
        : format(m.grantRoleChoose)

  // Where the reader may not give authority of this reach, that is said
  // once, above every office, and nothing is listed under it.
  const summary: RefusalSummary | 'unit-only' | 'outside' =
    reach === 'within' ? summarize(refused) : reach
  // Nothing the reader can change in this form would put an office on offer:
  // the person is out of service, or the one scope the reader has has none.
  // The form then keeps only the way out.
  const stuck =
    loaded &&
    roles.length === 0 &&
    (summary === 'person-disabled' || (scope === 'tenant' && !grantable.organization))
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
              : refusal === 'authority'
                ? m.refusedAuthority
                : refusal === 'closed'
                  ? m.refusedClosed
                  : m.refusedUnavailable,
    )
  const said = {
    'person-disabled': m.grantNonePersonDisabled,
    'org-type': m.grantNoneRefusedUnit,
    'user-type': m.grantNoneRefusedUserType,
    authority: m.grantNoneRefusedAuthority,
    mixed: m.grantNoneRefusedMixed,
    none: scope === 'tenant' ? m.grantNoneTenant : m.grantNoneUnit,
    'unit-only': m.grantReachUnitOnly,
    outside: scope === 'tenant' ? m.grantNoneTenant : m.grantReachOutside,
  }[summary]
  const listed = summary !== 'person-disabled' && refused.length > 0

  return (
    <>
      <FormDialog
        open={open}
        title={format(m.grantOpen)}
        onClose={onClose}
        footer={
          stuck ? (
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.close)}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {format(commonMessages.cancel)}
              </Button>
              <Button type="submit" form={formId} disabled={grant.isPending || selected === ''}>
                {format(m.grantSubmit)}
              </Button>
            </>
          )
        }
      >
        <form
          id={formId}
          data-testid="grant-form"
          data-scope={scope}
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            if (selected === '' || grant.isPending) return
            if (chosen?.administrator === true) setConfirming(true)
            else grant.mutate()
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
                        <p {...stylex.props(styles.quietNote)}>
                          {format(m.grantAnchorUnavailable)}
                        </p>
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
              data-summary={summary}
            >
              <Blank
                size="compact"
                icon={<ShieldOffIcon aria-hidden />}
                title={format(m.grantRolesNone)}
                description={format(said)}
                xstyle={styles.nothing}
                action={
                  summary === 'unit-only' ? (
                    // the one change in this form that puts offices back on offer
                    <Button variant="outline" size="sm" onClick={() => setCoverage('self')}>
                      {format(m.grantReachUseSelf)}
                    </Button>
                  ) : (
                    listed && (
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
                    )
                  )
                }
              />
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
      <ConfirmDialog
        open={confirming}
        title={format(m.grantAdministratorTitle, { role: chosen?.name ?? '' })}
        description={format(m.grantAdministratorBody)}
        confirmLabel={format(m.grantSubmit)}
        cancelLabel={format(commonMessages.cancel)}
        pending={grant.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          grant.mutate()
        }}
      />
    </>
  )
}
