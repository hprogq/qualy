import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react'
import {
  PageLink,
  useApiQuery,
  usePageRouteParams,
  usePublishWorkspaceCapabilities,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchFlow } from './BatchFlow.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import { BatchSwitcher } from './BatchSwitcher.tsx'

/** where the band stops being one line and becomes the window's own head */
const HEAD_BREAKPOINT = 768

const styles = stylex.create({
  // Three measured columns from a tablet up; on a phone two rows, because
  // there the band is the window's own head and has the head's work to do -
  // the way back, what is open and the account across the top, where the
  // stage and its clock cannot also fit without one of them being cut.
  bar: {
    display: {
      default: 'grid',
      [breakpoints.phone]: 'flex',
    },
    flexDirection: {
      default: null,
      [breakpoints.phone]: 'column',
    },
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: '1fr auto 1fr',
      [breakpoints.desktop]: '1fr auto 1fr',
    },
    minWidth: 0,
    alignItems: {
      default: 'center',
      [breakpoints.phone]: 'stretch',
    },
    gap: {
      default: 12,
      [breakpoints.phone]: 0,
    },
  },
  // On a desk the three columns are the bar's own, so this wrapper is not
  // there at all; on a phone it is the first row, and it keeps the head's
  // height whether or not the name has arrived.
  head: {
    display: {
      default: 'contents',
      [breakpoints.phone]: 'flex',
    },
    backgroundColor: { default: null, [breakpoints.phone]: tokens.surface },
    // the corner the shell keeps for the account, which stands over this row
    // rather than in it so the rule below can reach both edges of the screen
    paddingInlineEnd: { default: null, [breakpoints.phone]: 56 },
    minHeight: {
      default: null,
      [breakpoints.phone]: 44,
    },
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    paddingInline: {
      default: null,
      [breakpoints.phone]: 16,
    },
  },
  start: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
  },
  backButton: {
    marginLeft: -4,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  // the door reads as one on a desk and as a way back on a phone, where a
  // head has no room for words beside a name this long; it keeps its name
  // for whoever is listening rather than looking
  backWord: {
    display: {
      default: 'inline',
      [breakpoints.phone]: 'none',
    },
  },
  // The switch: centred between the two doors on a desk, and hard left on a
  // phone where the left door is gone. Its ceiling is generous - these are
  // names somebody chose, and cutting one early to protect space nothing
  // else is using was the wrong trade - and short of the width where the bar
  // becomes a title bar. The sides keep their own content whatever happens,
  // so a longer name is cut here rather than pushing the countdown off the
  // end.
  middle: {
    display: 'flex',
    minWidth: 0,
    // On a phone the head is the name's row and nothing else competes for
    // it, so the ceiling only has to keep the account's corner clear - which
    // the row's own end already does.
    maxWidth: {
      default: 'min(70vw, 40rem)',
      [breakpoints.phone]: 'none',
    },
    flexGrow: {
      default: 0,
      [breakpoints.phone]: 1,
    },
    flexShrink: {
      default: 0,
      [breakpoints.phone]: 1,
    },
    flexBasis: {
      default: 'auto',
      [breakpoints.phone]: '0%',
    },
    justifyContent: {
      default: 'center',
      [breakpoints.phone]: 'flex-start',
    },
  },
  nameSkeleton: {
    height: 24,
    width: 224,
  },
  // never shrunk and never clipped: the clock is short by design, and a
  // column that gave way would hand its own text to the name beside it.
  // On a phone it is the second row, ruled off from the head above it and
  // reading from the same margin as every other line of the page.
  tail: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: {
      default: 'flex-end',
      [breakpoints.phone]: 'space-between',
    },
    gap: 8,
    borderTopWidth: { default: null, [breakpoints.phone]: 1 },
    borderTopStyle: { default: null, [breakpoints.phone]: 'solid' },
    borderTopColor: { default: null, [breakpoints.phone]: tokens.divider },
    // the ground the page below keeps, so the strip reads as the top of the
    // work rather than as a third bar of chrome
    backgroundColor: { default: null, [breakpoints.phone]: tokens.background },
    paddingInline: { default: null, [breakpoints.phone]: 16 },
    paddingBlock: { default: null, [breakpoints.phone]: 7 },
  },
  progressText: {
    // one size across the strip: the stage and its clock are one line, and
    // a name a pixel larger than the time beside it reads as a heading
    fontSize: { default: 14, [breakpoints.phone]: 13 },
    minWidth: 0,
    flexShrink: 1,
  },
  // the label's own end, not the control's: a ghost button's inset would
  // leave the word short of the margin every other line on the strip keeps
  flowButton: {
    marginInlineEnd: -12,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  flowPanel: {
    maxWidth: { default: null, [breakpoints.tablet]: '24rem', [breakpoints.desktop]: '24rem' },
  },
  flowBody: {
    minHeight: 0,
    flexGrow: 1,
    overflowY: 'auto',
    paddingInline: 16,
    paddingBottom: 16,
  },
})

