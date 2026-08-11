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
  onAdd: (input: { userId: string; orgNodeId: string; roleId: string }) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [orgNodeId, setOrgNodeId] = useState<string | null>(null)
  const [roleId, setRoleId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setChosen([])
    setOrgNodeId(null)
    setRoleId(null)
  }, [open])

  const userId = chosen[0]
  const options = useQuery({
    ...query.assessment.staffOptions.queryOptions({
      params: { batchId },
      query: {
        ...(userId !== undefined ? { userId } : {}),
        ...(orgNodeId !== null ? { orgNodeId } : {}),
      },
    }),
    enabled: open,
  })
  const roles = options.data?.roles ?? []
  // a role that stopped being on offer stops being the answer
  useEffect(() => {
    if (roleId !== null && !roles.some((role) => role.id === roleId && role.refusal === null)) {
      setRoleId(null)
    }
  }, [roles, roleId])

  const answered = [userId !== undefined, orgNodeId !== null, roleId !== null]
  const ready = userId !== undefined && orgNodeId !== null && roleId !== null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{format(m.addStaffTitle)}</DialogTitle>
          <DialogDescription>{format(m.addStaffHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <Steps
            steps={STEPS.map((label) => format(label))}
            current={step}
            // a step already answered is a way back to it
            onSelect={(at) => at <= step && setStep(at)}
          />

          {step === 0 && (
            <UiSlot
              token={peoplePicker}
              context={{ value: chosen, onChange: setChosen, single: true }}
              fallback={
                <p className="text-sm text-muted-foreground">{format(m.pickerUnavailable)}</p>
              }
            />
          )}

          {step === 1 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{format(m.addStaffWhereHint)}</p>
              <UiSlot
                token={orgNodePicker}
                context={{
                  value: orgNodeId,
                  onChange: setOrgNodeId,
                  // the units this round covers, not the whole organization
                  nodes: options.data?.nodes ?? [],
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
                onClick={() => ready && onAdd({ userId, orgNodeId, roleId })}
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
