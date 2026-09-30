import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { ChevronsUpDownIcon } from 'lucide-react'
import type { PeoplePickerViewContext } from '@qualy/ui-contract'
import { useLoadFailure } from '@qualy/web-runtime'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { AsyncSection, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { CursorPager, Pager } from '@qualy/ui/pager'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { useIsBelow } from '@qualy/ui/use-mobile'

import { OrgTree } from './OrgTree.tsx'
import { UnitPath, type PathStep } from './users/UnitPath.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Choosing people: the drawing, without the people.
//
// The organization is on the left because that is how somebody who does not
// know a name finds one; the people standing there are on the right, one page
// at a time, because a university is not a list anybody scrolls. What is
// chosen is people - ticking a unit would be choosing a shape, and the shape
// changes underneath afterwards.
//
// The people are a table with a head, the way the roster of users is: a
// name, a number, where they stand and what kind of person they are, each in
// its own column, so a page of them is read down a column rather than name
// by name. The head holds still while the rows scroll, and the box in it
// takes the whole page in or out. On a phone a table would be six columns in
// a third of the width, so each person is a line with their facts under it.
//
// Nothing here knows where a row came from. Whoever mounts it has already
// asked their own server for a page they are allowed to show, so this file
// has no API call, no notion of a wider organization, and no say in who may
// be seen. That is what lets the same drawing serve the directory and a
// single round's roster without either one inheriting the other's authority.
//
// The one piece of state it does keep is the half-typed search: settling it
// is a property of the input, not of any caller, and two callers debouncing
// the same keystrokes separately would be two answers to one question.

const ANY = 'any'

const styles = stylex.create({
  // The units on one side, the people on the other once there is room.
  //
  // A height of its own, so the tree and the list each scroll inside it and
  // the foot under the list stays where it is - but only as a starting
  // point: inside a box that hands out more, it grows into all of it, and
  // inside one that hands out less it gives way down to a floor.
  frame: {
    display: { default: 'grid', [breakpoints.phone]: 'flex' },
    flexDirection: 'column',
    minHeight: '18rem',
    height: 'min(62vh, 30rem)',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    gap: 16,
    gridTemplateRows: 'minmax(0, 1fr)',
  },
  // the tree is the narrower half: it is a way to narrow the list, and the
  // list is what is being chosen from
  frameSplit: {
    gridTemplateColumns: 'minmax(0, 16rem) minmax(0, 1fr)',
  },
  frameFolded: { gridTemplateColumns: 'minmax(0, 1fr)' },
  // the unit as a field that opens the tree, where a tree of its own would
  // take a third of the panel from the table
  unitField: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: '12rem', [breakpoints.phone]: '8rem' },
    minWidth: 0,
    justifyContent: 'space-between',
    fontWeight: 400,
  },
  unitWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chevron: { flexShrink: 0, opacity: 0.5 },
  treeSeat: { display: 'flex', minHeight: 0, height: '22rem', flexDirection: 'column' },
  side: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 8 },
  people: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'column',
    gap: 10,
  },
  heading: { margin: 0, fontSize: 13, lineHeight: '1.25rem', fontWeight: 600 },
  tree: {
    minHeight: '10rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 4,
  },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  controls: { display: 'flex', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  search: { height: 32, minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '10rem' },
  typeField: { width: 'auto' },
  // The list's own box: a hairline card whose inside is the one part that
  // scrolls. Its height is what the frame leaves after the controls and the
  // foot, which is why a long page never pushes the foot out of reach.
  listBox: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  listFill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
  },
  // The rows on screen are the answer being replaced: they stay, so the
  // table does not blank under the pointer, but read as stale. The fade
  // waits a beat, so an answer that comes at once never flickers.
  listStale: { opacity: 0.5, transitionDelay: '120ms' },
  // ---- the table ---------------------------------------------------------
  // The columns are shared out before anybody's words are read. Sized by
  // their contents, one long name or one long kind on a page took the width
  // from every row's unit - which is the column that says where somebody
  // stands, and whose last step is the one thing it must not lose. So the
  // box, the number and the kind have widths of their own, the name a share,
  // and the unit whatever is left; a word longer than its column ends in an
  // ellipsis and is said whole on hover.
  fixed: { tableLayout: 'fixed', minWidth: '34rem' },
  colTick: { width: 40 },
  colName: { width: '28%' },
  colNumber: { width: '8rem' },
  colKind: { width: '7rem' },
  // the head is a strip of small grey words on the page's inset ground, as
  // the roster of users heads its columns
  headCell: {
    height: 32,
    paddingInlineStart: 10,
    paddingInlineEnd: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    backgroundColor: tokens.surfaceInset,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  tickCell: { paddingInlineStart: 12 },
  row: { cursor: 'pointer' },
  rowStill: { cursor: 'default' },
  cell: {
    paddingBlock: 9,
    paddingInlineStart: 10,
    paddingInlineEnd: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  nameCell: { fontSize: 13.5, color: tokens.foreground },
  numeric: { fontVariantNumeric: 'tabular-nums' },
  quietWord: { color: tokens.mutedForeground },
  // the name gives way before the mark beside it: a mark cut short says
  // nothing, and the name is whole on hover
  nameLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  nameWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  blockedName: { color: tokens.mutedForeground },
  badge: { flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 400 },
  // ---- the phone's lines -------------------------------------------------
  lines: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    listStyle: 'none',
  },
  // the whole page in or out, standing over the lines as a head would: one
  // line, where the count keeps its words and the label gives way
  pageBarWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pageBarTotal: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  pageBar: {
    display: 'flex',
    cursor: 'pointer',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
    paddingInline: 12,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 -1px 0 ${tokens.divider}`,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  line: {
    display: 'grid',
    flexShrink: 0,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: 12,
    alignItems: 'center',
    minHeight: 52,
    paddingInline: 12,
    paddingBlock: 8,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    cursor: 'pointer',
  },
  lineChosen: { backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)` },
  lineWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  lineName: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    color: tokens.foreground,
  },
  lineNameWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // the kind gives way first, then the name; the mark never does
  lineKind: {
    flexShrink: 3,
    minWidth: '3.5em',
    maxWidth: '45%',
    marginInlineStart: 'auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 12.5,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  lineFacts: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  factHeld: { flexShrink: 0, whiteSpace: 'nowrap' },
  factGives: { display: 'flex', minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  // one fact from the next: a hairline, drawn by whoever knows there are two
  factRule: {
    alignSelf: 'center',
    flexShrink: 0,
    width: 1,
    height: 11,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 34%, transparent)`,
  },
  // ---- waiting and nobody ------------------------------------------------
  waiting: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
  },
  waitingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 42,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  waitingBox: { height: 16, width: 16, borderRadius: 4, flexShrink: 0 },
  waitingBone: { height: 12, borderRadius: 4 },
  nobody: {
    display: 'flex',
    minHeight: '8rem',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 0,
    padding: 16,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // ---- the foot ----------------------------------------------------------
  // how many are chosen and the way through the pages stay where they were
  // put; the list above is what scrolls
  foot: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
    minHeight: 32,
  },
  chosen: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    fontSize: 13,
    color: tokens.foreground,
    fontVariantNumeric: 'tabular-nums',
  },
  chosenNone: { color: tokens.mutedForeground },
  clear: { height: 24, paddingInline: 6, fontSize: 12.5 },
  pages: { display: 'flex', minWidth: 0, flexGrow: 1, flexBasis: '14rem' },
})

type Row = PeoplePickerViewContext['rows'][number]

export default function PeoplePickerView({ context }: { context: PeoplePickerViewContext }) {
  const describe = useLoadFailure()
  const businessNo = useTerm(authTerms.businessNumber)
  const [typed, setTyped] = useState(context.search)
  // Below a desk's width the tree is a field that opens it, and the table
  // takes the whole width; below a phone's, a row is a line with its facts
  // under it rather than a table squeezed into a third of the width.
  const folded = useIsBelow(1024)
  const phone = useIsBelow(768)
  const [pickingUnit, setPickingUnit] = useState(false)
  // the unit being looked in, or everywhere the reader may look when none
  // is: the field says what the list is narrowed to, never what it is for
  const unitName =
    context.nodeId === null
      ? m.picker_allUnits()
      : (context.nodes.find((node) => node.id === context.nodeId)?.name ?? m.picker_units())

  // the caller hears about the search once it has stopped moving; it is the
  // one that has to go and fetch on the strength of it
  const { search, onSearchChange } = context
  useEffect(() => {
    if (typed.trim() === search) return
    const timer = setTimeout(() => onSearchChange(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed, search, onSearchChange])

  const chosen = new Set(context.value)
  const blocked = new Set(context.disabled ?? [])
  const many = context.single !== true
  const replace = many ? context.onChange : undefined

  // Where somebody stands, said from under the unit being looked at: the
  // list is already about that unit, and everything above it on every row
  // only pushes the part that differs off the end of the cell. Somebody at
  // the unit itself is said to stand there; with nothing chosen in the
  // tree, the top of it is left off, since it is the same for everybody.
  const byId = useMemo(() => new Map(context.nodes.map((node) => [node.id, node])), [context.nodes])
  const stepsOf = (row: Row): readonly PathStep[] => {
    const steps: PathStep[] = []
    const start = row.unitId ?? null
    for (
      let at = start === null ? undefined : byId.get(start);
      at !== undefined;
      at = at.parentId === null ? undefined : byId.get(at.parentId)
    ) {
      if (at.id === context.nodeId && steps.length > 0) break
      if (context.nodeId === null && at.parentId === null && steps.length > 0) break
      steps.unshift({ id: at.id, name: at.name })
      if (at.id === context.nodeId) break
    }
    if (steps.length === 0 && row.unitName !== undefined && row.unitName !== null) {
      steps.push({ id: start ?? row.id, name: row.unitName })
    }
    return steps
  }
  const withUnits = context.rows.some(
    (row) => (row.unitId ?? null) !== null || (row.unitName ?? null) !== null,
  )
  const withKinds = context.rows.some((row) => row.userTypeName !== null)

  // the page in or out as a whole: only the people who may be chosen, and
  // nobody chosen on another page is let go by it
  const open = context.rows.filter((row) => !blocked.has(row.id))
  const taken = open.filter((row) => chosen.has(row.id)).length
  const pageState: boolean | 'indeterminate' =
    taken === 0 ? false : taken === open.length ? true : 'indeterminate'
  const takePage = (take: boolean) => {
    if (replace === undefined) return
    const ids = new Set(open.map((row) => row.id))
    replace(
      take
        ? [...context.value, ...open.map((row) => row.id).filter((id) => !chosen.has(id))]
        : context.value.filter((id) => !ids.has(id)),
    )
  }
  const pageBox = replace !== undefined && open.length > 0

  // The rows on screen are the answer to the question being asked, on the
  // page being asked for - only then is anything said about them as a
  // whole: how many there are, and how many of the chosen are elsewhere.
  // Waiting for a first answer, or failing to get one, there are no rows to
  // be elsewhere from; waiting for a changed question, the count on screen
  // is the old question's.
  const failed = context.failure != null || (context.error ?? null) !== null
  const answered = !context.pending && !failed
  const settled = answered && context.waiting === undefined
  const counted = answered && context.waiting !== 'question'
  const offPage = settled
    ? context.value.filter((id) => !context.rows.some((row) => row.id === id)).length
    : 0
  const busy = context.pending || context.waiting !== undefined

  // a press anywhere on a row is a press on its box; the box answers for
  // itself, and a row that may not be chosen answers nothing
  const pressRow = (row: Row) => (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('input, button, a, label') !== null) return
    if (!blocked.has(row.id)) context.onToggle(row.id)
  }

  const tree = (
    <OrgTree
      nodes={context.nodes}
      emptyLabel={m.picker_noUnits()}
      expandLabel={m.picker_expand()}
      selected={context.nodeId}
      onSelect={(picked) => {
        context.onNodeChange(picked.id)
        setPickingUnit(false)
      }}
    />
  )

  const number = (row: Row) => row.businessNo ?? m.person_noBusinessNo({ businessNo })

  const table = (
    <Table fill aria-label={m.picker_people()} xstyle={styles.fixed}>
      <colgroup>
        <col {...stylex.props(styles.colTick)} />
        {/* the unit takes what is left where there is one, the name where not */}
        <col {...stylex.props(withUnits && styles.colName)} />
        <col {...stylex.props(styles.colNumber)} />
        {withUnits && <col />}
        {withKinds && <col {...stylex.props(styles.colKind)} />}
      </colgroup>
      <TableHeader sticky>
        <TableRow>
          <TableHead scope="col" xstyle={[styles.headCell, styles.tickCell]}>
            {pageBox && (
              <Checkbox
                checked={pageState}
                aria-label={m.picker_takePage()}
                data-testid="people-picker-page"
                onCheckedChange={(next) => takePage(next)}
              />
            )}
          </TableHead>
          <TableHead scope="col" xstyle={styles.headCell}>
            {m.users_columnName()}
          </TableHead>
          <TableHead scope="col" xstyle={styles.headCell} title={businessNo}>
            {businessNo}
          </TableHead>
          {withUnits && (
            <TableHead scope="col" xstyle={styles.headCell}>
              {m.users_columnUnit()}
            </TableHead>
          )}
          {withKinds && (
            <TableHead scope="col" xstyle={styles.headCell}>
              {m.users_columnType()}
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {context.rows.map((row) => {
          const isBlocked = blocked.has(row.id)
          const isChosen = chosen.has(row.id)
          const steps = withUnits ? stepsOf(row) : []
          return (
            <TableRow
              key={row.id}
              data-testid="people-picker-row"
              data-chosen={isChosen}
              data-blocked={isBlocked}
              {...(isChosen ? { 'data-state': 'selected' } : {})}
              xstyle={isBlocked ? styles.rowStill : styles.row}
              onClick={pressRow(row)}
            >
              <TableCell xstyle={[styles.cell, styles.tickCell]}>
                <Checkbox
                  checked={isChosen}
                  disabled={isBlocked}
                  aria-label={row.displayName}
                  onCheckedChange={() => context.onToggle(row.id)}
                />
              </TableCell>
              <TableCell xstyle={[styles.cell, styles.nameCell]}>
                <span {...stylex.props(styles.nameLine)}>
                  <span
                    title={row.displayName}
                    {...stylex.props(styles.nameWord, isBlocked && styles.blockedName)}
                  >
                    {row.displayName}
                  </span>
                  {isBlocked && context.disabledLabel !== undefined && (
                    <Badge variant="secondary" className={stylex.props(styles.badge).className}>
                      {context.disabledLabel}
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell
                title={number(row)}
                xstyle={[styles.cell, styles.numeric, row.businessNo === null && styles.quietWord]}
              >
                {number(row)}
              </TableCell>
              {withUnits && (
                <TableCell xstyle={styles.cell}>
                  {steps.length > 0 && (
                    <UnitPath steps={steps} plain pickLabel="" onPick={() => {}} />
                  )}
                </TableCell>
              )}
              {withKinds && (
                <TableCell xstyle={styles.cell} title={row.userTypeName ?? undefined}>
                  {row.userTypeName ?? ''}
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  const lines = (
    <>
      {pageBox && (
        <label {...stylex.props(styles.pageBar)}>
          <Checkbox
            checked={pageState}
            aria-label={m.picker_takePage()}
            data-testid="people-picker-page"
            onCheckedChange={(next) => takePage(next)}
          />
          <span {...stylex.props(styles.pageBarWord)}>{m.picker_takePage()}</span>
          {context.paging !== undefined && counted && (
            <span {...stylex.props(styles.pageBarTotal)}>
              {m.picker_total({ count: context.paging.total })}
            </span>
          )}
        </label>
      )}
      <ul {...stylex.props(styles.lines)} aria-label={m.picker_people()}>
        {context.rows.map((row) => {
          const isBlocked = blocked.has(row.id)
          const isChosen = chosen.has(row.id)
          const steps = withUnits ? stepsOf(row) : []
          // the unit comes last on its line, because it is the one that
          // gives way: the number keeps its digits and the unit keeps as much
          // of its end as fits
          const facts = [
            <span
              key="number"
              {...stylex.props(
                styles.factHeld,
                styles.numeric,
                row.businessNo === null && styles.quietWord,
              )}
            >
              {number(row)}
            </span>,
            ...(steps.length > 0
              ? [
                  <span key="unit" {...stylex.props(styles.factGives)}>
                    <UnitPath steps={steps} plain pickLabel="" onPick={() => {}} />
                  </span>,
                ]
              : []),
          ]
          return (
            <li
              key={row.id}
              data-testid="people-picker-row"
              data-chosen={isChosen}
              data-blocked={isBlocked}
              {...stylex.props(
                styles.line,
                isChosen && styles.lineChosen,
                isBlocked && styles.rowStill,
              )}
              onClick={pressRow(row)}
            >
              <Checkbox
                checked={isChosen}
                disabled={isBlocked}
                aria-label={row.displayName}
                onCheckedChange={() => context.onToggle(row.id)}
              />
              <span {...stylex.props(styles.lineWords)}>
                <span {...stylex.props(styles.lineName)}>
                  <span
                    title={row.displayName}
                    {...stylex.props(styles.lineNameWord, isBlocked && styles.blockedName)}
                  >
                    {row.displayName}
                  </span>
                  {isBlocked && context.disabledLabel !== undefined && (
                    <Badge variant="secondary" className={stylex.props(styles.badge).className}>
                      {context.disabledLabel}
                    </Badge>
                  )}
                  {/* the kind stands at the end of the name's line, where
                      a column of them reads straight down */}
                  {row.userTypeName !== null && row.userTypeName !== '' && (
                    <span {...stylex.props(styles.lineKind)}>{row.userTypeName}</span>
                  )}
                </span>
                <span {...stylex.props(styles.lineFacts)}>
                  {facts.flatMap((fact, index) =>
                    index === 0
                      ? [fact]
                      : [
                          <span
                            key={`rule-${index}`}
                            aria-hidden
                            {...stylex.props(styles.factRule)}
                          />,
                          fact,
                        ],
                  )}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )

  const scopeToggle = (
    <ToggleGroup
      value={context.scope}
      onValueChange={(next) => next && context.onScopeChange(next as 'self' | 'subtree')}
    >
      <ToggleGroupItem value="self">{m.picker_scopeSelf()}</ToggleGroupItem>
      <ToggleGroupItem value="subtree">{m.picker_scopeSubtree()}</ToggleGroupItem>
    </ToggleGroup>
  )

  const paging = context.paging
  // a count that belongs to another question offers pages that are not
  // this question's, so there are none to offer until it is answered
  const pager =
    paging === undefined ? (
      <CursorPager
        testId="people-picker-pager"
        label={m.users_pager()}
        previousLabel={m.picker_previous()}
        nextLabel={m.picker_next()}
        page={context.position ?? (context.hasPrevious ? 2 : 1)}
        hasNext={context.hasNext}
        disabled={busy}
        onPrevious={context.onPrevious}
        onNext={context.onNext}
      />
    ) : counted ? (
      <Pager
        testId="people-picker-pager"
        label={m.users_pager()}
        previousLabel={m.picker_previous()}
        nextLabel={m.picker_next()}
        page={paging.page}
        pageSize={paging.pageSize}
        total={paging.total}
        // the first, the last and the one being read: the strip shares
        // its line with how many are chosen
        compact
        disabled={busy}
        {...(phone ? {} : { summary: m.picker_total({ count: paging.total }) })}
        onPage={paging.onPage}
      />
    ) : null

  return (
    <div
      {...stylex.props(styles.frame, folded ? styles.frameFolded : styles.frameSplit)}
      data-testid="people-picker"
    >
      {!folded && (
        <div {...stylex.props(styles.side)}>
          <p {...stylex.props(styles.heading)}>{m.picker_units()}</p>
          <div {...stylex.props(styles.tree)}>{tree}</div>
          {context.nodesTruncated === true && (
            <p {...stylex.props(styles.aside)}>{commonMessages.state_moreResults()}</p>
          )}
        </div>
      )}

      <div {...stylex.props(styles.people)}>
        <div {...stylex.props(styles.controls)}>
          {folded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              justify="space-between"
              data-testid="people-picker-unit"
              aria-label={m.picker_units()}
              className={stylex.props(styles.unitField).className}
              onClick={() => setPickingUnit(true)}
            >
              <span {...stylex.props(styles.unitWord)}>{unitName}</span>
              <ChevronsUpDownIcon
                className={stylex.props(styles.chevron).className}
                data-icon="inline-end"
              />
            </Button>
          )}
          {/* where to look, then whom: folded, the unit and how far under it
              share the first line */}
          {folded && scopeToggle}
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={m.picker_search({ businessNo })}
            aria-label={m.picker_search({ businessNo })}
            className={stylex.props(styles.search).className}
          />
          {context.userTypes.length > 0 && (
            <Select
              value={context.userTypeId === '' ? ANY : context.userTypeId}
              onValueChange={(next) => context.onUserTypeChange(next === ANY ? '' : next)}
            >
              <SelectTrigger size="sm" xstyle={styles.typeField} aria-label={m.person_userType()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{m.picker_anyType()}</SelectItem>
                {context.userTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!folded && scopeToggle}
        </div>

        <div
          {...stylex.props(styles.listBox)}
          data-testid="people-picker-list"
          aria-busy={busy}
          data-waiting={context.waiting}
        >
          <AsyncSection
            xstyle={[styles.listFill, context.waiting !== undefined && styles.listStale]}
            pending={context.pending}
            error={
              // the reading itself, when the caller hands it over, is said in
              // the words of reading; a sentence already worded is shown as given
              context.failure != null ? describe.of(context.failure) : (context.error ?? null)
            }
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={context.onRetry}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                {['34%', '46%', '28%', '41%', '31%', '44%'].map((width, index) => (
                  <div key={index} {...stylex.props(styles.waitingRow)}>
                    <Skeleton className={stylex.props(styles.waitingBox).className} />
                    <Skeleton
                      className={stylex.props(styles.waitingBone).className}
                      width={width}
                    />
                  </div>
                ))}
              </div>
            }
          >
            {context.rows.length === 0 ? (
              <p {...stylex.props(styles.nobody)}>{m.picker_nobody()}</p>
            ) : phone ? (
              lines
            ) : (
              table
            )}
          </AsyncSection>
        </div>

        <div {...stylex.props(styles.foot)}>
          <span
            {...stylex.props(styles.chosen, context.value.length === 0 && styles.chosenNone)}
            data-testid="people-picker-count"
            data-count={context.value.length}
            data-elsewhere={many ? offPage : 0}
          >
            {m.picker_chosen({ count: context.value.length })}
            {offPage > 0 && many && (
              <span {...stylex.props(styles.aside)}>
                {m.picker_chosenElsewhere({ count: offPage })}
              </span>
            )}
          </span>
          {replace !== undefined && context.value.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className={stylex.props(styles.clear).className}
              data-testid="people-picker-clear"
              onClick={() => replace([])}
            >
              {m.picker_clear()}
            </Button>
          )}
          <span {...stylex.props(styles.pages)}>{pager}</span>
        </div>
      </div>

      {/* one at a time: the tree takes the panel's place rather than standing
          over it, because two stacked sheets on a phone leave nothing of the
          first to come back to */}
      <FormDialog
        open={pickingUnit}
        size="medium"
        title={m.picker_units()}
        onClose={() => setPickingUnit(false)}
        footer={
          <Button variant="outline" size="sm" onClick={() => setPickingUnit(false)}>
            {commonMessages.action_cancel()}
          </Button>
        }
      >
        <div data-testid="people-picker-tree" {...stylex.props(styles.treeSeat)}>
          {tree}
        </div>
      </FormDialog>
    </div>
  )
}
