import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GripVerticalIcon, PlusIcon, TagIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { assessmentMessages as m } from '../../i18n.ts'
import { SUMMARY_FIELDS_MOST, type FieldType } from './model.ts'
import { TYPE_LABEL } from './words.ts'

// Which fields identify a record in a list, in order (§32.74): up to three,
// the first is the record's title. A file count names no record, and a
// yes or no is not a name either, so neither is offered.

const styles = stylex.create({
  root: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  head: { display: 'flex', alignItems: 'baseline', gap: 8 },
  headLabel: { fontSize: 12, fontWeight: 500, color: tokens.mutedForeground },
  count: { fontSize: 12, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  spacer: { flexGrow: 1 },
  emptySeat: { borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: tokens.border, padding: 24 },
  emptyHead: { gap: 6 },
  emptyMedia: { marginBottom: 4, width: 32, height: 32, borderRadius: tokens.radiusLg },
  emptyTitle: { fontSize: 14, fontWeight: 500 },
  emptyDesc: { fontSize: 12, lineHeight: 1.625 },
  list: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingBlock: 6,
    paddingRight: 8,
    paddingLeft: 6,
    userSelect: 'none',
  },
  markBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  markAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  handle: {
    flexShrink: 0,
    cursor: { default: 'grab', ':active': 'grabbing' },
    paddingInline: 2,
    paddingBlock: 4,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  ordinal: {
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
    fontSize: 10,
    fontWeight: 600,
    color: tokens.background,
    fontVariantNumeric: 'tabular-nums',
  },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 },
  type: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground },
  lead: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: 10,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  others: { display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 6 },
  othersLabel: { paddingRight: 2, fontSize: 12, color: tokens.mutedForeground },
  addKey: {
    display: 'inline-flex',
    height: 28,
    alignItems: 'center',
    gap: 4,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: { default: 'dashed', ':hover': 'solid' },
    borderColor: tokens.border,
    paddingInline: 10,
    fontFamily: 'inherit',
    fontSize: 12,
    whiteSpace: 'nowrap',
    backgroundColor: 'transparent',
    color: { default: tokens.foreground, ':disabled': `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)` },
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
  },
  capNote: { fontSize: 11, color: tokens.mutedForeground },
  footer: { display: 'flex', justifyContent: 'flex-end' },
  icon12: { width: 12, height: 12 },
  icon14: { width: 14, height: 14 },
  icon16: { width: 16, height: 16 },
})

export interface SummaryCandidate {
  readonly id: string
  readonly name: string
  readonly type: FieldType
}

export function SummarySheet({
  open,
  candidates,
  elected,
  onChange,
  onClose,
}: {
  open: boolean
  /** every field a record could be named by, in form order */
  candidates: readonly SummaryCandidate[]
  elected: readonly string[]
  onChange: (next: string[]) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const eligible = candidates.filter((one) => one.type !== 'attachment' && one.type !== 'boolean')
  const chosen = elected.filter((id) => eligible.some((one) => one.id === id))
  const remaining = eligible.filter((one) => !chosen.includes(one.id))
  const full = chosen.length >= SUMMARY_FIELDS_MOST
  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const)
  }
  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = chosen.filter((id) => id !== dragged)
    const at = order.indexOf(target)
    order.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onChange(order)
  }
  return (
    <SidePanel
      open={open}
      title={format(m.itemsSummaryTitle)}
      description={format(m.itemsSummaryHint, { most: SUMMARY_FIELDS_MOST })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button onClick={onClose}>{format(commonMessages.close)}</Button>
        </div>
      }
    >
      <div {...stylex.props(styles.root)} data-testid="summary-sheet">
        {chosen.length > 0 && (
          <div {...stylex.props(styles.head)}>
            <p {...stylex.props(styles.headLabel)}>{format(m.itemsSummaryChosen)}</p>
            <span {...stylex.props(styles.spacer)} />
            <p {...stylex.props(styles.count)}>
              {format(m.itemsSummaryCount, { count: chosen.length, most: SUMMARY_FIELDS_MOST })}
            </p>
          </div>
        )}
        {chosen.length === 0 ? (
          <Empty xstyle={styles.emptySeat}>
            <EmptyHeader xstyle={styles.emptyHead}>
              <EmptyMedia variant="icon" xstyle={styles.emptyMedia}>
                <TagIcon className={stylex.props(styles.icon16).className} />
              </EmptyMedia>
              <EmptyTitle xstyle={styles.emptyTitle}>{format(m.itemsSummaryEmptyTitle)}</EmptyTitle>
              <EmptyDescription xstyle={styles.emptyDesc}>{format(m.itemsSummaryFallback)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul {...stylex.props(styles.list)}>
            {chosen.map((id, index) => {
              const one = eligible.find((candidate) => candidate.id === id)!
              const marked = drop?.id === id ? drop.edge : null
              return (
                <li
                  key={id}
                  draggable={held === id}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('qualy/summary-field', id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setHeld(null)
                    setDrop(null)
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('qualy/summary-field')) return
                    event.preventDefault()
                    setDrop({ id, edge: edgeOf(event) })
                  }}
                  onDragLeave={() => setDrop((mark) => (mark?.id === id ? null : mark))}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDrop(null)
                    const dragged = event.dataTransfer.getData('qualy/summary-field')
                    if (dragged !== '') move(dragged, id, edgeOf(event))
                  }}
                  {...stylex.props(styles.row, marked === 'before' && styles.markBefore, marked === 'after' && styles.markAfter)}
                >
                  <span aria-hidden onPointerDown={() => setHeld(id)} onPointerUp={() => setHeld(null)} {...stylex.props(styles.handle)}>
                    <GripVerticalIcon className={stylex.props(styles.icon14).className} />
                  </span>
                  <span {...stylex.props(styles.ordinal)}>{index + 1}</span>
                  <span {...stylex.props(styles.name)}>{one.name}</span>
                  <span {...stylex.props(styles.type)}>{format(TYPE_LABEL[one.type])}</span>
                  {index === 0 && <span {...stylex.props(styles.lead)}>{format(m.itemsSummaryLead)}</span>}
                  <span {...stylex.props(styles.spacer)} />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(chosen.filter((other) => other !== id))}>
                    <XIcon aria-hidden />
                    <VisuallyHidden>{format(m.itemsSummaryRemove)}</VisuallyHidden>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {remaining.length > 0 && (
          <div {...stylex.props(styles.others)}>
            <span {...stylex.props(styles.othersLabel)}>{format(m.itemsSummaryOthers)}</span>
            {remaining.map((one) => (
              <button
                key={one.id}
                type="button"
                disabled={full}
                onClick={() => onChange([...chosen, one.id])}
                {...stylex.props(styles.addKey)}
              >
                <PlusIcon aria-hidden className={stylex.props(styles.icon12).className} />
                {one.name}
              </button>
            ))}
          </div>
        )}
        {full && <p {...stylex.props(styles.capNote)}>{format(m.itemsSummaryCapFull, { most: SUMMARY_FIELDS_MOST })}</p>}
      </div>
    </SidePanel>
  )
}
