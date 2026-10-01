import { getApiErrorCode } from '@qualy/web-i18n'
import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, FormDialog } from '@qualy/ui/admin'
import { NetworkIcon, RouteOffIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Blank } from '@qualy/ui/screen'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'

import { type Api, type OrgShape, type Run } from '../shape.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The three things done to a unit from its own row: a unit under it, another
// name, another place. Each is a short task with an end, so each is a dialog
// over the tree - which stays where it was, so the result shows up in the
// place the reader was already looking.
//
// Where a unit may go is chosen in the tree of units rather than from a flat
// list of names: two classes called "1班" are only told apart by what is
// above them. Places the move may not land on stay in that tree, each saying
// why, because a tree with holes in it cannot be read.
//
// A task with nothing it could do - a unit under a kind that holds none, a
// move with nowhere to land - says so as an answer with the way to the rules
// that make it so, and keeps only the button that closes it.

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
  const node = task === null ? undefined : shape.byId.get(task.nodeId)
  const [name, setName] = useState('')
  // a name a sibling already has is the name's to fix, said under it; a move
  // refused for the same reason has no name field, so run says that one
  const [taken, setTaken] = useState<string | null>(null)
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
    setTaken(null)
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
      if (candidate.id === node.id) why[candidate.id] = m.node_moveBarredSelf()
      else if (below.has(candidate.id)) why[candidate.id] = m.node_moveBarredBelow()
      else if (candidate.id === node.parentId) why[candidate.id] = m.node_moveBarredCurrent()
      else if (!parents.has(candidate.orgTypeId)) why[candidate.id] = m.node_moveBarredType()
      else if (!candidate.manageable) why[candidate.id] = m.node_moveBarredReach()
    }
    return why
  }, [task?.kind, node, shape])

  if (task === null || node === undefined) return null
  const kindName = shape.types.find((type) => type.id === node.orgTypeId)?.name ?? ''
  const nowhere =
    (task.kind === 'move' && shape.nodes.every((one) => barred[one.id] !== undefined)) ||
    (task.kind === 'create' && childTypes.length === 0)
  const toRules = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        onDone()
        onOpenRules(node.orgTypeId)
      }}
    >
      {m.node_moveNowhereRules()}
    </Button>
  )

  const submit = () => {
    const work =
      task.kind === 'create'
        ? api.org.createNode({
            payload: { parentId: node.id, orgTypeId: typeId, name: name.trim() },
          })
        : task.kind === 'rename'
          ? api.org.updateNode({ params: { nodeId: node.id }, payload: { name: name.trim() } })
          : api.org.setNodePlacement({
              params: { nodeId: node.id },
              payload: { parentId: targetId },
            })
    const nameTaken = (error: unknown) =>
      task.kind !== 'move' && getApiErrorCode(error) === 'ORG_NODE_CONFLICT'
    setBusy(true)
    setTaken(null)
    void run(work, nameTaken)
      .then(onDone)
      .catch((error: unknown) => {
        if (nameTaken(error)) setTaken(m.error_nodeConflict())
      })
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
      ? m.node_createUnder({ name: node.name })
      : task.kind === 'rename'
        ? m.node_renameNamed({ name: node.name })
        : m.node_moveNamed({ name: node.name })

  return (
    <FormDialog
      open
      size={task.kind === 'move' ? 'medium' : 'default'}
      title={title}
      onClose={onDone}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            {(nowhere ? commonMessages.action_close : commonMessages.action_cancel)()}
          </Button>
          {!nowhere && (
            <Button type="submit" form="org-node-task" disabled={!ready || busy}>
              {(task.kind === 'create'
                ? m.action_create
                : task.kind === 'rename'
                  ? m.action_save
                  : m.action_move)()}
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
            <div data-testid="create-nowhere">
              <Blank
                size="compact"
                icon={<NetworkIcon />}
                title={m.node_createNowhereTitle()}
                description={m.node_createNowhere({ type: kindName })}
                action={toRules}
              />
            </div>
          ) : (
            <Field label={m.node_typeColumn()} required>
              {(id, control) => (
                <Select value={typeId === '' ? undefined : typeId} onValueChange={setTypeId}>
                  <SelectTrigger id={id} {...control}>
                    <SelectValue placeholder={m.type_select()} />
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
        {task.kind !== 'move' && !nowhere && (
          <Field label={m.node_name()} required error={taken}>
            {(id, control) => (
              <Input
                id={id}
                {...control}
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setTaken(null)
                }}
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
              size="compact"
              icon={<RouteOffIcon />}
              title={m.node_moveNowhereTitle()}
              description={m.node_moveNowhere({ type: kindName })}
              action={toRules}
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
                  <Select
                    value={targetId === '' ? undefined : targetId}
                    onValueChange={setTargetId}
                  >
                    <SelectTrigger aria-label={m.node_moveTo()}>
                      <SelectValue placeholder={m.node_selectParent()} />
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
            <p {...stylex.props(styles.note)}>{m.node_moveConsequence()}</p>
          </>
        )}
      </form>
    </FormDialog>
  )
}
