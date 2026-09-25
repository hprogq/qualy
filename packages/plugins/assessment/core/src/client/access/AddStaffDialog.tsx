import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useQuery } from '@tanstack/react-query'
import { UiSlot, useApiQuery, useManifest } from '@qualy/web-runtime'
import {
  orgNodePickerView,
  peoplePicker,
  peoplePickerView,
  type PeoplePickerContext,
} from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
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
import { assessmentMessages as m } from '../i18n.ts'
import { useCandidates } from '../roster/candidates.ts'
import { RolePicker } from './RolePicker.tsx'

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

const STEPS = [m.addStaffStepWho, m.addStaffStepWhere, m.addStaffStepAs] as const

const styles = stylex.create({
  // a fixed height, so the step that holds a picker does not resize the
  // dialog as the reader walks through the steps
  body: { height: '58vh', gap: 20 },
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
  refused: { fontSize: 14, lineHeight: '1.25rem', color: tokens.danger },
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

export function AddStaffDialog({
  batchId,
  open,
  pending,
  onAdd,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onAdd: (input: {
    userIds: readonly string[]
    orgNodeIds: readonly string[]
    roleId: string
  }) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [orgNodeIds, setOrgNodeIds] = useState<readonly string[]>([])
  const [roleId, setRoleId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setChosen([])
    setOrgNodeIds([])
    setRoleId(null)
  }, [open])

  // The units are asked for on their own, with nothing about the selection in
  // the question: sharing one request with the roles meant every click
  // refetched the tree, and a tree that reloads collapses back to the top
  // while somebody is halfway down it.
  const units = useQuery({
    ...query.assessment.staffOptions.queryOptions({ params: { batchId }, query: {} }),
    enabled: open,
  })
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
  // a role that stopped being on offer stops being the answer
  useEffect(() => {
    if (roleId !== null && !roles.some((role) => role.id === roleId && role.refusal === null)) {
      setRoleId(null)
    }
  }, [roles, roleId])

  const answered = [chosen.length > 0, orgNodeIds.length > 0, roleId !== null]
  const ready = chosen.length > 0 && orgNodeIds.length > 0 && roleId !== null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="56rem">
        <DialogHeader>
          <DialogTitle>{format(m.addStaffTitle)}</DialogTitle>
          <DialogDescription>{format(m.addStaffHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <Steps
            steps={STEPS.map((label) => format(label))}
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
                  fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
                  loading={<Skeleton className={stylex.props(styles.waitingFill).className} />}
                />
              ) : (
                <UiSlot
                  token={peoplePickerView}
                  context={candidates.context({
                    value: chosen,
                    onToggle: (userId: string) =>
                      setChosen((now) =>
                        now.includes(userId) ? now.filter((id) => id !== userId) : [...now, userId],
                      ),
                  })}
                  fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
                  loading={<Skeleton className={stylex.props(styles.waitingFill).className} />}
                />
              )}
            </div>
          )}

          {step === 1 && (
            <div {...stylex.props(styles.stepWords)}>
              <p {...stylex.props(styles.quiet)}>{format(m.addStaffWhereHint)}</p>
              <UiSlot
                token={orgNodePickerView}
                context={{
                  value: orgNodeIds,
                  onChange: setOrgNodeIds,
                  // the units this round covers, not the whole organization
                  nodes: units.data?.nodes ?? [],
                  loading: units.isPending,
                }}
                fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
                loading={<Skeleton className={stylex.props(styles.waitingTree).className} />}
              />
            </div>
          )}

          {step === 2 && (
            <div {...stylex.props(styles.stepWords)}>
              <p {...stylex.props(styles.quiet)}>{format(m.addStaffAsHint)}</p>
              {/* a selection the server will not answer for - too many
                  people and units at once - is said as that, not as a
                  list of roles that happens to be empty */}
              {probes.isError ? (
                <p {...stylex.props(styles.refused)} data-testid="add-staff-refused" role="alert">
                  {formatError(probes.error)}
                </p>
              ) : probes.isLoading ? (
                <Skeleton className={stylex.props(styles.waitingRoles).className} />
              ) : (
                <RolePicker
                  roles={roles}
                  value={roleId}
                  emptyLabel={format(m.addStaffNoRoles)}
                  onChange={setRoleId}
                />
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter className={stylex.props(styles.foot).className}>
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((at) => Math.max(0, at - 1))}
          >
            {format(commonMessages.back)}
          </Button>
          <div {...stylex.props(styles.footSide)}>
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            {step < 2 ? (
              <Button disabled={!answered[step]} onClick={() => setStep((at) => at + 1)}>
                {format(m.next)}
              </Button>
            ) : (
              <Button
                disabled={pending || !ready}
                onClick={() => ready && onAdd({ userIds: chosen, orgNodeIds, roleId })}
              >
                {format(m.addStaffConfirm)}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
