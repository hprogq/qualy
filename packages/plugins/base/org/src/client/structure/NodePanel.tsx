import { Fragment, useState } from 'react'
import { ChevronRightIcon, PlusIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { PageLink, usePageHref } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog } from '@qualy/ui/admin'
import { DeleteChecklist } from './DeleteChecklist.tsx'
import type { NodeTask } from './NodeDialogs.tsx'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import {
  Card,
  CardEmpty,
  CardHead,
  Cell,
  FactStrip,
  Table,
  TableHead,
  TableRow,
  Tag,
} from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import type { Api, OrgShape, OrgTreeNodeDto, OrgTypeDto, Run } from '../shape.ts'

// The unit on show: where it sits and what it is called, with what is done
// to it most beside its name; five facts on one strip; the units under it as
// a table; and, last and quietest, the way to remove it.
//
// Mutation controls only render on what the server marked manageable; the
// server enforces anyway.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  panel: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 14 },
  intro: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 6 },
  crumbs: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 6, fontSize: 12 },
  crumbGlyph: { width: 11, height: 11, flexShrink: 0, color: QUIET },
  crumb: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: QUIET,
  },
  crumbLink: {
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    backgroundColor: 'transparent',
    color: { default: QUIET, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  crumbHere: { color: tokens.foreground },
  headRow: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  headName: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 18,
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  spacer: { flexGrow: 1 },
  inlineForm: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 },
  nameInput: { maxWidth: '18rem' },
  moveField: { maxWidth: '24rem', flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  kindField: { width: '9rem', flexShrink: 0 },
  note: { margin: 0, fontSize: 13, color: tokens.mutedForeground },
  factAction: {
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: 12,
    backgroundColor: 'transparent',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: { default: 'none', ':hover': 'underline' },
    cursor: 'pointer',
  },
  createRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 16,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    flexWrap: 'wrap',
  },
  // the empty seat a new unit would fill, said with a dashed edge
  draftInput: { flexGrow: 1, flexShrink: 1, flexBasis: '12rem', borderStyle: 'dashed' },
  pinned: { flexShrink: 0 },
})

