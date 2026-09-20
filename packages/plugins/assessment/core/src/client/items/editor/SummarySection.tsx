import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { assessmentMessages as m } from '../../i18n.ts'
import { EditorSection, SectionCount, Tag } from './Rows.tsx'
import { SUMMARY_FIELDS_MOST, type FieldType } from './model.ts'
import { TYPE_LABEL } from './words.ts'

// Which fields name a record wherever records are listed, in order (§32.74):
// up to three, the first is the record's title. A file count names no record
// and a yes or no is not a name either, so neither is offered.
//
// A block of its own under the form, in the open: it is a decision about the
// form's fields, made while looking at them, and tucked behind a panel it
// was the one setting nobody found. Nothing chosen is a state, not a gap -
// the first few fields are used, and the block says which.

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingBlock: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    userSelect: 'none',
  },
  markBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  markAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  handle: {
    display: 'flex',
    flexShrink: 0,
    cursor: { default: 'grab', ':active': 'grabbing' },
    paddingInline: 2,
    paddingBlock: 4,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
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
    fontSize: 10.5,
    fontWeight: 600,
    color: tokens.background,
    fontVariantNumeric: 'tabular-nums',
  },
  ordinalAuto: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  nameAuto: { fontWeight: 500, color: tokens.mutedForeground },
  type: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground },
  spacer: { flexGrow: 1 },
  foot: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 6,
    paddingInline: 16,
    paddingBlock: 12,
    backgroundColor: tokens.surfaceInset,
  },
  footLabel: { paddingRight: 2, fontSize: 12, color: tokens.mutedForeground },
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
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    backgroundColor: tokens.background,
    color: {
      default: tokens.foreground,
      ':disabled': `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    },
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
  },
  quiet: { fontSize: 12, color: tokens.mutedForeground },
  count: { fontSize: 12, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  icon12: { width: 12, height: 12 },
  icon14: { width: 14, height: 14 },
})

export interface SummaryCandidate {
  readonly id: string
  readonly name: string
  readonly type: FieldType
}

export function SummarySection({
  candidates,
  elected,
  problem,
  onChange,
}: {
  /** every field of the form, in form order */
  candidates: readonly SummaryCandidate[]
  elected: readonly string[]
  /** what the server found wrong with the choice, already in words */
  problem?: string | undefined
  onChange: (next: string[]) => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const eligible = candidates.filter((one) => one.type !== 'attachment' && one.type !== 'boolean')
  const chosen = elected.filter((id) => eligible.some((one) => one.id === id))
  const remaining = eligible.filter((one) => !chosen.includes(one.id))
  const full = chosen.length >= SUMMARY_FIELDS_MOST
  const custom = chosen.length > 0
  // what a list shows while nothing is chosen: the first few, in form order
  const automatic = eligible.slice(0, SUMMARY_FIELDS_MOST)
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
    <EditorSection
      title={format(m.itemsSummaryBlock)}
      hint={format(m.itemsSummarySectionHint)}
      block="summary"
      testId="summary-block"
      aside={
        problem === undefined ? (
          <Tag testId="summary-mode">
            {format(custom ? m.itemsSummaryCustom : m.itemsSummaryAuto)}
          </Tag>
        ) : (
          <SectionCount tone="error">{problem}</SectionCount>
        )
      }
    >
      <div {...stylex.props(styles.card)} data-custom={custom}>
        {eligible.length === 0 && (
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.quiet)}>{format(m.itemsSummaryNoFields)}</span>
          </div>
        )}
        {custom
          ? chosen.map((id, index) => {
              const one = eligible.find((candidate) => candidate.id === id)!
              const marked = drop?.id === id ? drop.edge : null
              return (
                <div
                  key={id}
                  data-testid="summary-row"
                  data-field-id={id}
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
                  {...stylex.props(
                    styles.row,
                    marked === 'before' && styles.markBefore,
                    marked === 'after' && styles.markAfter,
                  )}
                >
                  <span
                    aria-hidden
                    onPointerDown={() => setHeld(id)}
                    onPointerUp={() => setHeld(null)}
                    {...stylex.props(styles.handle)}
                  >
                    <GripVerticalIcon {...stylex.props(styles.icon14)} />
                  </span>
                  <span {...stylex.props(styles.ordinal)}>{index + 1}</span>
                  <span {...stylex.props(styles.name)}>{one.name}</span>
                  <span {...stylex.props(styles.type)}>{format(TYPE_LABEL[one.type])}</span>
                  {index === 0 && <Tag>{format(m.itemsSummaryLead)}</Tag>}
                  <span {...stylex.props(styles.spacer)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onChange(chosen.filter((other) => other !== id))}
                  >
                    <XIcon aria-hidden />
                    <VisuallyHidden>{format(m.itemsSummaryRemove)}</VisuallyHidden>
                  </Button>
                </div>
              )
            })
          : automatic.map((one, index) => (
              <div key={one.id} {...stylex.props(styles.row)} data-testid="summary-auto-row">
                <span {...stylex.props(styles.ordinal, styles.ordinalAuto)}>{index + 1}</span>
                <span {...stylex.props(styles.name, styles.nameAuto)}>{one.name}</span>
                <span {...stylex.props(styles.type)}>{format(TYPE_LABEL[one.type])}</span>
                {index === 0 && <Tag>{format(m.itemsSummaryLead)}</Tag>}
              </div>
            ))}
        {eligible.length > 0 && (
          <div {...stylex.props(styles.foot)}>
            {remaining.length > 0 && (
              <span {...stylex.props(styles.footLabel)}>
                {format(custom ? m.itemsSummaryOthers : m.itemsSummaryCustom)}
              </span>
            )}
            {remaining.map((one) => (
              <button
                key={one.id}
                type="button"
                disabled={full}
                data-testid="summary-add"
                data-field-id={one.id}
                onClick={() => onChange([...chosen, one.id])}
                {...stylex.props(styles.addKey)}
              >
                <PlusIcon aria-hidden {...stylex.props(styles.icon12)} />
                {one.name}
              </button>
            ))}
            <span {...stylex.props(styles.spacer)} />
            <span {...stylex.props(custom ? styles.count : styles.quiet)}>
              {custom
                ? full
                  ? format(m.itemsSummaryCapFull, { most: SUMMARY_FIELDS_MOST })
                  : format(m.itemsSummaryCount, { count: chosen.length, most: SUMMARY_FIELDS_MOST })
                : format(m.itemsSummaryAutoHint)}
            </span>
          </div>
        )}
      </div>
    </EditorSection>
  )
}
