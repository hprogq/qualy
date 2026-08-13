import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { SheetGroup } from './PaperSheet.tsx'

// One section of the paper: its name and its limits. Three fields, so a
// dialog rather than a pane.
//
// Saving sends the whole tree because that is what the api takes - and every
// row keeps the id it came with, which is what tells the server this is the
// same group rather than a new one replacing it.

export function GroupDialog({
  batchId,
  batchStatus,
  groups,
  editing,
  parentId,
  onClose,
  onDone,
}: {
  batchId: string
  batchStatus: string
  groups: readonly SheetGroup[]
  /** the group being edited, or null when composing a new one */
  editing: SheetGroup | null
  /** where a new group goes; ignored when editing */
  parentId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [name, setName] = useState(editing?.name ?? '')
  const [cap, setCap] = useState(editing?.cap ?? '')
  const [floor, setFloor] = useState(editing?.floor ?? '')
  const [reason, setReason] = useState('')
  const [refusals, setRefusals] = useState<readonly { reason: string; groupId: string | null }[]>(
    [],
  )

  const parent = groups.find((group) => group.id === (editing?.parentGroupId ?? parentId)) ?? null

  const specOf = (group: SheetGroup) => ({
    id: group.id,
    parentGroupId: group.parentGroupId,
    name: group.name,
    cap: group.cap,
    floor: group.floor,
  })

  const onError = (error: unknown) => {
    const invalid = error as { refusals?: readonly { reason: string; groupId: string | null }[] }
    if (Array.isArray(invalid.refusals)) setRefusals(invalid.refusals)
    else toast.error(formatError(error))
  }

  const save = useMutation({
    mutationFn: () => {
      const values = {
        name: name.trim(),
        cap: cap.trim() === '' ? null : cap.trim(),
        floor: floor.trim() === '' ? null : floor.trim(),
      }
      const edited = groups.map((group) =>
        group.id === editing?.id ? { ...specOf(group), ...values } : specOf(group),
      )
      const created = editing === null ? [{ parentGroupId: parentId, ...values }] : []
      return run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: [...edited, ...created],
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      )
    },
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      onDone()
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: () =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: groups.filter((group) => group.id !== editing?.id).map(specOf),
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      ),
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      onDone()
    },
    onError,
  })

  return (
    <FormDialog
      open
      title={editing === null ? format(m.itemsGroupNew) : format(m.itemsGroupEditing)}
      {...(parent !== null
        ? { description: format(m.itemsGroupInside, { parent: parent.name }) }
        : {})}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {editing !== null && (
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {format(m.itemsGroupRemove)}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
              {format(m.entrySave)}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={format(m.itemsGroupName)}>
          {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={format(m.itemsGroupCap)} hint={format(m.itemsGroupCapHint)}>
            {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
          </Field>
          <Field label={format(m.itemsGroupFloor)} hint={format(m.itemsGroupFloorHint)}>
            {(id) => (
              <Input id={id} value={floor} onChange={(event) => setFloor(event.target.value)} />
            )}
          </Field>
        </div>
        {batchStatus === 'active' && (
          <Field label={format(m.itemsFieldReason)} hint={format(m.itemsGroupsReasonHint)}>
            {(id) => (
              <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
            )}
          </Field>
        )}
        {refusals.length > 0 && (
          <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {refusals.map((refusal, index) => (
              <li key={index}>
                {groups.find((group) => group.id === refusal.groupId)?.name ?? ''}{' '}
                {format(GROUP_REFUSALS[refusal.reason] ?? m.itemsGroupRefusedOther)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  )
}

const GROUP_REFUSALS: Record<string, MessageDescriptor> = {
  'group-has-items': m.itemsGroupRefusedHasItems,
  'group-has-children': m.itemsGroupRefusedHasChildren,
  'floor-above-cap': m.itemsGroupRefusedFloorAboveCap,
  'reason-required': m.itemsGroupRefusedReason,
  'parent-not-in-batch': m.itemsGroupRefusedParent,
  'parent-is-self': m.itemsGroupRefusedParent,
  'parent-cycle': m.itemsGroupRefusedParent,
}