export function NodePanel({
  node,
  shape,
  api,
  run,
  onOpen,
  headcount,
  headcountOf,
  headcountKnown,
  onDeleted,
  onTask,
  inSheet = false,
}: {
  node: OrgTreeNodeDto
  shape: OrgShape
  api: Api
  run: Run
  onOpen: (id: string) => void
  /** people standing at this node, from whoever owns people */
  headcount: number
  /** and at each unit under it, which the table of them says per row */
  headcountOf: (orgNodeId: string) => number
  /** whether that count was answered at all; reading people is its own grant */
  headcountKnown: boolean
  /** the unit is gone; whoever frames this panel has nothing left to show */
  onDeleted?: () => void
  /** a task on this unit, done in a dialog over the tree */
  onTask: (task: NodeTask) => void
  /** the frame already says the unit's name and kind */
  inSheet?: boolean
}) {
  const { format } = useI18n()
  const listJoin = useList()
  // the roster belongs to the users screen, which not every reader of the
  // tree may open: the way through is offered only where it leads somewhere
  const rosterReachable = usePageHref('auth/users') !== undefined
  const [retyping, setRetyping] = useState(false)
  const [nextTypeId, setNextTypeId] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isRoot = !node.parentId
  const children = shape.childrenOf.get(node.id) ?? []
  const typeName = (id: string) =>
    shape.types.find((type) => type.id === id)?.name ?? format(m.unknownType)

  // the kinds of unit this one may hold, by the rules as they stand: the
  // create control offers only what the api would accept
  const allowedChildTypes = shape.rules
    .filter((rule) => rule.parentTypeId === node.orgTypeId)
    .map((rule) => shape.types.find((type) => type.id === rule.childTypeId))
    .filter((type): type is OrgTypeDto => type !== undefined)

  // spelled from the top: a class name alone says which class but never whose
  const path: OrgTreeNodeDto[] = []
  for (let at: OrgTreeNodeDto | undefined = node; at;) {
    path.unshift(at)
    at = at.parentId ? shape.byId.get(at.parentId) : undefined
  }
  const siblings = node.parentId ? (shape.childrenOf.get(node.parentId) ?? []) : shape.roots
  const rank = siblings.findIndex((sibling) => sibling.id === node.id) + 1

  const descendants = new Set<string>()
  const collect = (id: string) => {
    descendants.add(id)
    for (const child of shape.childrenOf.get(id) ?? []) collect(child.id)
  }
  collect(node.id)
  const parentTypesAllowed = new Set(
    shape.rules.filter((rule) => rule.childTypeId === node.orgTypeId).map((r) => r.parentTypeId),
  )
  // what this unit could be instead: whatever its parent is allowed to hold.
  // A root answers to nobody, so its kind is not up for changing here.
  const parentType = node.parentId ? shape.byId.get(node.parentId)?.orgTypeId : undefined
  const retypeOptions = shape.types.filter(
    (type) =>
      type.id !== node.orgTypeId &&
      shape.rules.some((rule) => rule.parentTypeId === parentType && rule.childTypeId === type.id),
  )
  const moveTargets = shape.nodes.filter(
    (candidate) =>
      candidate.manageable &&
      !descendants.has(candidate.id) &&
      candidate.id !== node.parentId &&
      parentTypesAllowed.has(candidate.orgTypeId),
  )

  return (
    <div {...stylex.props(styles.panel)} data-testid="node-panel">
      <div {...stylex.props(styles.intro)}>
        <nav aria-label={format(m.pathLabel)} {...stylex.props(styles.crumbs)}>
          {path.map((step, index) => (
            <Fragment key={step.id}>
              {index > 0 && <ChevronRightIcon aria-hidden {...stylex.props(styles.crumbGlyph)} />}
              {index === path.length - 1 ? (
                <span {...stylex.props(styles.crumb, styles.crumbHere)} aria-current="page">
                  {step.name}
                </span>
              ) : (
                <button
                  type="button"
                  {...stylex.props(styles.crumb, styles.crumbLink)}
                  onClick={() => onOpen(step.id)}
                >
                  {step.name}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
        {!inSheet && (
          <div {...stylex.props(styles.headRow)}>
            {!inSheet && (
              <>
                <h2 {...stylex.props(styles.headName)}>{node.name}</h2>
                <Tag>{typeName(node.orgTypeId)}</Tag>
              </>
            )}
            <span {...stylex.props(styles.spacer)} />
            {node.manageable && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onTask({ kind: 'rename', nodeId: node.id })}
                >
                  {format(m.rename)}
                </Button>
                {!isRoot && node.subtreeManageable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTask({ kind: 'move', nodeId: node.id })}
                  >
                    {format(m.moveTo)}
                  </Button>
                )}
                {allowedChildTypes.length > 0 && (
                  <Button size="sm" onClick={() => onTask({ kind: 'create', nodeId: node.id })}>
                    <PlusIcon aria-hidden />
                    {format(m.createChild)}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {retyping && (
          <form
            {...stylex.props(styles.inlineForm)}
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                api.org.changeNodeType({
                  params: { nodeId: node.id },
                  payload: { orgTypeId: nextTypeId },
                }),
              ).then(() => setRetyping(false))
            }}
          >
            <Select value={nextTypeId} onValueChange={setNextTypeId}>
              <SelectTrigger aria-label={format(m.changeType)} xstyle={styles.kindField}>
                <SelectValue placeholder={format(m.selectType)} />
              </SelectTrigger>
              <SelectContent>
                {retypeOptions.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" type="submit" disabled={nextTypeId === ''}>
              {format(m.save)}
            </Button>
          </form>
        )}
        {!node.manageable && (
          // the note is copy; that this reader may only look is not
          <p data-testid="node-note" data-manageable="false" {...stylex.props(styles.note)}>
            {format(m.readOnly)}
          </p>
        )}
      </div>

      <FactStrip
        testId="node-facts"
        items={[
          {
            label: format(m.nodeType),
            value: typeName(node.orgTypeId),
            action:
              node.manageable && !isRoot && retypeOptions.length > 0 ? (
                <button
                  type="button"
                  {...stylex.props(styles.factAction)}
                  onClick={() => setRetyping((now) => !now)}
                >
                  {format(m.changeType)}
                </button>
              ) : undefined,
          },
          {
            label: format(m.parentLabel),
            value: node.parentId ? (shape.byId.get(node.parentId)?.name ?? '—') : '—',
          },
          {
            label: format(m.rankLabel),
            value: rank > 0 ? format(m.siblingRank, { rank, total: siblings.length }) : '—',
          },
          {
            label: format(m.peopleHere),
            value: headcountKnown ? format(m.peopleCount, { count: headcount }) : '—',
            action: rosterReachable ? (
              <PageLink
                page="auth/users"
                search={{ anchor: node.id, scope: 'self' }}
                className={stylex.props(styles.factAction).className}
              >
                {format(m.peopleOpen)}
              </PageLink>
            ) : undefined,
          },
          {
            label: format(m.childrenTitle),
            value: format(m.countUnits, { count: children.length }),
          },
        ]}
      />

      {/* Each row carries its own count of children, which is what says
          whether that one could be removed without opening it first. */}
      <Card data-testid="node-children">
        <CardHead
          title={format(m.childrenTitle)}
          note={
            allowedChildTypes.length === 0
              ? format(m.noChildrenAllowed)
              : format(m.allowedHere, { types: listJoin(allowedChildTypes.map((t) => t.name)) })
          }
        />
        {children.length === 0 ? (
          <CardEmpty>{format(m.childrenEmpty)}</CardEmpty>
        ) : (
          <Table columns="minmax(0, 1fr) 6rem 5rem 4.5rem" openable>
            <TableHead>
              <span>{format(m.nameLabel)}</span>
              <span>{format(m.typeColumn)}</span>
              <span>{format(m.peopleTitle)}</span>
              <span>{format(m.childrenColumn)}</span>
            </TableHead>
            {children.map((child) => {
              const under = (shape.childrenOf.get(child.id) ?? []).length
              return (
                <TableRow
                  key={child.id}
                  height="tight"
                  onOpen={() => onOpen(child.id)}
                  data-testid="child-row"
                  data-node-name={child.name}
                >
                  <Cell lead>{child.name}</Cell>
                  <Cell>{typeName(child.orgTypeId)}</Cell>
                  <Cell numeric>
                    {headcountKnown ? format(m.peopleCount, { count: headcountOf(child.id) }) : '—'}
                  </Cell>
                  <Cell numeric tone={under === 0 ? 'quiet' : 'muted'}>
                    {under}
                  </Cell>
                </TableRow>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Removing a unit is the rarest thing done here and the only one that
          cannot be undone, so it goes last - with everything that holds the
          unit in place listed before the button is offered. */}
      {node.manageable && !isRoot && (
        <DeleteChecklist
          nodeId={node.id}
          childCount={children.length}
          onDelete={() => setConfirmingDelete(true)}
        />
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={format(m.confirmDeleteNode, { name: node.name })}
        description={format(m.confirmDeleteNodeBody)}
        confirmLabel={format(m.deleteNode)}
        cancelLabel={format(commonMessages.cancel)}
        onConfirm={() =>
          void run(api.org.deleteNode({ params: { nodeId: node.id } }))
            .then(() => {
              setConfirmingDelete(false)
              onDeleted?.()
            })
            .catch(() => setConfirmingDelete(false))
        }
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}