// Which batch is open and where it stands.
//
// The shell renders this above the rail without knowing what a batch is, and
// this renders without knowing what the shell put around it: it reads the
// batch from the route it was mounted at, the same way the pages beside it
// do. What may happen to the batch as a whole is not here - archiving and
// deleting ask twice and happen once, and a row of them across the top of
// every section made each section look like the smaller subject.
export default function BatchContextBar() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const head = useIsBelow(HEAD_BREAKPOINT)
  const [flowOpen, setFlowOpen] = useState(false)

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const batch = detail.data?.batch
  // the workspace speaks for itself: who this reader is in the open batch,
  // straight from the server's projection, withdrawn while a batch loads so
  // gated rail entries never flash before the answer arrives
  usePublishWorkspaceCapabilities(
    batch === undefined
      ? null
      : new Set(
          [
            batch.capabilities.personal && 'assessment/personal',
            batch.capabilities.review && 'assessment/review',
            batch.capabilities.record && 'assessment/record',
            batch.capabilities.manage && 'assessment/manage',
          ].filter((token): token is string => token !== false),
        ),
  )
  // the derived timeline, which is where "the stage ends when the next one
  // starts" is already worked out; the bar only counts the clock down to it
  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })

  return (
    <div {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.head)}>
        <div data-bar-start {...stylex.props(styles.start)}>
          {/* A named destination on a desk, where there is room to say where
              the door leads; a phone head has room for the arrow alone, and
              the name goes to whoever is listening instead of looking. */}
          <Button
            size="sm"
            variant="ghost"
            className={stylex.props(styles.backButton).className}
            asChild
          >
            <PageLink page="assessment/batches" aria-label={format(m.backToList)}>
              <ArrowLeftIcon />
              <span {...stylex.props(styles.backWord)}>{format(m.backToList)}</span>
            </PageLink>
          </Button>
        </div>

        <div {...stylex.props(styles.middle)}>
          {batch === undefined ? (
            <Skeleton className={stylex.props(styles.nameSkeleton).className} />
          ) : (
            <BatchSwitcher
              batchId={batchId}
              name={batch.name}
              status={batch.status}
              currentPhaseId={batch.currentPhaseId}
            />
          )}
        </div>
      </div>

      <div {...stylex.props(styles.tail)}>
        {batch !== undefined && (
          <BatchProgress
            showStage
            single={head}
            flat={head}
            timeline={plan.data?.timeline ?? []}
            xstyle={styles.progressText}
          />
        )}
        {/* the whole plan, one press away rather than repeated above every
            section: a reader who wants it asks for it */}
        {head && batch !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className={stylex.props(styles.flowButton).className}
            onClick={() => setFlowOpen(true)}
          >
            {format(m.fullFlow)}
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </div>

      <Sheet open={flowOpen} onOpenChange={setFlowOpen}>
        <SheetContent side="bottom" xstyle={styles.flowPanel}>
          <SheetHeader>
            <SheetTitle>{format(m.flowTitle)}</SheetTitle>
          </SheetHeader>
          <div {...stylex.props(styles.flowBody)}>
            <BatchFlow timeline={plan.data?.timeline ?? []} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
