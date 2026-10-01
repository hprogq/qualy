import { getApiErrorCode } from '@qualy/web-i18n'
import { useId, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { FieldError } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
import {
  Card,
  CardHead,
  CardHint,
  DefLine,
  DefList,
  DetailSheet,
  MetaLine,
  Spacer,
  Tag,
  Tick,
  TickGrid,
  UnsavedMark,
} from '@qualy/ui/screen'

import { type Api, type OrgShape, type OrgTypeDto, type Run } from '../shape.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One kind of unit, opened beside the table it was picked from.
//
// A rule is edited from the side of the kind that holds: "what may a college
// contain" is a question somebody has, and ticking it here is the only place
// the rule can be changed. What this kind may itself stand under is shown and
// not offered, or the same rule would have two ways in and the second would
// be the one forgotten.

const styles = stylex.create({
  rename: { display: 'flex', flexDirection: 'column', gap: 6 },
  form: { display: 'flex', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, paddingInline: 16, paddingBlock: 12 },
  quiet: { fontSize: 12.5, color: tokens.mutedForeground },
  deleteRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
  },
  deleteTitle: { flexShrink: 0, fontSize: 13, fontWeight: 600 },
  deleteWhy: {
    minWidth: 0,
    flexGrow: 1,
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  numeric: { fontVariantNumeric: 'tabular-nums' },
})

export function TypeSheet({
  open,
  type,
  shape,
  api,
  run,
  canManage,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  type: OrgTypeDto
  shape: OrgShape
  api: Api
  run: Run
  canManage: boolean
  onClose: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(type.name)
  // a name another kind already has is the name's to fix, said under it
  const [taken, setTaken] = useState<string | null>(null)
  const takenId = useId()
  const nameTaken = (error: unknown) => getApiErrorCode(error) === 'ORG_TYPE_CONFLICT'
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const inUse = shape.nodesOfType.get(type.id) ?? 0
  // the kind the tenant's own root is of: it cannot go while the root stands,
  // and saying "one unit uses it" sends the reader looking for a unit to move
  const isRootType = shape.roots.some((root) => root.orgTypeId === type.id)

  // the rules as stored against the rules as edited: saving writes the diff,
  // one put or delete per changed pair
  const stored = useMemo(
    () =>
      new Set(
        shape.rules.filter((rule) => rule.parentTypeId === type.id).map((rule) => rule.childTypeId),
      ),
    [shape.rules, type.id],
  )
  const [draft, setDraft] = useState<ReadonlySet<string>>(stored)
  const dirty = draft.size !== stored.size || [...draft].some((id) => !stored.has(id))
  const allowedUnder = shape.rules
    .filter((rule) => rule.childTypeId === type.id)
    .map((rule) => shape.types.find((candidate) => candidate.id === rule.parentTypeId))
    .filter((held): held is OrgTypeDto => held !== undefined)
  const involved = shape.rules.filter(
    (rule) => rule.parentTypeId === type.id || rule.childTypeId === type.id,
  ).length

  const saveRules = () => {
    const adds = [...draft].filter((id) => !stored.has(id))
    const removals = [...stored].filter((id) => !draft.has(id))
    // sequential on purpose: each pair is its own resource, so a failure
    // stops at the pair that refused with the rest untouched and refetched
    let work: Promise<unknown> = Promise.resolve()
    for (const childTypeId of adds) {
      work = work.then(() =>
        run(api.org.putRule({ params: { parentTypeId: type.id, childTypeId } })),
      )
    }
    for (const childTypeId of removals) {
      work = work.then(() =>
        run(api.org.deleteRule({ params: { parentTypeId: type.id, childTypeId } })),
      )
    }
    setSaving(true)
    void work
      // what was refused is put back, so the ticks never claim a rule the
      // server did not take
      .catch(() => setDraft(stored))
      .finally(() => setSaving(false))
  }

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={type.name}
      titleAside={<Tag>{m.type_nodeCount({ count: inUse })}</Tag>}
      meta={<MetaLine items={[m.type_title(), m.type_involvedRules({ count: involved })]} />}
      actions={
        canManage ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setRenaming((now) => !now)
              setTaken(null)
            }}
          >
            {m.node_rename()}
          </Button>
        ) : undefined
      }
      closeLabel={commonMessages.action_close()}
      testId="type-sheet"
      footer={
        canManage ? (
          <>
            {dirty && <UnsavedMark>{m.state_unsaved()}</UnsavedMark>}
            <Spacer />
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => setDraft(stored)}
            >
              {m.action_discard()}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={saveRules}
              data-testid="type-save"
            >
              {m.action_save()}
            </Button>
          </>
        ) : undefined
      }
    >
      {renaming && (
        <div {...stylex.props(styles.rename)}>
          <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault()
              // a refusal is said by run, or under the name when it is the
              // name's; the field stays open to fix it either way
              setTaken(null)
              void run(
                api.org.updateType({ params: { typeId: type.id }, payload: { name } }),
                nameTaken,
              )
                .then(() => setRenaming(false))
                .catch((error: unknown) => {
                  if (nameTaken(error)) setTaken(m.error_typeConflict())
                })
            }}
          >
            <Input
              autoFocus
              value={name}
              aria-label={m.node_name()}
              aria-required
              {...(taken === null ? {} : { 'aria-invalid': true, 'aria-describedby': takenId })}
              onChange={(event) => {
                setName(event.target.value)
                setTaken(null)
              }}
              wrapperXstyle={styles.grow}
            />
            <Button size="sm" type="submit" disabled={name.trim() === '' || name === type.name}>
              {m.action_save()}
            </Button>
          </form>
          {taken !== null && (
            <FieldError id={takenId} data-testid="field-error">
              {taken}
            </FieldError>
          )}
        </div>
      )}

      <Card>
        <CardHead title={m.type_allowedChildren()} />
        <TickGrid columns={2} label={m.type_allowedChildren()}>
          {shape.types.map((candidate) => (
            <Tick
              key={candidate.id}
              label={candidate.name}
              checked={draft.has(candidate.id)}
              disabled={!canManage || saving}
              tally={m.type_nodeCount({ count: shape.nodesOfType.get(candidate.id) ?? 0 })}
              data-child-type={candidate.id}
              onChange={(next) => {
                const held = new Set(draft)
                if (next) held.add(candidate.id)
                else held.delete(candidate.id)
                setDraft(held)
              }}
            />
          ))}
        </TickGrid>
        <CardHint>{m.type_allowedChildrenHint()}</CardHint>
      </Card>

      <Card>
        <CardHead title={m.type_allowedUnder()} />
        <div {...stylex.props(styles.tags)}>
          {allowedUnder.length === 0 ? (
            <span {...stylex.props(styles.quiet)}>{m.type_allowedUnderNone()}</span>
          ) : (
            allowedUnder.map((held) => (
              <Tag key={held.id} outline>
                {held.name}
              </Tag>
            ))
          )}
        </div>
        <CardHint>{m.type_allowedUnderHint()}</CardHint>
      </Card>

      <Card>
        <DefList>
          <DefLine label={m.node_name()}>{type.name}</DefLine>
          <DefLine label={m.type_countColumn()}>
            <span {...stylex.props(styles.numeric)}>{m.node_countUnits({ count: inUse })}</span>
          </DefLine>
        </DefList>
      </Card>

      {canManage && (
        <Card>
          <div {...stylex.props(styles.deleteRow)}>
            <span {...stylex.props(styles.deleteTitle)}>{m.type_deleteTitle()}</span>
            <span {...stylex.props(styles.deleteWhy)}>
              {isRootType
                ? m.types_isRootHint()
                : inUse > 0
                  ? m.type_inUseHint({ count: inUse })
                  : m.type_freeHint()}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={inUse > 0 || isRootType}
              onClick={() => setConfirmingDelete(true)}
            >
              {m.action_delete()}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={m.type_confirmDelete({ name: type.name })}
        description={m.type_confirmDeleteBody()}
        confirmLabel={m.action_delete()}
        cancelLabel={commonMessages.action_cancel()}
        onConfirm={() =>
          void run(api.org.deleteType({ params: { typeId: type.id } }))
            .then(() => {
              setConfirmingDelete(false)
              onClose()
            })
            .catch(() => setConfirmingDelete(false))
        }
        onCancel={() => setConfirmingDelete(false)}
      />
    </DetailSheet>
  )
}
