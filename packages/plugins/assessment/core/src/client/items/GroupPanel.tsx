import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { OutlineGroup } from './PaperOutline.tsx'

// One section of the paper: what it is called and what it is worth at most.
//
// Saving sends the whole tree because that is what the api takes - and every
// row keeps the id it came with, which is what tells the server this is the
// same group rather than a new one replacing it. A row that lost its id
// would be read as "delete this and make another", and a section with
// questions in it cannot be deleted, so the whole save would be refused.

export function GroupPanel({
  batchId,
  batchStatus,
  groups,
  editing,
  parentId,
  onSaved,
  onCancel,
}: {
  batchId: string
  batchStatus: string
  groups: readonly OutlineGroup[]
  /** the group being edited, or null when composing a new one */
  editing: OutlineGroup | null
  /** where a new group goes; ignored when editing */
  parentId: string | null
  onSaved: (groupId: string | null) => void
  onCancel: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [name, setName] = useState('')
  const [cap, setCap] = useState('')
  const [floor, setFloor] = useState('')
  const [reason, setReason] = useState('')
  const [refusals, setRefusals] = useState<readonly { reason: string; groupId: string | null }[]>(
    [],
  )

  useEffect(() => {
    setName(editing?.name ?? '')
    setCap(editing?.cap ?? '')
    setFloor(editing?.floor ?? '')
    setReason('')
    setRefusals([])
  }, [editing])

  const parent = groups.find((group) => group.id === (editing?.parentGroupId ?? parentId)) ?? null

  const specOf = (group: OutlineGroup) => ({
    id: group.id,
    parentGroupId: group.parentGroupId,
    name: group.name,
    cap: group.cap,
    floor: group.floor,
  })

  const save = useMutation({
    mutationFn: () => {
      const edited = groups.map((group) =>
        group.id === editing?.id
          ? {
              ...specOf(group),
              name: name.trim(),
              cap: cap.trim() === '' ? null : cap.trim(),
              floor: floor.trim() === '' ? null : floor.trim(),
            }
          : specOf(group),
      )
      const created =
        editing === null
          ? [
              {
                parentGroupId: parentId,
                name: name.trim(),
                cap: cap.trim() === '' ? null : cap.trim(),
                floor: floor.trim() === '' ? null : floor.trim(),
              },
            ]
          : []
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
    onSuccess: (result: { groups: readonly { id: string; name: string }[] }) => {
      toast.success(format(m.itemsGroupsSaved))
      onSaved(result.groups.find((group) => group.name === name.trim())?.id ?? null)
    },
    onError: (error: unknown) => {
      const invalid = error as { refusals?: readonly { reason: string; groupId: string | null }[] }
      if (Array.isArray(invalid.refusals)) setRefusals(invalid.refusals)
      else toast.error(formatError(error))
    },
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
      onSaved(null)
    },
    onError: (error: unknown) => {
      const invalid = error as { refusals?: readonly { reason: string; groupId: string | null }[] }
      if (Array.isArray(invalid.refusals)) setRefusals(invalid.refusals)
      else toast.error(formatError(error))
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-xs text-muted-foreground">
          {parent === null
            ? format(m.itemsGroupTopLevel)
            : format(m.itemsGroupInside, { parent: parent.name })}
        </p>
        <h3 className="text-base font-medium">
          {editing === null ? format(m.itemsGroupNew) : format(m.itemsGroupEditing)}
        </h3>
      </header>

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

      <div className="flex justify-between gap-2">
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
          <Button variant="outline" onClick={onCancel}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
            {format(m.entrySave)}
          </Button>
        </div>
      </div>
    </div>
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
