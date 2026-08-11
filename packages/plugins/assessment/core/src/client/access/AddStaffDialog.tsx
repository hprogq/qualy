import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { peoplePicker } from '@qualy/ui-contract'
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
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Bringing somebody in for this round only.
//
// Three answers, in the order they constrain each other: who, where, and as
// what. The roles come last because which ones can be offered depends on the
// first two - and they are the roles this caller could actually grant, asked
// of the server rather than worked out here, so the list cannot promise
// something the write refuses.

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
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [orgNodeId, setOrgNodeId] = useState('')
  const [roleId, setRoleId] = useState('')

  useEffect(() => {
    if (!open) return
    setChosen([])
    setOrgNodeId('')
    setRoleId('')
  }, [open])

  const userId = chosen[0]
  const options = useQuery({
    ...query.assessment.staffOptions.queryOptions({
      params: { batchId },
      query: {
        ...(userId !== undefined ? { userId } : {}),
        ...(orgNodeId !== '' ? { orgNodeId } : {}),
      },
    }),
    enabled: open,
  })
  const roles = options.data?.roles ?? []
  // a role that is no longer on offer stops being the answer
  useEffect(() => {
    if (roleId !== '' && !roles.some((role) => role.id === roleId)) setRoleId('')
  }, [roles, roleId])

  const ready = userId !== undefined && orgNodeId !== '' && roleId !== ''

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{format(m.addStaffTitle)}</DialogTitle>
          <DialogDescription>{format(m.addStaffHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <UiSlot
            token={peoplePicker}
            context={{ value: chosen, onChange: setChosen, single: true }}
            fallback={
              <p className="text-sm text-muted-foreground">{format(m.pickerUnavailable)}</p>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              {format(m.addStaffWhere)}
              <NativeSelect
                value={orgNodeId}
                onChange={(event) => setOrgNodeId(event.target.value)}
              >
                <option value="">{format(m.addStaffPickUnit)}</option>
                {(options.data?.nodes ?? []).map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              {format(m.addStaffAs)}
              <NativeSelect
                value={roleId}
                disabled={userId === undefined || orgNodeId === ''}
                onChange={(event) => setRoleId(event.target.value)}
              >
                <option value="">
                  {roles.length === 0 && userId !== undefined && orgNodeId !== ''
                    ? format(m.addStaffNoRoles)
                    : format(m.addStaffPickRole)}
                </option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            disabled={pending || !ready}
            onClick={() => ready && onAdd({ userId, orgNodeId, roleId })}
          >
            {format(m.addStaffConfirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
