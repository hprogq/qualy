import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useQuery } from '@tanstack/react-query'
import { CircleAlertIcon, NetworkIcon, ShieldQuestionIcon, UsersIcon } from 'lucide-react'
import { PageLink, UiSlot, useApiQuery, useManifest } from '@qualy/web-runtime'
import {
  orgNodePickerView,
  peoplePicker,
  peoplePickerView,
  type PeoplePickerContext,
} from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'

import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { Steps } from '@qualy/ui/steps'
import { assessmentApi } from '../api.ts'

import { DialogBlank } from '../DialogBlank.tsx'
import { useCandidates } from '../roster/candidates.ts'
import { RolePicker } from './RolePicker.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Bringing somebody in for this round only, one question at a time.
//
// Three steps because the answers constrain each other in order: which roles
// can be offered depends on who and where, so asking for all three at once
// would mean showing a role list that is wrong until the other two are
// settled. Going back is free; going forward is not offered until the step
// has an answer.
//
// Who comes from the directory where the reader may browse it: whom a role
// may be given to is the appointment rules' question, not the round's, and
// the directory reaches people whose place is outside what this reader
// manages. A reader who may not browse it chooses among the people this
// round's administrator manages, drawn by the picker's permission-free view
// - the directory's own picker drew nothing for them. Where comes from this
// domain either way: the units this round covers. The role step then asks,
// for every person and unit chosen, which roles hold.

const STEPS = [
  m.access_addStaffStepWho,
  m.access_addStaffStepWhere,
  m.access_addStaffStepAs,
] as const

