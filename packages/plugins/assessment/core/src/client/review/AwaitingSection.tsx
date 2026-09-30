import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ClockIcon } from 'lucide-react'
import { usePageNavigate } from '@qualy/web-runtime'
import { useList } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Card } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { pageOf, useHowLongAgo, useQueueClock, type AwaitingDto } from './model.ts'
import { useAwaitingQuery } from './queue.ts'
import { PagerFoot } from './QueueViews.tsx'
import * as m from '#messages'

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

/** asks to a page, the same as a question's filings */
const ASKED_PAGE = 10

const styles = stylex.create({
  empty: {
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}`,
    paddingInline: 20,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
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
  // the queue tables' own grey head strip
  columns: {
    display: {
      default: 'none',
      [lg]: 'grid',
    },
    gridTemplateColumns: '10rem minmax(0, 1fr) 9rem 9rem 8rem 6rem',
    alignItems: 'center',
    gap: 12,
    height: 32,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    fontSize: 11,
    fontWeight: 500,
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
      [lg]: '10rem minmax(0, 1fr) 9rem 9rem 8rem 6rem',
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
    borderBottomColor: tokens.divider,
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

export function AwaitingSection({
  batchId,
  page,
  onPage,
}: {
  batchId: string
  page: number
  onPage: (page: number) => void
}) {
  const navigate = usePageNavigate()
  const howLongAgo = useHowLongAgo()
  const asked = useQuery({
    ...useAwaitingQuery(batchId),
    refetchInterval: 30_000,
  })
  const rows = asked.data?.items ?? []
  // its own view now, so an empty one says so instead of vanishing: a tab
  // that opens onto nothing at all reads as broken, not as quiet
  if (rows.length === 0) {
    return <p {...stylex.props(styles.empty)}>{m.review_awaitingEmpty()}</p>
  }
  const answered = rows.filter((row) => row.status === 'answered').length
  const list = pageOf(rows, page, ASKED_PAGE)

  return (
    <Card data-testid="awaiting-pane" data-count={rows.length}>
      <header {...stylex.props(styles.head)}>
        <p {...stylex.props(styles.headTitle)}>{m.review_awaitingTitle()}</p>
        <Badge variant="outline" className={stylex.props(styles.countBadge).className}>
          {m.review_awaitingCount({ count: rows.length })}
        </Badge>
        {answered > 0 && (
          <p {...stylex.props(styles.quietNote)}>{m.review_awaitingBack({ count: answered })}</p>
        )}
      </header>

      {/* the same column names the queue uses, so the two read as one table
          even though they are two lists */}
      <div {...stylex.props(styles.columns)}>
        <span>{m.review_columnWho()}</span>
        <span>{m.review_awaitingColAsk()}</span>
        <span>{m.review_awaitingColWaited()}</span>
        <span>{m.review_columnStatus()}</span>
        <span>{m.review_awaitingColAskedAt()}</span>
        <span />
      </div>

      <ul {...stylex.props(styles.list)}>
        {list.rows.map((row) => (
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
      <PagerFoot list={list} size={ASKED_PAGE} onPage={onPage} anchor="awaiting-pane" />
    </Card>
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
  const clock = useQueueClock()
  const listJoin = useList()
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
            {(answered ? m.review_awaitingAnswered : m.supplement_statusOpen)()}
          </span>
        </span>
      </div>

      <span {...stylex.props(styles.ask)}>
        <span {...stylex.props(styles.askTitle)}>{row.itemTitle}</span>
        {row.asks.length > 0 && (
          <span {...stylex.props(styles.askWant)}>
            {m.review_awaitingWant({ what: listJoin(row.asks) })}
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
          　
        </span>
        <span {...stylex.props(styles.askedAt)}>{clock(row.requestedAt)}</span>
        <span {...stylex.props(styles.mobileSpacer)} />
        <span {...stylex.props(styles.openSeat)}>
          {/* one way in either way, one key for it: the round is where both
              the answer and the way to take the ask back are read. It says
              what there is to do there - review what came back, or look at
              an ask still out */}
          <Button
            variant="outline"
            size="sm"
            data-testid="awaiting-open"
            data-answered={answered}
            onClick={onOpen}
          >
            {(answered ? m.review_awaitingGo : m.review_open)()}
          </Button>
        </span>
      </div>
    </li>
  )
}
