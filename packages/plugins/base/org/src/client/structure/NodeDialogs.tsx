import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, FormDialog } from '@qualy/ui/admin'
import { RouteOffIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Blank } from '@qualy/ui/screen'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { orgMessages as m } from '../i18n.ts'
import type { Api, OrgShape, Run } from '../shape.ts'

// The three things done to a unit from its own row: a unit under it, another
// name, another place. Each is a short task with an end, so each is a dialog
// over the tree - which stays where it was, so the result shows up in the
// place the reader was already looking.
//
// Where a unit may go is chosen in the tree of units rather than from a flat
// list of names: two classes called "1班" are only told apart by what is
// above them. Places the move may not land on stay in that tree, each saying
// why, because a tree with holes in it cannot be read.

export type NodeTask = { readonly kind: 'create' | 'rename' | 'move'; readonly nodeId: string }

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  picker: { minHeight: '18rem' },
  note: { margin: 0, fontSize: 12, lineHeight: 1.6, color: tokens.mutedForeground },
})

export function NodeDialogs({
  task,
  shape,
  api,
  run,
  onDone,
  onOpenRules,
}: {
  task: NodeTask | null
  shape: OrgShape
  api: Api
  run: Run
  onDone: () => void
  /** to the rules of one kind of unit, where what may hold what is set */
  onOpenRules: (orgTypeId: string) => void
}) {
  const { format } = useI18n()
  const node = task === null ? undefined : shape.byId.get(task.nodeId)
  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  const childTypes = useMemo(
    () =>
      node === undefined
        ? []
        : shape.types.filter((type) =>
            shape.rules.some(
              (rule) => rule.parentTypeId === node.orgTypeId && rule.childTypeId === type.id,
            ),
          ),
    [node, shape],
  )

  // each task starts from what is true now, not from what the last one left
  useEffect(() => {
    if (task === null || node === undefined) return
    setName(task.kind === 'rename' ? node.name : '')
    setTypeId(task.kind === 'create' && childTypes.length === 1 ? childTypes[0]!.id : '')
    setTargetId('')
    // keyed on the task alone: the shape moves under an open dialog whenever
    // anything is saved, and that must not wipe what is being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.kind, task?.nodeId])

  // why each unit cannot be where this one goes, for the ones that cannot
  const barred = useMemo(() => {
    if (task?.kind !== 'move' || node === undefined) return {}
    const below = new Set<string>()
    const collect = (id: string) => {
      below.add(id)
      for (const child of shape.childrenOf.get(id) ?? []) collect(child.id)
    }
    collect(node.id)
    const parents = new Set(
      shape.rules.filter((rule) => rule.childTypeId === node.orgTypeId).map((r) => r.parentTypeId),
    )
    const why: Record<string, string> = {}
    for (const candidate of shape.nodes) {
      if (candidate.id === node.id) why[candidate.id] = format(m.moveBarredSelf)
      else if (below.has(candidate.id)) why[candidate.id] = format(m.moveBarredBelow)
      else if (candidate.id === node.parentId) why[candidate.id] = format(m.moveBarredCurrent)
      else if (!parents.has(candidate.orgTypeId)) why[candidate.id] = format(m.moveBarredType)
      else if (!candidate.manageable) why[candidate.id] = format(m.moveBarredReach)
    }
    return why
  }, [task?.kind, node, shape, format])

  if (task === null || node === undefined) return null
  const kindName = shape.types.find((type) => type.id === node.orgTypeId)?.name ?? ''
  const nowhere = task.kind === 'move' && shape.nodes.every((one) => barred[one.id] !== undefined)

  const submit = () => {
    const work =
      task.kind === 'create'
        ? api.org.createNode({ payload: { parentId: node.id, orgTypeId: typeId, name: name.trim() } })
        : task.kind === 'rename'
          ? api.org.updateNode({ params: { nodeId: node.id }, payload: { name: name.trim() } })
          : api.org.setNodePlacement({ params: { nodeId: node.id }, payload: { parentId: targetId } })
    setBusy(true)
    void run(work)
      .then(onDone)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  const ready =
    task.kind === 'create'
      ? name.trim() !== '' && typeId !== ''
      : task.kind === 'rename'
        ? name.trim() !== '' && name.trim() !== node.name
        : targetId !== ''
  const title =
    task.kind === 'create'
      ? format(m.createUnder, { name: node.name })
      : task.kind === 'rename'
        ? format(m.renameNamed, { name: node.name })
        : format(m.moveNamed, { name: node.name })

  return (
    <FormDialog
      open
      size={task.kind === 'move' ? 'medium' : 'default'}
      title={title}
      onClose={onDone}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            {format(commonMessages.cancel)}
          </Button>
          {!nowhere && (
          <Button type="submit" form="org-node-task" disabled={!ready || busy}>
            {format(task.kind === 'create' ? m.create : task.kind === 'rename' ? m.save : m.move)}
          </Button>
          )}
        </>
      }
    >
      <form
        id="org-node-task"
        data-testid="node-task"
        data-task={task.kind}
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !busy) submit()
        }}
      >
        {task.kind === 'create' &&
          (childTypes.length === 0 ? (
            <p {...stylex.props(styles.note)}>{format(m.noChildrenAllowed)}</p>
          ) : (
            <Field label={format(m.typeColumn)}>
              {(id) => (
                <Select value={typeId === '' ? undefined : typeId} onValueChange={setTypeId}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder={format(m.selectType)} />
                  </SelectTrigger>
                  <SelectContent>
                    {childTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ))}
        {task.kind !== 'move' && (
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        )}
        {task.kind === 'move' && nowhere && (
          // every place is barred: said as the answer it is, with the way to
          // the rules that make it so, rather than as a tree of rows none of
          // which will take the press
          <div data-testid="move-nowhere">
            <Blank
              icon={<RouteOffIcon />}
              title={format(m.moveNowhereTitle)}
              description={format(m.moveNowhere, { type: kindName })}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onDone()
                    onOpenRules(node.orgTypeId)
                  }}
                >
                  {format(m.moveNowhereRules)}
                </Button>
              }
            />
          </div>
        )}
        {task.kind === 'move' && !nowhere && (
          <>
            <div {...stylex.props(styles.picker)}>
              <UiSlot
                token={orgNodePicker}
                context={
                  {
                    value: targetId === '' ? [] : [targetId],
                    onChange: (ids) => setTargetId(ids[0] ?? ''),
                    single: true,
                    nodes: shape.nodes.map((one) => ({
                      id: one.id,
                      name: one.name,
                      parentId: one.parentId,
                      orgTypeId: one.orgTypeId,
                    })),
                    disabled: barred,
                  } satisfies OrgNodePickerContext
                }
                // no picker installed: the legal places, by name
                fallback={
                  <Select value={targetId === '' ? undefined : targetId} onValueChange={setTargetId}>
                    <SelectTrigger aria-label={format(m.moveTo)}>
                      <SelectValue placeholder={format(m.selectParent)} />
                    </SelectTrigger>
                    <SelectContent>
                      {shape.nodes
                        .filter((one) => barred[one.id] === undefined)
                        .map((one) => (
                          <SelectItem key={one.id} value={one.id}>
                            {one.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                }
              />
            </div>
            <p {...stylex.props(styles.note)}>{format(m.moveConsequence)}</p>
          </>
        )}
      </form>
    </FormDialog>
  )
}