const styles = stylex.create({
  // a fixed height, so the step that holds a picker does not resize the
  // dialog as the reader walks through the steps; the picker grows into it
  panel: { height: 'min(90dvh, 48rem)' },
  body: { gap: 20 },
  step: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // takes the height the step gives it, so the picker inside can grow into
  // the dialog rather than overflow it and raise a second scrollbar
  stepWords: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column', gap: 8 },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  waitingRoles: { height: '8rem', width: '100%' },
  waitingFill: { minHeight: 0, width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  waitingTree: { minHeight: '16rem', width: '100%', flexGrow: 1 },
  foot: {
    justifyContent: {
      default: null,
      [breakpoints.tablet]: 'space-between',
      [breakpoints.desktop]: 'space-between',
    },
  },
  footSide: { display: 'flex', alignItems: 'center', gap: 8 },
})

/**
 * Where and as what, already answered: somebody sent here to fill a seat -
 * a review step nobody holds at a unit - only has to say who. The reader
 * still walks every step and may change either answer.
 */
export interface AddStaffInitial {
  readonly orgNodeIds?: readonly string[]
  readonly roleId?: string
}

export function AddStaffDialog({
  batchId,
  open,
  pending,
  initial,
  onAdd,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  /** the unit and the role to start from, each dropped if it is not on offer */
  initial?: AddStaffInitial
  onAdd: (input: {
    userIds: readonly string[]
    orgNodeIds: readonly string[]
    roleId: string
  }) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { formatError } = useI18n()
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [unitIds, setUnitIds] = useState<readonly string[]>([])
  const [roleId, setRoleId] = useState<string | null>(null)

  // the starting answers as values, so a caller that builds them afresh on
  // every render does not start the dialog over
  const seedUnits = (initial?.orgNodeIds ?? []).join(' ')
  const seedRole = initial?.roleId ?? ''
  useEffect(() => {
    if (!open) return
    setStep(0)
    setChosen([])
    setUnitIds(seedUnits === '' ? [] : seedUnits.split(' '))
    setRoleId(seedRole === '' ? null : seedRole)
  }, [open, seedUnits, seedRole])

  // The units are asked for on their own, with nothing about the selection in
  // the question: sharing one request with the roles meant every click
  // refetched the tree, and a tree that reloads collapses back to the top
  // while somebody is halfway down it.
  const units = useQuery({
    ...query.assessment.staffOptions.queryOptions({ params: { batchId }, query: {} }),
    enabled: open,
  })
  // the units chosen that this round offers: one the dialog was opened with
  // that it does not offer is never quietly appointed at
  const orgNodeIds = useMemo(() => {
    if (units.data === undefined) return unitIds
    const offered = new Set(units.data.nodes.map((node) => node.id))
    return unitIds.every((id) => offered.has(id))
      ? unitIds
      : unitIds.filter((id) => offered.has(id))
  }, [units.data, unitIds])
  // who may be brought in: the directory's people when the reader may
  // browse them - the directory's picker is delivered only then - and
  // otherwise the people this reader manages, the population the roster's
  // own add dialog offers
  const directory = (useManifest().slots[peoplePicker.key]?.length ?? 0) > 0
  const candidates = useCandidates(batchId, open && !directory)
  // Roles depend on who and where, and are asked for once both are settled.
  // Every chosen person is checked against every chosen unit and only what
  // holds everywhere is offered: an offer that is true of one pair and false
  // of another is not an answer.
  const probes = useQuery({
    ...query.assessment.staffOptions.queryOptions({
      params: { batchId },
      query: { userIds: chosen, orgNodeIds },
    }),
    enabled: open && chosen.length > 0 && orgNodeIds.length > 0,
  })
  const roles = useMemo(() => probes.data?.roles ?? [], [probes.data])
  // A role that is not on offer stops being the answer, once the offer is
  // known: before it is, a role the dialog was opened with is kept.
  useEffect(() => {
    if (probes.data === undefined || roleId === null) return
    if (!probes.data.roles.some((role) => role.id === roleId && role.refusal === null)) {
      setRoleId(null)
    }
  }, [probes.data, roleId])

  const answered = [chosen.length > 0, orgNodeIds.length > 0, roleId !== null]
  const ready = chosen.length > 0 && orgNodeIds.length > 0 && roleId !== null
  // Staff are appointed at the units this round's people stand in. With none
  // of those in the reader's reach there is nowhere to appoint anybody, and
  // saying so before the first step beats walking them through choosing a
  // person for nothing.
  const nowhere = units.data !== undefined && units.data.nodes.length === 0

  const pickerMissing = (unit: boolean) => (
    <DialogBlank
      testId="add-staff-unavailable"
      icon={<ShieldQuestionIcon />}
      title={(unit ? m.roster_unitPickerUnavailable : m.roster_pickerUnavailable)()}
      description={m.roster_pickerUnavailableHint()}
    />
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* the picker's height only where there is a picker: an answer that
          there is nowhere to appoint anybody is a dialog's size */}
      <DialogContent
        size={nowhere ? '36rem' : '68rem'}
        {...(nowhere ? {} : { xstyle: styles.panel })}
      >
        <DialogHeader>
          <DialogTitle>{m.access_addStaffTitle()}</DialogTitle>
          {!nowhere && <DialogDescription>{m.access_addStaffHint()}</DialogDescription>}
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          {nowhere ? (
            <DialogBlank
              testId="add-staff-nowhere"
              icon={<UsersIcon />}
              title={m.access_addStaffNowhere()}
              description={m.access_addStaffNowhereHint()}
              action={
                <Button variant="outline" size="sm" asChild>
                  <PageLink page="assessment/batch-results" params={{ batchId }}>
                    {m.access_addStaffGoRoster()}
                  </PageLink>
                </Button>
              }
            />
          ) : (
            <>
              <Steps
                steps={STEPS.map((label) => label())}
                current={step}
                // a step already answered is a way back to it
                onSelect={(at) => at <= step && setStep(at)}
              />

              {step === 0 && (
                <div {...stylex.props(styles.step)}>
                  {directory ? (
                    <UiSlot
                      token={peoplePicker}
                      context={{ value: chosen, onChange: setChosen } satisfies PeoplePickerContext}
                      fallback={pickerMissing(false)}
                      loading={<Skeleton className={stylex.props(styles.waitingFill).className} />}
                    />
                  ) : (
                    <UiSlot
                      token={peoplePickerView}
                      context={candidates.context({
                        value: chosen,
                        onToggle: (userId: string) =>
                          setChosen((now) =>
                            now.includes(userId)
                              ? now.filter((id) => id !== userId)
                              : [...now, userId],
                          ),
                        onChange: setChosen,
                      })}
                      fallback={pickerMissing(false)}
                      loading={<Skeleton className={stylex.props(styles.waitingFill).className} />}
                    />
                  )}
                </div>
              )}

              {step === 1 && units.isError && (
                // the units could not be read: said, with the way to ask again,
                // rather than a picker drawn over nothing
                <DialogBlank
                  testId="add-staff-units-failed"
                  icon={<NetworkIcon />}
                  title={m.access_addStaffUnitsFailed()}
                  description={formatError(units.error)}
                  action={
                    <Button variant="outline" size="sm" onClick={() => void units.refetch()}>
                      {commonMessages.action_retry()}
                    </Button>
                  }
                />
              )}

              {step === 1 && !units.isError && (
                <div {...stylex.props(styles.stepWords)}>
                  <p {...stylex.props(styles.quiet)}>{m.access_addStaffWhereHint()}</p>
                  <UiSlot
                    token={orgNodePickerView}
                    context={{
                      value: orgNodeIds,
                      onChange: setUnitIds,
                      // the units this round covers, not the whole organization
                      nodes: units.data?.nodes ?? [],
                      loading: units.isPending,
                    }}
                    fallback={pickerMissing(true)}
                    loading={<Skeleton className={stylex.props(styles.waitingTree).className} />}
                  />
                </div>
              )}

              {step === 2 && (
                <div {...stylex.props(styles.stepWords)}>
                  <p {...stylex.props(styles.quiet)}>{m.access_addStaffAsHint()}</p>
                  {/* a selection the server will not answer for - too many
                  people and units at once - is said as that, not as a
                  list of roles that happens to be empty */}
                  {probes.isError ? (
                    <div role="alert">
                      <DialogBlank
                        testId="add-staff-refused"
                        icon={<CircleAlertIcon />}
                        title={formatError(probes.error)}
                        action={
                          <Button variant="outline" size="sm" onClick={() => setStep(0)}>
                            {m.access_addStaffChangeSelection()}
                          </Button>
                        }
                      />
                    </div>
                  ) : probes.isLoading ? (
                    <Skeleton className={stylex.props(styles.waitingRoles).className} />
                  ) : (
                    <RolePicker
                      roles={roles}
                      value={roleId}
                      // not one role could even be considered for this person
                      // at this unit: the unit is what they can change here
                      empty={
                        <DialogBlank
                          testId="add-staff-no-roles"
                          icon={<ShieldQuestionIcon />}
                          title={m.access_addStaffNoRoles()}
                          description={m.access_addStaffNoRolesHint()}
                          action={
                            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                              {m.access_addStaffChangeUnit()}
                            </Button>
                          }
                        />
                      }
                      onChange={setRoleId}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </DialogBody>
        {nowhere ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {commonMessages.action_close()}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className={stylex.props(styles.foot).className}>
            <Button
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((at) => Math.max(0, at - 1))}
            >
              {commonMessages.action_back()}
            </Button>
            <div {...stylex.props(styles.footSide)}>
              <Button variant="outline" onClick={onClose}>
                {commonMessages.action_cancel()}
              </Button>
              {step < 2 ? (
                <Button disabled={!answered[step]} onClick={() => setStep((at) => at + 1)}>
                  {m.action_next()}
                </Button>
              ) : (
                <Button
                  disabled={pending || !ready}
                  onClick={() => ready && onAdd({ userIds: chosen, orgNodeIds, roleId })}
                >
                  {m.access_addStaffConfirm()}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
