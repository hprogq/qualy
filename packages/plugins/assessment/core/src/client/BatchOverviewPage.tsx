import {
  lazy,
  Suspense,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronRightIcon, HistoryIcon, RotateCwIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
  cursorPages,
} from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { assessmentApi } from './api.ts'
import { useBatchLive } from './live.ts'
import type { ApiResult } from '@qualy/web-runtime/api'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchFlow } from './batch/BatchFlow.tsx'
import { calendarDaysBetween, inZone, useBatchZone, yearOf } from './batch/zone.ts'

import { UnreadDot } from './entry/workspace/marks.tsx'
import {
  owesAdministration,
  useAdminAlerts,
  type AdminAlerts,
  type AlertedQuestion,
} from './batch/admin-alerts.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// The batch's front page as one desk (§32.73, laid out to design 2a/2b):
// the page description says what stands on the desk, the body starts
// straight at the work, and the stage plan keeps to the side - a column
// beside the desk on a wide screen, a strip above it on a phone. The top
// bar already names the current stage, so the page does not say it twice.

const wide = '@media (min-width: 1024px)'
const narrow = '@media (max-width: 1023.98px)'

const styles = stylex.create({
  desk: {
    display: 'grid',
    gap: {
      default: 24,
      [wide]: 48,
    },
    gridTemplateColumns: {
      default: null,
      [wide]: 'minmax(0, 1fr) 17.25rem',
    },
  },
  main: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: {
      default: 20,
      [wide]: 32,
    },
  },
  // what the batch's managers wrote about it, over everything else
  note: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  noteText: {
    margin: 0,
    minWidth: 0,
    fontSize: 13.5,
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    color: tokens.surfaceMutedForeground,
  },
  // the words as typed, while the renderer is still on its way
  notePlain: { margin: 0, whiteSpace: 'pre-wrap' },
  // about four lines, the last fading out; the whole note is a press away.
  // A height rather than a line clamp: a list or a second paragraph is a
  // block of its own, and a clamp counts the lines of one block only
  noteFolded: {
    maxHeight: '6.8em',
    overflow: 'hidden',
  },
  noteFaded: {
    maskImage: 'linear-gradient(to bottom, black calc(100% - 1.7em), transparent)',
  },
  noteDialogText: { fontSize: 14, lineHeight: 1.75, color: tokens.foreground },
  noteKey: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 4,
    height: 26,
    marginLeft: -8,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
    paddingInline: 8,
    fontSize: 12.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  noteKeyIcon: { width: 13, height: 13 },
  // the stage plan on a phone: the same strip, laid over the desk rather
  // than beside it
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  aside: {
    display: {
      default: 'none',
      [wide]: 'block',
    },
  },
  asideTitle: {
    paddingBottom: 12,
    fontSize: 14,
    fontWeight: 600,
  },
  asideSkeletons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  asideSkeletonLine: {
    height: 20,
    width: '100%',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    order: { default: null, [narrow]: 1 },
  },
  actionsHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  actionsCount: {
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  actionsSkeleton: {
    height: 64,
    width: '100%',
  },
  clearCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 24,
    paddingBlock: 36,
  },
  clearMark: {
    display: 'flex',
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    color: tokens.mutedForeground,
  },
  clearIcon: {
    width: 15,
    height: 15,
  },
  clearWord: {
    fontSize: 14,
    fontWeight: 500,
  },
  // One card per section, and the only white on the page.
  //
  // The shell is 0.99 throughout - top bar, batch bar, rail, band - so a
  // content area that is also 0.99 reads as one undifferentiated field. The
  // white is what says "this is the work"; the strips inside it are 0.985,
  // a shade the eye reads as a fold in the same sheet rather than a second
  // surface. Rows rule against each other and never carry their own box.
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  // The plan is a list of what has happened and what is to come, not a thing
  // with a face: given a sheet of its own it read as a third card competing
  // with the two that carry the work. It stands on the page's own ground, and
  // only clears its rail - the mark sits ON the column's leading edge, so
  // with no inset at all the dot hangs off the column.
  asidePlan: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    paddingInlineStart: 4,
  },
  // what needs a hand sits a little proud of what merely happened
  cardRaised: {
    boxShadow: tokens.elevation2,
  },
  lane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  laneRows: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  // the fold: a lane's standing, or a day, named inside the card
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: { default: 9, [wide]: 10 },
  },
  stripWord: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // the day's other half: the date beside a word, or the weekday beside a
  // date. Carried by spacing, which is what this page uses for two facts
  // that sit side by side rather than one qualifying the other.
  stripAside: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  stripCount: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the whole line is the way in; the verb inside is the same door with a
  // keyboard-reachable handle
  // No gap between the rows of a row: the lines under its name keep their
  // own distance, so a row with only a name has no empty line below it, and
  // the verb beside it sits level with the name instead of under nothing.
  todoRow: {
    display: 'grid',
    cursor: 'pointer',
    // the verb's column is a floor, not a ceiling: a verb longer than it in
    // another language widens its own row rather than spilling out of it
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto',
      [wide]: 'minmax(0, 1fr) 3.5rem minmax(7rem, max-content)',
    },
    columnGap: { default: 12, [wide]: 20 },
    rowGap: 0,
    alignItems: 'center',
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: { default: 14, [wide]: 16 },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  // two lines before it gives way: a row can be a sentence as well as a
  // question's name, and a column narrowed by the plan beside it cut the
  // sentence at its first clause
  todoSubject: {
    gridColumnStart: 1,
    gridRowStart: 1,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    minWidth: 0,
    overflow: 'hidden',
    fontSize: 14,
    fontWeight: 500,
    textWrap: 'pretty',
  },
  // a row with no time takes the time's column too, where there is one
  todoTimeless: {
    gridColumnEnd: { default: null, [wide]: 'span 2' },
  },
  // under the words on a phone, a column of its own on a wide desk
  todoAt: {
    gridColumnStart: { default: 1, [wide]: 2 },
    gridRowStart: { default: 3, [wide]: 1 },
    gridRowEnd: { default: null, [wide]: 'span 2' },
    marginTop: { default: 4, [wide]: 0 },
    textAlign: { default: 'left', [wide]: 'right' },
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  todoDetail: {
    gridColumnStart: 1,
    gridRowStart: 2,
    marginTop: 4,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  // The act at the end of its row at every width, level with the words: a
  // phone has room for a short verb beside them, and a verb on a line of its
  // own made every row two rows tall. The whole row answers a press as well,
  // so the button is the keyboard's handle more than the thumb's target.
  todoVerbSeat: {
    gridColumnStart: { default: 2, [wide]: 3 },
    gridRowStart: 1,
    gridRowEnd: { default: 'span 3', [wide]: 'span 2' },
    alignSelf: 'center',
    justifySelf: 'end',
  },
  // a row that is only its name keeps its verb on that one line: spanning
  // the empty lines under it, the verb's height went to them and it sat
  // below the name
  todoVerbSeatLone: { gridRowEnd: 'auto' },
  todoVerb: {
    display: 'inline-flex',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: { default: 32, [wide]: 36 },
    minWidth: { default: null, [wide]: '7rem' },
    paddingInline: { default: 12, [wide]: 16 },
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    borderRadius: { default: tokens.radiusMd, [wide]: tokens.radiusLg },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    transitionProperty: 'color, background-color',
  },
  todoVerbIcon: {
    width: 12,
    height: 12,
  },
  // one seat for the retry's mark and the spinner that replaces it, so the
  // button keeps its width while it asks
  todoVerbMark: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoVerbBusy: {
    cursor: 'progress',
    opacity: 0.7,
  },
  activity: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    order: { default: null, [narrow]: 3 },
    marginTop: { default: null, [wide]: 16 },
  },
  // the header holds the filter, and on a phone it stays put while the days
  // scroll under it
  activityHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 8,
    backgroundColor: tokens.background,
    position: {
      default: null,
      [narrow]: 'sticky',
    },
    top: {
      default: null,
      [narrow]: -24,
    },
    zIndex: {
      default: null,
      [narrow]: 10,
    },
    paddingBlock: {
      default: null,
      [narrow]: 6,
    },
  },
  activityTitle: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
  },
  unreadNote: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  headSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // the way on, as the card's last row rather than a link adrift under it
  moreRow: {
    display: 'flex',
    cursor: 'pointer',
    height: 44,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderInlineWidth: 0,
    borderBottomWidth: 0,
    fontSize: 12,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    transitionProperty: 'color, background-color',
  },
  // the rows it becomes, not a rectangle the size of them: what a reader is
  // waiting for here is a day's heading and a few lines under it, and a
  // hundred-pixel slab says nothing about what is coming
  activityBones: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingBlock: 2,
  },
  activityBoneDay: { height: 11, width: '4.5rem', borderRadius: 3 },
  activityBoneRow: { display: 'flex', alignItems: 'center', gap: 12 },
  activityBoneMark: { width: 22, height: 22, borderRadius: 7, flexShrink: 0 },
  activityBoneWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 5 },
  activityBoneLine: { height: 12, borderRadius: 3 },
  day: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  feedRow: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [wide]: '3.25rem minmax(0, 1fr)',
    },
    columnGap: 20,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: 12,
    textAlign: 'left',
  },
  feedRowOpenable: {
    cursor: 'pointer',
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  feedClockWide: {
    display: {
      default: 'none',
      [wide]: 'block',
    },
    paddingTop: 1,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  feedBody: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  feedTitleLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 10,
  },
  feedTitleSeat: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  feedTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  feedLaneWord: {
    display: {
      default: 'none',
      [wide]: 'inline',
    },
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  feedClockNarrow: {
    display: {
      default: 'inline',
      [wide]: 'none',
    },
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the parts of one claim's identity, told apart by a rule rather than by
  // punctuation: a comma between two nouns reads as prose, and this is not
  feedIdentity: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    // the air on the near side of a rule; the far side is the crumb's own
    // gap, and the two together are what make it read as a separator rather
    // than as a stroke stuck to the word before it
    columnGap: 9,
    rowGap: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  crumb: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
  },
  crumbRule: {
    width: 1,
    height: 11,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 35%, transparent)`,
  },
  feedSentence: {
    fontSize: 13,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  feedQuote: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 10,
    fontSize: 12,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: `color-mix(in oklab, ${tokens.foreground} 70%, transparent)`,
  },
  feedComment: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
  },
})

type OverviewDto = ApiResult<typeof assessmentApi, 'assessment', 'getMyOverview'>
type ActivityItem = ApiResult<typeof assessmentApi, 'assessment', 'listMyActivity'>['items'][number]

export default function BatchOverviewPage() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)

  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const timeline = plan.data?.timeline ?? []
  const overview = useQuery(query.assessment.getMyOverview.queryOptions({ params: { batchId } }))

  useBatchLive(batchId, ({ kinds, stale }) => {
    const moves = [
      'sync',
      'phase-changed',
      'entries-changed',
      'result-changed',
      'review-inbox-changed',
      'review-instance-changed',
    ] as const
    if (!moves.some((kind) => kinds.has(kind))) return
    stale(query.assessment.getMyOverview.key({ params: { batchId } }))
    stale(query.assessment.listMyActivity.key({ params: { batchId }, query: {} }))
  })

  return (
    <BatchScreen title={m.overview_tab()} description={m.overview_hint()}>
      {(batch) => (
        <div {...stylex.props(styles.desk)}>
          {/* No plan here on a phone: the band at the top of the screen is
              the window's own head there, and it already carries the stage,
              its clock and the way to the whole flow. Saying it again as the
              first thing on the page pushed what the reader came for below
              the fold. */}
          <div {...stylex.props(styles.main)}>
            <MyDesk
              batchId={batchId}
              overview={overview}
              manage={batch.capabilities.manage}
              owed={owesAdministration(batch)}
              note={
                batch.descriptionMd !== null && batch.descriptionMd.trim() !== '' ? (
                  <BatchNote text={batch.descriptionMd.trim()} />
                ) : null
              }
            />
          </div>

          <aside {...stylex.props(styles.aside)}>
            <h2 {...stylex.props(styles.asideTitle)}>{m.flow_title()}</h2>
            {plan.isPending ? (
              <div {...stylex.props(styles.asideSkeletons)}>
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
              </div>
            ) : (
              <div {...stylex.props(styles.asidePlan)}>
                <BatchFlow timeline={timeline} keepPast={1} />
              </div>
            )}
          </aside>
        </div>
      )}
    </BatchScreen>
  )
}

/** loaded when a note is shown: most pages never render one */
const NoteMarkdown = lazy(() => import('./batch/NoteMarkdown.tsx'))

/** the note's words, in its markup once the renderer is here and as typed until then */
function NoteText({ text }: { text: string }) {
  return (
    <Suspense fallback={<p {...stylex.props(styles.notePlain)}>{text}</p>}>
      <NoteMarkdown text={text} />
    </Suspense>
  )
}

/**
 * What the batch's managers wrote about it: the background to the desk, so
 * it stands under what needs doing. A notice written in a small markup
 * (batch/note-markdown.ts) - lists of what to bring, the school's own
 * document to read. About four lines at first, and the whole of it in a
 * dialog of its own rather than pushing the rest of the page down.
 */
function BatchNote({ text }: { text: string }) {
  const id = useId()
  const body = useRef<HTMLDivElement | null>(null)
  const [reading, setReading] = useState(false)
  // whether the fold hides anything; measured, since how much a note takes
  // depends on the width it is given, and watched as the renderer arrives,
  // which changes what is inside without resizing the box around it
  const [long, setLong] = useState(false)
  useLayoutEffect(() => {
    const node = body.current
    if (node === null) return
    const measure = () => setLong(node.scrollHeight > node.clientHeight + 1)
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(node)
    const rendered = new MutationObserver(measure)
    rendered.observe(node, { childList: true, subtree: true })
    return () => {
      resized.disconnect()
      rendered.disconnect()
    }
  }, [text])
  return (
    <section
      data-testid="batch-note"
      data-long={long}
      aria-labelledby={`${id}-title`}
      {...stylex.props(styles.note)}
    >
      <h2 id={`${id}-title`} {...stylex.props(styles.sectionTitle)}>
        {m.overview_batchNote()}
      </h2>
      <div
        ref={body}
        {...stylex.props(styles.noteText, styles.noteFolded, long && styles.noteFaded)}
      >
        <NoteText text={text} />
      </div>
      {long && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setReading(true)}
          {...stylex.props(styles.noteKey)}
        >
          {m.overview_batchNoteMore()}
          <ChevronRightIcon aria-hidden {...stylex.props(styles.noteKeyIcon)} />
        </button>
      )}
      <Dialog open={reading} onOpenChange={setReading}>
        <DialogContent data-testid="batch-note-dialog" size="40rem">
          <DialogHeader>
            <DialogTitle>{m.overview_batchNote()}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div {...stylex.props(styles.noteText, styles.noteDialogText)}>
              <NoteText text={text} />
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  )
}

const SAID: Record<'participant' | 'reviewer', Partial<Record<ActivityItem['kind'], unknown>>> = {
  participant: {
    'entry-created': m.activity_entryCreated,
    'entry-revised': m.activity_entryRevised,
    'entry-submitted': m.activity_entrySubmitted,
    'entry-withdrawn': m.activity_entryWithdrawn,
    'entry-abandoned': m.activity_entryAbandoned,
    'entry-voided': m.activity_entryVoided,
    'entry-voided-with-item': m.activity_entryVoidedWithItem,
    'review-approved': m.activity_reviewApproved,
    'review-rejected': m.activity_reviewRejected,
    'review-escalated': m.activity_reviewEscalated,
    'appeal-filed': m.activity_appealFiled,
    'review-reopened': m.activity_reviewReopened,
    'recognition-corrected': m.activity_recognitionCorrected,
    'approval-revoked': m.activity_approvalRevoked,
    'rejection-overturned': m.activity_rejectionOverturned,
    'supplement-requested': m.activity_supplementRequested,
    'supplement-submitted': m.activity_supplementSubmitted,
    'supplement-cancelled': m.activity_supplementCancelled,
    'revision-required': m.activity_revisionRequired,
  },
  reviewer: {
    'review-approved': m.activity_reviewerApproved,
    'review-stage-approved': m.activity_reviewerStageApproved,
    'review-rejected': m.activity_reviewerRejected,
    'review-escalated': m.activity_reviewerEscalated,
    'review-opinion-rejected': m.activity_reviewerOpinionRejected,
    'supplement-requested': m.activity_reviewerSupplementRequested,
    'supplement-cancelled': m.activity_reviewerSupplementCancelled,
    'supplement-answered': m.activity_reviewerSupplementAnswered,
    'review-vote-approved': m.activity_reviewerVoteApproved,
    'review-vote-rejected': m.activity_reviewerVoteRejected,
  },
}

type Lane = 'all' | 'participant' | 'reviewer'

/** the standings a row on the desk speaks to, in the order the desk lists them */
const DESK_LANES = ['participant', 'reviewer', 'manage'] as const
type DeskLane = (typeof DESK_LANES)[number]

interface TodoRow {
  key: string
  lane: DeskLane
  action: string
  count?: number
  /** the questions the row is about, where it names some */
  items?: readonly string[]
  subject: string
  detail: string | null
  at: string | null
  verb: string
  go: () => void
  /**
   * `retry` is a row that stands for a reading that failed rather than for
   * something to do: it is not counted as a thing waiting, and its verb
   * asks again rather than leading anywhere
   */
  kind?: 'retry'
  /** its verb is already on its way, and takes no second press */
  busy?: boolean
}

/** whether a row is one more thing waiting on the reader */
const waitingOn = (row: TodoRow) => row.kind !== 'retry'

/**
 * The desk itself: what needs the reader's hand, grouped by the standing
 * it speaks to, then one merged feed of what lately happened around them.
 * Full histories stay on the claim and the round.
 *
 * Whoever administers the batch has a lane of their own on it (§32.97):
 * what stops the round going on that only an administrator can mend, each
 * said in one line with the way to the page that mends it. An administrator
 * with no other standing here has that lane and nothing else - the feed is
 * of one's own claims and reviews, and they have none.
 */
function MyDesk({
  batchId,
  overview,
  manage,
  owed,
  note,
}: {
  batchId: string
  overview: DeskRead
  /** the reader administers this batch, by the batch's own word */
  manage: boolean
  /** and the batch can still be mended, so what it owes is worth asking for */
  owed: boolean
  /** what the batch's managers wrote about it, when they wrote anything */
  note: ReactNode
}) {
  // the administrator's counts are asked for by administrators only: to
  // anybody else every one of those reads is a refusal
  return manage ? (
    <AdministeredDesk batchId={batchId} overview={overview} owed={owed} note={note} />
  ) : (
    <Desk batchId={batchId} overview={overview} alerts={null} note={note} />
  )
}

/**
 * An administrator's desk. On an archived batch it is still there - a
 * manager with no other standing would otherwise meet an empty page - and
 * says there is nothing to do, since nothing it would list can be mended.
 */
function AdministeredDesk({
  batchId,
  overview,
  owed,
  note,
}: {
  batchId: string
  overview: DeskRead
  owed: boolean
  note: ReactNode
}) {
  const alerts = useAdminAlerts(batchId, owed)
  return <Desk batchId={batchId} overview={overview} alerts={alerts} note={note} />
}

/** the reader's desk as the page read it */
interface DeskRead {
  data: OverviewDto | undefined
  isPending: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => unknown
}

function Desk({
  batchId,
  overview,
  alerts,
  note,
}: {
  batchId: string
  overview: DeskRead
  /** what the batch's administrators owe it, when the reader is one */
  alerts: AdminAlerts | null
  /** the batch's note, which stands under what needs doing */
  note: ReactNode
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const { locale } = useI18n()
  const failure = useLoadFailure()
  const zone = useBatchZone()
  const [lane, setLane] = useState<Lane>('all')
  // the desk's list fragments join in the reader's own punctuation
  const listJoin = useList()

  const perspective = lane === 'all' ? undefined : lane
  const activity = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listMyActivity.key({ params: { batchId }, query: {} }),
      { lane },
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listMyActivity({
          params: { batchId },
          query: {
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
            ...(perspective !== undefined ? { perspective } : {}),
          },
        }),
      ),
    ...cursorPages,
  })

  const rows = useMemo(
    () => activity.data?.pages.flatMap((page) => page.items) ?? [],
    [activity.data],
  )
  const groups = useMemo(() => groupByDay(rows, locale, zone), [rows, locale, zone])
  // the unread claims, marked once each: the newest row of that claim in the
  // feed carries the dot, read state stays the version pair's
  const freshRowIds = useMemo(() => {
    const unread = new Set(overview.data?.participant?.unreadEntryIds ?? [])
    const marked = new Set<string>()
    const fresh = new Set<string>()
    for (const row of rows) {
      if (row.perspective !== 'participant') continue
      if (!unread.has(row.entryId) || marked.has(row.entryId)) continue
      marked.add(row.entryId)
      fresh.add(row.id + row.kind)
    }
    return fresh
  }, [rows, overview.data])

  const desk = overview.data
  const mixed = desk !== undefined && desk.participant !== null && desk.reviewer !== null
  // somebody with a claim or a review here, or a desk still on its way:
  // they have a story of their own to follow below the rows
  const own = desk === undefined || desk.participant !== null || desk.reviewer !== null
  if (overview.isError && desk === undefined) {
    return (
      <>
        <AsyncSection
          pending={false}
          error={failure.of(overview.error)}
          framed
          retrying={overview.isFetching}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void overview.refetch()}
        >
          {null}
        </AsyncSection>
        {note}
      </>
    )
  }
  if (!own && alerts === null) {
    // somebody here with no standing on the desk reads the note and the
    // stage plan alone
    return note
  }

  const openEntry = (itemId: string, entryId: string, layer: 'detail' | 'entry') =>
    navigate('assessment/batch-my-entries', {
      params: { batchId },
      search:
        layer === 'detail' ? { open: itemId, detail: entryId } : { open: itemId, entry: entryId },
    })

  const todo: TodoRow[] = []
  for (const action of desk?.participant?.actions ?? []) {
    const sentence =
      action.kind === 'supplement'
        ? m.overview_actionSupplement({ who: action.who ?? m.activity_somebody() })
        : m.overview_actionRevision()
    todo.push({
      key: `${action.kind}:${action.entryId}`,
      lane: 'participant',
      action: action.kind,
      subject: action.itemTitle,
      detail: action.summary === null ? sentence : `${sentence}：${action.summary}`,
      at: clockOf(action.at, locale, zone),
      verb: (action.kind === 'supplement' ? m.overview_goSupplement : m.overview_goRevision)(),
      go: () =>
        openEntry(action.itemId, action.entryId, action.kind === 'supplement' ? 'detail' : 'entry'),
    })
  }
  if ((desk?.reviewer?.pendingCount ?? 0) > 0) {
    todo.push({
      key: 'review-pending',
      lane: 'reviewer',
      action: 'review-pending',
      count: desk!.reviewer!.pendingCount,
      subject: m.overview_pendingReviews({ count: desk!.reviewer!.pendingCount }),
      detail:
        desk!.reviewer!.queueGroups.length === 0
          ? null
          : listJoin(
              desk!.reviewer!.queueGroups.map((group) =>
                m.overview_queueGroup({ name: group.name, count: group.count }),
              ),
            ),
      at: null,
      verb: m.overview_goReview(),
      go: () => navigate('assessment/batch-reviews', { params: { batchId } }),
    })
  }
  if ((desk?.reviewer?.answeredAskCount ?? 0) > 0) {
    todo.push({
      key: 'review-answered',
      lane: 'reviewer',
      action: 'review-answered',
      count: desk!.reviewer!.answeredAskCount,
      subject: m.overview_askAnswered({ count: desk!.reviewer!.answeredAskCount }),
      detail:
        desk!.reviewer!.answeredAsks.length === 0
          ? null
          : listJoin(
              desk!.reviewer!.answeredAsks.map((ask) =>
                m.overview_askEntry({
                  who: ask.who ?? m.activity_somebody(),
                  item: ask.itemTitle,
                }),
              ),
            ),
      at: null,
      verb: m.overview_goAsked(),
      go: () =>
        navigate('assessment/batch-reviews', { params: { batchId }, search: { view: 'asked' } }),
    })
  }
  if (alerts !== null) {
    todo.push(
      ...adminRows(alerts, {
        listJoin,
        go: (page) => navigate(page, { params: { batchId } }),
      }),
    )
  }
  // grouped by the standing each row speaks to, each under its strip - one
  // standing as much as two: the strip is how the card reads, not a way of
  // telling two standings apart
  const laneWord = (which: DeskLane) =>
    (which === 'participant'
      ? m.overview_laneEntry
      : which === 'reviewer'
        ? m.overview_laneReview
        : m.overview_laneManage)()
  const todoGroups = DESK_LANES.map((which) => ({
    which,
    rows: todo.filter((row) => row.lane === which),
  })).filter((group) => group.rows.length > 0)
  // what waits on the reader, which a reading that failed is not
  const waiting = todo.filter(waitingOn).length

  return (
    <>
      <section data-count={waiting} {...stylex.props(styles.actions)}>
        <div {...stylex.props(styles.actionsHead)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{m.overview_actionsTitle()}</h2>
          {waiting > 0 && <span {...stylex.props(styles.actionsCount)}>{waiting}</span>}
        </div>
        {overview.isPending || alerts?.pending === true ? (
          <Skeleton className={stylex.props(styles.actionsSkeleton).className} />
        ) : todo.length === 0 ? (
          <div data-testid="overview-clear" {...stylex.props(styles.clearCard)}>
            <span {...stylex.props(styles.clearMark)}>
              <CheckIcon aria-hidden className={stylex.props(styles.clearIcon).className} />
            </span>
            <p {...stylex.props(styles.clearWord)}>{m.overview_actionsNone()}</p>
          </div>
        ) : (
          <div {...stylex.props(styles.card, styles.cardRaised)} data-testid="overview-actions">
            {todoGroups.map((group) => (
              <div key={group.which} {...stylex.props(styles.lane)}>
                {/* the standing each row speaks to, as a ruled strip inside the
                    card rather than a heading above a box of its own: two
                    standings are two parts of one desk, not two desks */}
                <div
                  {...stylex.props(styles.strip)}
                  data-testid="overview-lane"
                  data-lane={group.which}
                  data-count={group.rows.filter(waitingOn).length}
                >
                  <span {...stylex.props(styles.stripWord)}>{laneWord(group.which)}</span>
                  {group.rows.some(waitingOn) && (
                    <span {...stylex.props(styles.stripCount)}>
                      {group.rows.filter(waitingOn).length}
                    </span>
                  )}
                </div>
                <div {...stylex.props(styles.laneRows)}>
                  {group.rows.map((row) => (
                    <div
                      key={row.key}
                      data-action={row.action}
                      {...(row.count !== undefined ? { 'data-count': row.count } : {})}
                      {...(row.items !== undefined ? { 'data-items': row.items.join(' ') } : {})}
                      onClick={() => {
                        if (!row.busy) row.go()
                      }}
                      {...stylex.props(styles.todoRow)}
                    >
                      <span
                        {...stylex.props(
                          styles.todoSubject,
                          row.at === null && styles.todoTimeless,
                        )}
                      >
                        {row.subject}
                      </span>
                      {row.at !== null && <span {...stylex.props(styles.todoAt)}>{row.at}</span>}
                      {row.detail !== null && (
                        <span
                          data-part="detail"
                          {...stylex.props(
                            styles.todoDetail,
                            row.at === null && styles.todoTimeless,
                          )}
                        >
                          {row.detail}
                        </span>
                      )}
                      <span
                        {...stylex.props(
                          styles.todoVerbSeat,
                          row.detail === null && row.at === null && styles.todoVerbSeatLone,
                        )}
                      >
                        {/* the row's own door with a handle for the keyboard:
                            pressed, it goes once, not again as the row */}
                        <button
                          type="button"
                          disabled={row.busy}
                          aria-busy={row.busy || undefined}
                          onClick={(event) => {
                            event.stopPropagation()
                            row.go()
                          }}
                          {...stylex.props(styles.todoVerb, row.busy && styles.todoVerbBusy)}
                        >
                          {/* asking again is not going somewhere: it wears the
                              mark every other retry in the product wears, in
                              front of its word, and a spinner while it asks */}
                          {row.kind === 'retry' && (
                            <span aria-hidden {...stylex.props(styles.todoVerbMark)}>
                              {row.busy ? (
                                <Spinner aria-hidden />
                              ) : (
                                <RotateCwIcon
                                  className={stylex.props(styles.todoVerbIcon).className}
                                />
                              )}
                            </span>
                          )}
                          {row.verb}
                          {row.kind !== 'retry' && (
                            <ChevronRightIcon
                              aria-hidden
                              className={stylex.props(styles.todoVerbIcon).className}
                            />
                          )}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {note}

      {own && (
        <section {...stylex.props(styles.activity)}>
          <div {...stylex.props(styles.activityHead)}>
            <h2 {...stylex.props(styles.activityTitle)}>{m.overview_activityTitle()}</h2>
            {(desk?.participant?.unreadEntryIds.length ?? 0) > 0 && (
              <span
                data-testid="overview-unread"
                data-count={desk!.participant!.unreadEntryIds.length}
                {...stylex.props(styles.unreadNote)}
              >
                <UnreadDot />
                {m.overview_activityUnread({
                  count: desk!.participant!.unreadEntryIds.length,
                })}
              </span>
            )}
            <span {...stylex.props(styles.headSpacer)} />
            {mixed && (
              <Tabs
                variant="segmented"
                value={lane}
                onValueChange={(value) => setLane(value as Lane)}
              >
                <TabsList>
                  {(
                    [
                      ['all', m.overview_filterAll],
                      ['participant', m.overview_laneEntry],
                      ['reviewer', m.overview_laneReview],
                    ] as const
                  ).map(([value, label]) => (
                    <TabsTrigger key={value} value={value}>
                      {label()}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>

          {activity.isPending ? (
            <div {...stylex.props(styles.activityBones)} aria-hidden data-testid="activity-bones">
              <Skeleton className={stylex.props(styles.activityBoneDay).className} />
              {['64%', '48%', '71%'].map((width, index) => (
                <div key={index} {...stylex.props(styles.activityBoneRow)}>
                  <Skeleton className={stylex.props(styles.activityBoneMark).className} />
                  <div {...stylex.props(styles.activityBoneWords)}>
                    <Skeleton
                      className={stylex.props(styles.activityBoneLine).className}
                      width={width}
                    />
                    <Skeleton
                      className={stylex.props(styles.activityBoneLine).className}
                      width="30%"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.isError && rows.length === 0 ? (
            <AsyncSection
              pending={false}
              error={failure.of(activity.error)}
              framed
              retrying={activity.isFetching}
              loadingLabel={commonMessages.state_loading()}
              retryLabel={commonMessages.action_retry()}
              onRetry={() => void activity.refetch()}
            >
              {null}
            </AsyncSection>
          ) : rows.length === 0 ? (
            // the same card as the desk's "nothing waiting" above it
            <div data-testid="overview-activity-empty" {...stylex.props(styles.clearCard)}>
              <span {...stylex.props(styles.clearMark)}>
                <HistoryIcon aria-hidden className={stylex.props(styles.clearIcon).className} />
              </span>
              <p {...stylex.props(styles.clearWord)}>{m.overview_activityNone()}</p>
            </div>
          ) : (
            <div {...stylex.props(styles.card)} data-testid="overview-activity">
              {groups.map((group) => (
                <section key={group.key} {...stylex.props(styles.day)}>
                  <div {...stylex.props(styles.strip)}>
                    <span {...stylex.props(styles.stripWord)}>{group.label}</span>
                    {group.aside !== null && (
                      <span {...stylex.props(styles.stripAside)}>{group.aside}</span>
                    )}
                  </div>
                  {group.items.map((row) => {
                    const sentence = SAID[row.perspective][row.kind]
                    const who =
                      (row.perspective === 'reviewer' ? row.subjectName : row.actorName) ??
                      m.activity_somebody()
                    // the server already judged which rounds are still this
                    // reader's to open; everything else is a plain line
                    const openable = row.perspective === 'participant' || row.instanceId !== null
                    // Kept as parts rather than joined into a sentence: these
                    // are coordinate facts about one claim - the group, the
                    // question, the level - and a separator between them is a
                    // rule, not a comma somebody has to read past.
                    const identity = row.summary
                      .filter((part) => part.value !== '')
                      .map((part) => part.value)
                    return (
                      <button
                        key={row.id + row.kind}
                        type="button"
                        data-kind={row.kind}
                        data-perspective={row.perspective}
                        data-unread={freshRowIds.has(row.id + row.kind) || undefined}
                        onClick={() => {
                          if (!openable) return
                          if (row.perspective === 'reviewer') {
                            if (row.instanceId !== null) {
                              navigate('assessment/review-instance', {
                                params: { batchId, instanceId: row.instanceId },
                              })
                            }
                            return
                          }
                          openEntry(row.itemId, row.entryId, 'detail')
                        }}
                        {...stylex.props(styles.feedRow, openable && styles.feedRowOpenable)}
                      >
                        <span {...stylex.props(styles.feedClockWide)}>
                          {clockOf(row.at, locale, zone)}
                        </span>
                        <span {...stylex.props(styles.feedBody)}>
                          <span {...stylex.props(styles.feedTitleLine)}>
                            <span {...stylex.props(styles.feedTitleSeat)}>
                              {/* the same mark of news as on the claim's own row */}
                              {freshRowIds.has(row.id + row.kind) && (
                                <>
                                  <UnreadDot />
                                  <VisuallyHidden>{m.entry_claimUnread()}</VisuallyHidden>
                                </>
                              )}
                              <span {...stylex.props(styles.feedTitle)}>{row.itemTitle}</span>
                            </span>
                            {mixed && (
                              <span {...stylex.props(styles.feedLaneWord)}>
                                {laneWord(row.perspective)}
                              </span>
                            )}
                            <span {...stylex.props(styles.feedClockNarrow)}>
                              {clockOf(row.at, locale, zone)}
                            </span>
                          </span>
                          {identity.length > 0 && (
                            <span {...stylex.props(styles.feedIdentity)}>
                              {identity.map((part, at) => (
                                <span key={part + String(at)} {...stylex.props(styles.crumb)}>
                                  {at > 0 && (
                                    <span aria-hidden {...stylex.props(styles.crumbRule)} />
                                  )}
                                  {part}
                                </span>
                              ))}
                            </span>
                          )}
                          <span {...stylex.props(styles.feedSentence)}>
                            {sentence !== undefined && (sentence as Message)({ who })}
                          </span>
                          {(row.reason !== null || row.comment !== null) && (
                            <span {...stylex.props(styles.feedQuote)}>
                              {row.reason !== null && <span>{row.reason}</span>}
                              {row.comment !== null && (
                                <span {...stylex.props(styles.feedComment)}>{row.comment}</span>
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {activity.hasNextPage && (
                <button
                  type="button"
                  disabled={activity.isFetchingNextPage}
                  onClick={() => void activity.fetchNextPage()}
                  {...stylex.props(styles.moreRow)}
                >
                  {m.overview_activityMore()}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}

/**
 * The administrator's rows, one per thing that stops the round and that
 * only an administrator can mend, in the order they stop it: review that
 * cannot go on, filings that cannot start, appeals that cannot be heard, a
 * roster the organization has moved away from, appointments the batch has
 * yet to take. Each goes to the page that mends it.
 */
function adminRows(
  alerts: AdminAlerts,
  {
    listJoin,
    go,
  }: {
    listJoin: (items: readonly string[]) => string
    go: (
      page: 'assessment/batch-access' | 'assessment/batch-items' | 'assessment/batch-results',
    ) => void
  },
): TodoRow[] {
  const rows: TodoRow[] = []
  const row = (over: Omit<TodoRow, 'lane' | 'at'>) =>
    rows.push({ lane: 'manage', at: null, ...over })
  if (alerts.failed) {
    row({
      key: 'admin-unreadable',
      action: 'admin-unreadable',
      kind: 'retry',
      busy: alerts.retrying,
      subject: m.overview_adminFailed(),
      detail: null,
      verb: commonMessages.action_retry(),
      go: alerts.retry,
    })
  }
  const gaps = alerts.gaps
  if (gaps.length > 0) {
    const waiting = gaps.reduce((total, one) => total + one.waiting, 0)
    const units = new Set(gaps.map((one) => one.nodeId ?? '')).size
    const named = gaps.slice(0, MOST_NAMED).map((one) =>
      m.overview_adminGapUnit({
        unit: one.nodeName ?? m.items_stuckNowhere(),
        roles: listJoin(one.roleNames),
      }),
    )
    row({
      key: 'admin-review-gap',
      action: 'admin-review-gap',
      count: waiting,
      subject: m.items_stuckSummary({ waiting, units }),
      detail:
        gaps.length > MOST_NAMED
          ? m.overview_adminMoreUnits({ total: gaps.length, items: listJoin(named) })
          : listJoin(named),
      verb: m.items_stuckAppoint(),
      go: () => go('assessment/batch-access'),
    })
  }
  // The two routes are two different troubles and each is said on its own:
  // somebody an ordinary route misses cannot file into that question at
  // all, somebody an escalation route misses can file and be judged, and
  // only cannot appeal. A question may stand in both.
  const { cannotSubmit, cannotAppeal, submitItems, appealItems } = alerts.unreachable
  // past three named, how many comes first, where a line cut short keeps it
  const named = (questions: readonly AlertedQuestion[], stopped: 'submit' | 'appeal') => {
    const items = listJoin(questions.slice(0, MOST_NAMED).map((one) => one.title))
    const total = questions.length
    if (stopped === 'submit') {
      return total > MOST_NAMED
        ? m.overview_adminCannotSubmitMany({ items, total })
        : m.overview_adminCannotSubmit({ items })
    }
    return total > MOST_NAMED
      ? m.overview_adminCannotAppealMany({ items, total })
      : m.overview_adminCannotAppeal({ items })
  }
  if (cannotSubmit > 0) {
    row({
      key: 'admin-unreachable',
      action: 'admin-unreachable',
      count: cannotSubmit,
      items: submitItems.map((one) => one.id),
      subject: m.overview_adminUnreachable({ count: cannotSubmit }),
      detail: named(submitItems, 'submit'),
      verb: m.overview_goItems(),
      go: () => go('assessment/batch-items'),
    })
  }
  if (cannotAppeal > 0) {
    row({
      key: 'admin-unappealable',
      action: 'admin-unappealable',
      count: cannotAppeal,
      items: appealItems.map((one) => one.id),
      subject: m.overview_adminUnreachableAppeal({ count: cannotAppeal }),
      detail: named(appealItems, 'appeal'),
      verb: m.overview_goItems(),
      go: () => go('assessment/batch-items'),
    })
  }
  const { changed, unavailable } = alerts.placements
  if (changed > 0 || unavailable > 0) {
    row({
      key: 'admin-placements',
      action: 'admin-placements',
      count: changed > 0 ? changed : unavailable,
      subject:
        changed > 0
          ? m.placement_prompt({ count: changed })
          : m.placement_unavailablePrompt({ count: unavailable }),
      detail:
        changed > 0 && unavailable > 0
          ? m.overview_adminPlacementsGone({ count: unavailable })
          : null,
      verb: m.overview_goRoster(),
      go: () => go('assessment/batch-results'),
    })
  }
  if (alerts.accessPending > 0) {
    row({
      key: 'admin-access',
      action: 'admin-access',
      count: alerts.accessPending,
      subject: m.overview_adminAccess({ count: alerts.accessPending }),
      detail: null,
      verb: m.overview_goAccess(),
      go: () => go('assessment/batch-access'),
    })
  }
  return rows
}

/** how many units or questions a row names before it says how many more */
const MOST_NAMED = 3

const clockOf = (iso: string, locale: string, zone: string | undefined) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...inZone(zone) }).format(
    new Date(iso),
  )

/** the feed's days are the batch's days (`zone`), not the reader's */
function groupByDay(
  rows: readonly ActivityItem[],
  locale: string,
  zone: string | undefined,
): readonly { key: string; label: string; aside: string | null; items: ActivityItem[] }[] {
  const now = Date.now()
  /**
   * Which day a row belongs to, said the way a person says it.
   *
   * `9/1` was the wrong answer twice over: it is the shape of a clock time,
   * which is what every row under it already carries, and a bare pair of
   * numbers is not how anybody names a day out loud. So the date is spelled
   * (`9月1日`, `September 1`) and the weekday rides beside it in a quieter
   * tone - reading a feed, which weekday something happened on is most of
   * what "when" means. Today and yesterday keep their words and take the
   * date as the quiet half instead, because those two are the days a reader
   * does not have to work out.
   */
  const dayOf = (iso: string) => {
    const at = new Date(iso)
    const diff = calendarDaysBetween(at.getTime(), now, zone)
    const spelled = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      ...(yearOf(at.getTime(), zone) === yearOf(now, zone) ? {} : { year: 'numeric' }),
      ...inZone(zone),
    }).format(at)
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', ...inZone(zone) }).format(
      at,
    )
    if (diff === 0) return { key: 'today', label: m.overview_today(), aside: spelled }
    if (diff === 1) return { key: 'yesterday', label: m.overview_yesterday(), aside: spelled }
    return { key: spelled, label: spelled, aside: weekday }
  }
  const groups: { key: string; label: string; aside: string | null; items: ActivityItem[] }[] = []
  for (const row of rows) {
    const day = dayOf(row.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === day.key) last.items.push(row)
    else groups.push({ ...day, items: [row] })
  }
  return groups
}
