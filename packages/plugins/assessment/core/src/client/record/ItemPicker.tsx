import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'

// Which question is being settled, chosen by reading them.
//
// This used to be a dropdown, and a dropdown was wrong twice over. It made
// the first thing a reader meets an empty box on an otherwise blank page,
// and it hid the only information that makes the choice possible - where
// each question sits in the batch, and how many times one person may be
// recorded under it. A list of the four or five questions an office
// actually records shows all of that at once, and answering it fills the
// screen rather than making something appear from nowhere.
//
// Everything below depends on the answer: the form's fields, the file's
// columns, what the determination even is. So the choice keeps its own
// screen until it is made, and afterwards shrinks to one line that can be
// pressed to come back.

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: 14,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  body: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 500,
  },
  under: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  tick: { width: 1, height: 10, backgroundColor: tokens.divider },
  chevron: {
    flexShrink: 0,
    width: 16,
    height: 16,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  // once chosen, the way back to the others: a step out, so it sits where
  // every other step out on this page sits
  // once chosen, the question stays legible as a card: which one, where it
  // sits, what it allows - the same three facts the list showed, so nothing
  // is lost by having answered
  chosen: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingInline: 16,
    paddingBlock: 12,
  },
  chosenBody: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  chosenTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 500,
  },
  changeSeat: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  changeHint: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  backIcon: { width: 14, height: 14 },
})

export function ItemPicker({
  batchId,
  items,
  onPick,
}: {
  batchId: string
  items: readonly ItemDto[]
  onPick: (itemId: string) => void
}) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  const where = trailOf(groups.data?.groups ?? [])

  return (
    <div {...stylex.props(styles.card)} data-testid="record-item-picker">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid="record-item-choice"
          data-item={item.id}
          onClick={() => onPick(item.id)}
          {...stylex.props(styles.row)}
        >
          <span {...stylex.props(styles.body)}>
            <span {...stylex.props(styles.title)}>{item.title}</span>
            <span {...stylex.props(styles.under)}>
              <span>{where(item.scoreGroupId)}</span>
              {item.maxEntries !== null && (
                <>
                  <span aria-hidden {...stylex.props(styles.tick)} />
                  <span>{format(m.recordItemCap, { count: item.maxEntries })}</span>
                </>
              )}
            </span>
          </span>
          <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
        </button>
      ))}
    </div>
  )
}

/**
 * The chosen question, as the way back to the others.
 *
 * It names the question rather than saying "change", because a reader who
 * has scrolled into a long form needs to be told which one they are filling
 * in more often than they need to be told they may leave it. Pressing it is
 * how they leave.
 */
export function ChosenItem({
  batchId,
  item,
  onChange,
}: {
  batchId: string
  item: ItemDto
  onChange: () => void
}) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  const where = trailOf(groups.data?.groups ?? [])
  return (
    <div {...stylex.props(styles.chosen)} data-testid="record-item-chosen" data-item={item.id}>
      <span {...stylex.props(styles.chosenBody)}>
        <span {...stylex.props(styles.chosenTitle)}>{item.title}</span>
        <span {...stylex.props(styles.under)}>
          <span>{where(item.scoreGroupId)}</span>
          {item.maxEntries !== null && (
            <>
              <span aria-hidden {...stylex.props(styles.tick)} />
              <span>{format(m.recordItemCap, { count: item.maxEntries })}</span>
            </>
          )}
        </span>
      </span>
      {/* named, not just "change": the word says what is being changed, and
          the line under it says what changing costs */}
      <span {...stylex.props(styles.changeSeat)}>
        <Button size="sm" variant="outline" onClick={onChange} data-testid="record-item-change">
          <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
          {format(m.recordItemChangeSaid)}
        </Button>
        <span {...stylex.props(styles.changeHint)}>{format(m.recordItemChangeHint)}</span>
      </span>
    </div>
  )
}

/** where a question sits, outermost group first */
const trailOf = (groups: readonly { id: string; name: string; parentGroupId: string | null }[]) => {
  const byId = new Map(groups.map((group) => [group.id, group]))
  return (scoreGroupId: string): string => {
    const names: string[] = []
    let at = byId.get(scoreGroupId)
    // a saved tree cannot loop; the bound keeps a bad one from hanging this
    for (let depth = 0; at !== undefined && depth < 16; depth += 1) {
      names.unshift(at.name)
      at = at.parentGroupId === null ? undefined : byId.get(at.parentGroupId)
    }
    return names.join(' / ')
  }
}
