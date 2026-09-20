import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
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
import { orgMessages as m } from '../i18n.ts'
import type { Api, OrgShape, OrgTypeDto, Run } from '../shape.ts'

// One kind of unit, opened beside the table it was picked from.
//
// A rule is edited from the side of the kind that holds: "what may a college
// contain" is a question somebody has, and ticking it here is the only place
// the rule can be changed. What this kind may itself stand under is shown and
// not offered, or the same rule would have two ways in and the second would
// be the one forgotten.

const styles = stylex.create({
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
  const { format } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(type.name)
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
      titleAside={<Tag>{format(m.typeNodeCount, { count: inUse })}</Tag>}
      meta={
        <MetaLine
          items={[format(m.typesTitle), format(m.typeInvolvedRules, { count: involved })]}
        />
      }
      actions={
        canManage ? (
          <Button size="xs" variant="ghost" onClick={() => setRenaming((now) => !now)}>
            {format(m.rename)}
          </Button>
        ) : undefined
      }
      closeLabel={format(commonMessages.close)}
      testId="type-sheet"
      footer={
        canManage ? (
          <>
            {dirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
            <Spacer />
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => setDraft(stored)}
            >
              {format(m.discard)}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={saveRules}
              data-testid="type-save"
            >
              {format(m.save)}
            </Button>
          </>
        ) : undefined
      }
    >
      {renaming && (
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            void run(api.org.updateType({ params: { typeId: type.id }, payload: { name } })).then(
              () => setRenaming(false),
            )
          }}
        >
          <Input
            autoFocus
            value={name}
            aria-label={format(m.nameLabel)}
            onChange={(event) => setName(event.target.value)}
            wrapperXstyle={styles.grow}
          />
          <Button size="sm" type="submit" disabled={name.trim() === '' || name === type.name}>
            {format(m.save)}
          </Button>
        </form>
      )}

      <Card>
        <CardHead title={format(m.allowedChildrenTitle)} />
        <TickGrid columns={2} label={format(m.allowedChildrenTitle)}>
          {shape.types.map((candidate) => (
            <Tick
              key={candidate.id}
              label={candidate.name}
              checked={draft.has(candidate.id)}
              disabled={!canManage || saving}
              tally={format(m.typeNodeCount, { count: shape.nodesOfType.get(candidate.id) ?? 0 })}
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
        <CardHint>{format(m.allowedChildrenHint)}</CardHint>
      </Card>

      <Card>
        <CardHead title={format(m.allowedUnder)} />
        <div {...stylex.props(styles.tags)}>
          {allowedUnder.length === 0 ? (
            <span {...stylex.props(styles.quiet)}>{format(m.allowedUnderNone)}</span>
          ) : (
            allowedUnder.map((held) => (
              <Tag key={held.id} outline>
                {held.name}
              </Tag>
            ))
          )}
        </div>
        <CardHint>{format(m.allowedUnderHint)}</CardHint>
      </Card>

      <Card>
        <DefList>
          <DefLine label={format(m.nameLabel)}>{type.name}</DefLine>
          <DefLine label={format(m.typeCountColumn)}>
            <span {...stylex.props(styles.numeric)}>{format(m.countUnits, { count: inUse })}</span>
          </DefLine>
        </DefList>
      </Card>

      {canManage && (
        <Card>
          <div {...stylex.props(styles.deleteRow)}>
            <span {...stylex.props(styles.deleteTitle)}>{format(m.typeDeleteTitle)}</span>
            <span {...stylex.props(styles.deleteWhy)}>
              {isRootType
                ? format(m.typeIsRootHint)
                : inUse > 0
                  ? format(m.typeInUseHint, { count: inUse })
                  : format(m.typeFreeHint)}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={inUse > 0 || isRootType}
              onClick={() => setConfirmingDelete(true)}
            >
              {format(m.delete)}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={format(m.confirmDeleteType, { name: type.name })}
        description={format(m.confirmDeleteTypeBody)}
        confirmLabel={format(m.delete)}
        cancelLabel={format(commonMessages.cancel)}
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
