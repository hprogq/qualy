import { useState } from 'react'
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
import type { TreeGroup } from './PaperTree.tsx'

// One section of the paper: its name and its limits.
//
// Saving sends the whole tree because that is what the api takes - and every
// row keeps the id it came with, which is what tells the server this is the
// same group rather than a new one replacing it.

export function GroupEditor({
  batchId,
  batchStatus,
  groups,
  version,
  editing,
  parentId,
  onCancel,
  onDone,
}: {
  batchId: string
  batchStatus: string
  groups: readonly TreeGroup[]
  /** the tree these groups were read at; a save states it and can be refused */
  version: number
  /** null while a group is being composed and has never been saved */
  editing: TreeGroup | null
  /** where a new group goes; ignored when editing */
  parentId: string | null
  onCancel: () => void
  onDone: (groupId: string | null) => void
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

  const specOf = (group: TreeGroup) => ({
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
      // one being composed joins the tree the same way every other row is
      // written: as part of the whole set the api replaces
      const created = editing === null ? [{ parentGroupId: parentId, ...values }] : []
      return run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: [...edited, ...created],
            expectedVersion: version,
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      )
    },
    onMutate: () => setRefusals([]),
    onSuccess: (result: { groups: readonly { id: string; name: string }[] }) => {
      toast.success(format(m.itemsGroupsSaved))
      const known = new Set(groups.map((group) => group.id))
      const landed = editing?.id ?? result.groups.find((group) => !known.has(group.id))?.id ?? null
      onDone(landed)
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
            expectedVersion: version,
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      ),
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      onDone(null)
    },
    onError,
  })

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {format(editing === null ? m.itemsGroupNew : m.itemsGroupEditing)}
            {parent !== null && ` · ${format(m.itemsGroupInside, { parent: parent.name })}`}
          </p>
          <h3 className="truncate text-lg font-semibold">
            {name.trim() === '' ? format(m.itemsGroupUnnamed) : name}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
          <Button variant="outline" onClick={onCancel}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
            {format(m.entrySave)}
          </Button>
        </div>
      </header>

      <div className="flex max-w-md flex-col gap-4">
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
    </div>
  )
}

const GROUP_REFUSALS: Record<string, MessageDescriptor> = {
  'group-not-found': m.itemsGroupRefusedNotFound,
  'group-has-items': m.itemsGroupRefusedHasItems,
  'group-has-children': m.itemsGroupRefusedHasChildren,
  'floor-above-cap': m.itemsGroupRefusedFloorAboveCap,
  'reason-required': m.itemsGroupRefusedReason,
  'parent-not-in-batch': m.itemsGroupRefusedParent,
  'parent-is-self': m.itemsGroupRefusedParent,
  'parent-cycle': m.itemsGroupRefusedParent,
}
