import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { orgNodePicker, peoplePicker } from '@qualy/ui-contract'
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
import { Steps } from '@qualy/ui/steps'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { RolePicker } from './RolePicker.tsx'

// Bringing somebody in for this round only, one question at a time.
//
// Three steps because the answers constrain each other in order: which roles
// can be offered depends on who and where, so asking for all three at once
// would mean showing a role list that is wrong until the other two are
// settled. Going back is free; going forward is not offered until the step
// has an answer.

const STEPS = [m.addStaffStepWho, m.addStaffStepWhere, m.addStaffStepAs] as const

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
  const { format } = useI18n()
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
  // Roles depend on who and where, and are asked for once both are settled.
  // Every chosen person is checked against every chosen unit and only what
  // holds everywhere is offered: an offer that is true of one pair and false
  // of another is not an answer.
  const probes = useQuery({
    ...query.assessment.staffOptions.queryOptions({
      params: { batchId },
      query: { userId: chosen[0] ?? '', orgNodeId: orgNodeIds[0] ?? '' },
    }),
    enabled: open && chosen.length > 0 && orgNodeIds.length > 0,
  })
  const roles = probes.data?.roles ?? []
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
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{format(m.addStaffTitle)}</DialogTitle>
          <DialogDescription>{format(m.addStaffHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-[58vh] flex-col gap-5">
          <Steps
            steps={STEPS.map((label) => format(label))}
            current={step}
            // a step already answered is a way back to it
            onSelect={(at) => at <= step && setStep(at)}
          />

          {step === 0 && (
            <div className="flex min-h-0 flex-1 flex-col">
              <UiSlot
                token={peoplePicker}
                context={{ value: chosen, onChange: setChosen }}
                fallback={
                  <p className="text-sm text-muted-foreground">{format(m.pickerUnavailable)}</p>
                }
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{format(m.addStaffWhereHint)}</p>
              <UiSlot
                token={orgNodePicker}
                context={{
                  value: orgNodeIds,
                  onChange: setOrgNodeIds,
                  // the units this round covers, not the whole organization
                  nodes: units.data?.nodes ?? [],
                  loading: units.isPending,
                }}
                fallback={
                  <p className="text-sm text-muted-foreground">{format(m.pickerUnavailable)}</p>
                }
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{format(m.addStaffAsHint)}</p>
              <RolePicker
                roles={roles}
                value={roleId}
                emptyLabel={format(m.addStaffNoRoles)}
                onChange={setRoleId}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((at) => Math.max(0, at - 1))}
          >
            {format(commonMessages.back)}
          </Button>
          <div className="flex items-center gap-2">
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
