import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ClockIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { timeLabel, useHowLongAgo, type AwaitingDto } from './model.ts'

// What this reviewer's step is waiting on somebody else for.
//
// Its own section under the queue rather than rows inside it: the queue is
// what can be decided now, and a round paused for material cannot be. But it
// has to be somewhere - an ask nobody can see is an ask nobody follows up,
// and the filing behind it looks to its owner like a review that stopped.
//
// Two kinds of row, one fact at two moments: still with the person who filed,
// or answered and back here. The second kind is also in the queue above; it
// appears here as well because arriving there it would look like any other
// filing and give no sign that it is the answer to a question this step asked.

const lg = '@media (min-width: 1024px)'

const styles = stylex.create({
  empty: {
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 16,
    paddingBlock: 10,
  },
  headTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  countBadge: {
    backgroundColor: tokens.background,
    fontVariantNumeric: 'tabular-nums',
  },
  quietNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  columns: {
    display: {
      default: 'none',
      [lg]: 'grid',
    },
    gridTemplateColumns: '10rem minmax(0, 1fr) 9rem 9rem 7rem 6rem',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: {
      default: 'flex',
      [lg]: 'grid',
    },
    flexDirection: 'column',
    gridTemplateColumns: {
      default: null,
      [lg]: '10rem minmax(0, 1fr) 9rem 9rem 7rem 6rem',
    },
    alignItems: {
      default: null,
      [lg]: 'center',
    },
    columnGap: {
      default: 6,
      [lg]: 12,
    },
    rowGap: {
      default: 6,
      [lg]: 4,
    },
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    paddingInline: 16,
    paddingBlock: {
      default: 12,
      [lg]: 10,
    },
  },
  edgeAnswered: {
    borderLeftColor: tokens.foreground,
  },
  edgeQuiet: {
    borderLeftColor: 'transparent',
  },
  group: {
    display: {
      default: 'flex',
      [lg]: 'contents',
    },
    alignItems: 'center',
    gap: 8,
  },
  who: {
    display: 'flex',
    minWidth: 0,
    flexGrow: {
      default: 1,
      [lg]: 0,
    },
    flexShrink: {
      default: 1,
      [lg]: 0,
    },
    flexBasis: {
      default: '0%',
      [lg]: 'auto',
    },
    alignItems: 'baseline',
    gap: 8,
    gridColumnStart: {
      default: null,
      [lg]: 1,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  businessNo: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  pillSeat: {
    gridColumnStart: {
      default: null,
      [lg]: 4,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 10,
    paddingBlock: 2,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  pillAnswered: {
    borderColor: `color-mix(in oklab, ${tokens.foreground} 30%, transparent)`,
  },
  pillOpen: {
    color: tokens.mutedForeground,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
  },
  dotAnswered: {
    backgroundColor: tokens.foreground,
  },
  dotOpen: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  ask: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    gridColumnStart: {
      default: null,
      [lg]: 2,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
  },
  askTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  askWant: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  waited: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
    gridColumnStart: {
      default: null,
      [lg]: 3,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
  },
  clockIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  dotSep: {
    display: {
      default: 'inline',
      [lg]: 'none',
    },
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  askedAt: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
    gridColumnStart: {
      default: null,
      [lg]: 5,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
  },
  mobileSpacer: {
    display: {
      default: 'inline',
      [lg]: 'none',
    },
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  openSeat: {
    display: 'flex',
    gridColumnStart: {
      default: null,
      [lg]: 6,
    },
    gridRowStart: {
      default: null,
      [lg]: 1,
    },
    justifyContent: {
      default: null,
      [lg]: 'flex-end',
    },
  },
})

export function AwaitingSection({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const howLongAgo = useHowLongAgo()
  const asked = useQuery({
    ...query.assessment.listAwaitingSupplements.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  const rows = asked.data?.items ?? []
  // its own view now, so an empty one says so instead of vanishing: a tab
  // that opens onto nothing at all reads as broken, not as quiet
  if (rows.length === 0) {
    return <p {...stylex.props(styles.empty)}>{format(m.reviewAwaitingEmpty)}</p>
  }
  const answered = rows.filter((row) => row.status === 'answered').length

  return (
    <section {...stylex.props(styles.section)}>
      <header {...stylex.props(styles.head)}>
        <p {...stylex.props(styles.headTitle)}>{format(m.reviewAwaitingTitle)}</p>
        <Badge variant="outline" className={stylex.props(styles.countBadge).className}>
          {format(m.reviewAwaitingCount, { count: rows.length })}
        </Badge>
        {answered > 0 && (
          <p {...stylex.props(styles.quietNote)}>
            {format(m.reviewAwaitingBack, { count: answered })}
          </p>
        )}
        <span {...stylex.props(styles.spacer)} />
        <p {...stylex.props(styles.quietNote)}>{format(m.reviewAwaitingNote)}</p>
      </header>

      {/* the same column names the queue uses, so the two read as one table
          even though they are two lists */}
      <div {...stylex.props(styles.columns)}>
        <span>{format(m.reviewColumnWho)}</span>
        <span>{format(m.reviewAwaitingColAsk)}</span>
        <span>{format(m.reviewAwaitingColWaited)}</span>
        <span>{format(m.reviewColumnStatus)}</span>
        <span>{format(m.reviewAwaitingColAskedAt)}</span>
        <span />
      </div>

      <ul {...stylex.props(styles.list)}>
        {rows.map((row) => (
          <AwaitingRow
            key={row.requestId}
            row={row}
            howLongAgo={howLongAgo}
            onOpen={() =>
              navigate('assessment/review-instance', {
                params: { batchId, instanceId: row.instanceId },
              })
            }
          />
        ))}
      </ul>
    </section>
  )
}

function AwaitingRow({
  row,
  howLongAgo,
  onOpen,
}: {
  row: AwaitingDto
  howLongAgo: (iso: string) => string
  onOpen: () => void
}) {
  const { format } = useI18n()
  const answered = row.status === 'answered'
  return (
    // Stacked lines on a phone, the queue's own columns beside a desk: the
    // same cells serve both, regrouped by wrappers that dissolve at lg and
    // pinned back into their columns by name - left to auto-placement the
    // regrouped order would shuffle the table.
    <li {...stylex.props(styles.row, answered ? styles.edgeAnswered : styles.edgeQuiet)}>
      <div {...stylex.props(styles.group)}>
        <span {...stylex.props(styles.who)}>
          <span {...stylex.props(styles.name)}>{row.participantName}</span>
          {row.businessNo !== null && (
            <span {...stylex.props(styles.businessNo)}>{row.businessNo}</span>
          )}
        </span>
        <span {...stylex.props(styles.pillSeat)}>
          <span {...stylex.props(styles.pill, answered ? styles.pillAnswered : styles.pillOpen)}>
            <span
              aria-hidden
              {...stylex.props(styles.dot, answered ? styles.dotAnswered : styles.dotOpen)}
            />
            {format(answered ? m.reviewAwaitingAnswered : m.supplementStatusOpen)}
          </span>
        </span>
      </div>

      <span {...stylex.props(styles.ask)}>
        <span {...stylex.props(styles.askTitle)}>{row.itemTitle}</span>
        {row.asks.length > 0 && (
          <span {...stylex.props(styles.askWant)}>
            {format(m.reviewAwaitingWant, { what: row.asks.join('、') })}
          </span>
        )}
      </span>

      <div {...stylex.props(styles.group)}>
        {/* how long it has been out, which is the thing worth knowing here;
            the instant it was asked stands beside it */}
        <span {...stylex.props(styles.waited)}>
          <ClockIcon aria-hidden className={stylex.props(styles.clockIcon).className} />
          {howLongAgo(row.requestedAt)}
        </span>
        <span aria-hidden {...stylex.props(styles.dotSep)}>
          ·
        </span>
        <span {...stylex.props(styles.askedAt)}>{timeLabel(row.requestedAt)}</span>
        <span {...stylex.props(styles.mobileSpacer)} />
        <span {...stylex.props(styles.openSeat)}>
          {/* one way in either way: the round is where both the answer and
              the way to take the ask back are read */}
          <Button variant={answered ? 'outline' : 'ghost'} size="sm" onClick={onOpen}>
            {format(answered ? m.reviewAwaitingGo : m.reviewOpen)}
          </Button>
        </span>
      </div>
    </li>
  )
}
