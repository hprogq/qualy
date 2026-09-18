import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
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
// columns, what the determination even is. So the choice is a step of its
// own, and the rail above it is how a reader comes back to change it.

const styles = stylex.create({
  // one card per question, each its own target. A hairline list with a
  // native radio in it reads as a form control; these are the four or five
  // things the office actually records, and choosing one is the whole step.
  grid: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  choice: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}`,
      ':hover': `inset 0 0 0 1px ${tokens.mutedForeground}`,
    },
    paddingInline: 16,
    paddingBlock: 14,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'box-shadow, background-color',
    transitionDuration: '120ms',
  },
  chosenChoice: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 5%, transparent)`,
    boxShadow: {
      default: `inset 0 0 0 2px ${tokens.primary}`,
      ':hover': `inset 0 0 0 2px ${tokens.primary}`,
    },
  },
  check: {
    flexShrink: 0,
    width: 18,
    height: 18,
    opacity: 0,
    color: tokens.primary,
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  checkOn: { opacity: 1 },
  body: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 500,
  },
  // The line under the title keeps its height whether or not it has
  // anything in it yet: where a question sits comes from a second request,
  // and a line that grows from nothing when that answers shoves every card
  // below it down the panel.
  under: {
    display: 'flex',
    flexWrap: 'wrap',
    minHeight: 16,
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  tick: { width: 1, height: 10, backgroundColor: tokens.divider },
})

export function ItemPicker({
  batchId,
  items,
  value,
  onPick,
}: {
  batchId: string
  items: readonly ItemDto[]
  /** the one chosen so far; a choice is confirmed, not fallen through */
  value: string
  onPick: (itemId: string) => void
}) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  const where = trailOf(groups.data?.groups ?? [])
  // Where a question sits comes from a second request. Until it answers the
  // line under the title stays empty rather than half-written: showing the
  // cap first and the path afterwards makes one line arrive in two pieces,
  // which reads as the panel correcting itself.
  const placed = !groups.isPending

  return (
    <div {...stylex.props(styles.grid)} role="radiogroup" data-testid="record-item-picker">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          data-testid="record-item-choice"
          data-item={item.id}
          onClick={() => onPick(item.id)}
          {...stylex.props(styles.choice, value === item.id && styles.chosenChoice)}
        >
          <span {...stylex.props(styles.body)}>
            <span {...stylex.props(styles.title)}>{item.title}</span>
            <span {...stylex.props(styles.under)}>
              {placed && (
                <>
                  <span>{where(item.scoreGroupId)}</span>
                  {item.maxEntries !== null && (
                    <>
                      <span aria-hidden {...stylex.props(styles.tick)} />
                      <span>{format(m.recordItemCap, { count: item.maxEntries })}</span>
                    </>
                  )}
                </>
              )}
            </span>
          </span>
          <CheckIcon
            aria-hidden
            {...stylex.props(styles.check, value === item.id && styles.checkOn)}
          />
        </button>
      ))}
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
