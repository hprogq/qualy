import * as stylex from '@stylexjs/stylex'
import { useI18n, useList } from '@qualy/web-i18n'
import { useLingering } from '@qualy/ui/use-lingering'
import { Card, CardEmpty, Cell, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import type { Api, OrgShape, Run } from '../shape.ts'
import { RulesGraph } from './RulesGraph.tsx'
import { TypeSheet } from './TypeSheet.tsx'

// The grammar the structure obeys: the rules as a picture, the kinds as a
// table saying the same thing in words, and one kind opened beside them.
//
// The table's two middle columns are each box's lines in the picture - what
// leaves it and what arrives - so the two can be read against each other.

const styles = stylex.create({
  stack: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 14 },
})

export function TypesView({
  shape,
  openId,
  onOpen,
  api,
  run,
  canManage,
}: {
  shape: OrgShape
  /** the kind open beside the table, '' for none */
  openId: string
  onOpen: (typeId: string) => void
  api: Api
  run: Run
  canManage: boolean
}) {
  const { format } = useI18n()
  const listJoin = useList()
  const open = shape.types.find((type) => type.id === openId)
  const shown = useLingering(open ?? null)
  const namesOf = (ids: readonly string[]) =>
    ids
      .map((id) => shape.types.find((type) => type.id === id)?.name)
      .filter((name): name is string => name !== undefined)

  return (
    <div {...stylex.props(styles.stack)}>
      <RulesGraph shape={shape} openId={open?.id ?? null} onOpen={onOpen} />
      <Card data-testid="types-table">
        {shape.types.length === 0 ? (
          <CardEmpty>{format(m.typeListEmpty)}</CardEmpty>
        ) : (
          <Table columns="minmax(0, 0.9fr) 5.5rem minmax(0, 1.2fr) minmax(0, 1.2fr)" openable>
            <TableHead>
              <span>{format(m.typesTitle)}</span>
              <span>{format(m.typeCountColumn)}</span>
              <span>{format(m.allowedChildrenTitle)}</span>
              <span>{format(m.allowedUnder)}</span>
            </TableHead>
            {shape.types.map((type) => {
              const holds = namesOf(
                shape.rules
                  .filter((rule) => rule.parentTypeId === type.id)
                  .map((rule) => rule.childTypeId),
              )
              const under = namesOf(
                shape.rules
                  .filter((rule) => rule.childTypeId === type.id)
                  .map((rule) => rule.parentTypeId),
              )
              const selected = type.id === open?.id
              return (
                <TableRow
                  key={type.id}
                  selected={selected}
                  onOpen={() => onOpen(type.id)}
                  data-testid="type-row"
                  data-type-name={type.name}
                  data-holds={holds.length}
                  data-under={under.length}
                >
                  <Cell lead strong={selected}>
                    {type.name}
                  </Cell>
                  <Cell numeric>
                    {format(m.countUnits, { count: shape.nodesOfType.get(type.id) ?? 0 })}
                  </Cell>
                  <Cell tone={holds.length === 0 ? 'quiet' : 'plain'} title={listJoin(holds)}>
                    {holds.length === 0 ? format(m.none) : listJoin(holds)}
                  </Cell>
                  <Cell tone={under.length === 0 ? 'quiet' : 'plain'} title={listJoin(under)}>
                    {under.length === 0 ? format(m.noneTopKind) : listJoin(under)}
                  </Cell>
                </TableRow>
              )
            })}
          </Table>
        )}
      </Card>
      {shown !== null && (
        <TypeSheet
          key={shown.id}
          open={open !== undefined}
          type={shown}
          shape={shape}
          api={api}
          run={run}
          canManage={canManage}
          onClose={() => onOpen('')}
        />
      )}
    </div>
  )
}
