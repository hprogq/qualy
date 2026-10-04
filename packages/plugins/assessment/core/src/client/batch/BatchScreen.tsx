import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadFailure, isRecordId, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'

import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Portal } from '@qualy/ui/portal'
import { Resizing, Reveal } from '@qualy/ui/reveal'
import { assessmentApi } from '../api.ts'

import type { BatchDto } from '../phase/model.ts'
import { BatchZone, ZoneAwayNotice } from './BatchZone.tsx'
import { holdsStanding, useBatchAbsence, type BatchStanding } from './absence.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// What every section of a batch needs and none of them should fetch twice:
// the batch itself, and the clock its times are read on.
//
// Which batch this is, where it stands and what can be done to it as a whole
// are not here - they are in the bar above the rail, said once for the whole
// workspace instead of again at the top of every section.
//
// The band at the top is one place, not one heading. A section that opens
// one of its own rows hands that row's name, standing and actions to the same
// band through `BatchBanner`, and the two crossfade where they stand: the
// heading never moves, so nothing below it has to move out of the way, and
// the reader watches one thing become another rather than a page being
// replaced.

const styles = stylex.create({
  // At a desk a section is a workbench that scrolls inside itself, so the
  // column is held to the room it is given. On a phone the section is part
  // of the page and the shell's own scroller moves it: held to that room, it
  // spilled past its own end instead of growing, and the scroller's room for
  // the bar at the foot (padding) came after the column, not after what
  // spilled - the last row of a long list stayed under the bar. So on a
  // phone the column grows with what it holds, and still fills a short page.
  fillColumn: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: { default: 1, [breakpoints.phone]: 0 },
    flexBasis: { default: '0%', [breakpoints.phone]: 'auto' },
    flexDirection: 'column',
  },
  boundedColumn: {
    flexShrink: 1,
    flexBasis: '0%',
  },
  band: {
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
  },
  // hairlines in one direction, widely spaced, gathered at the far corner
  // and gone by the time they reach the words: only depth, never texture
  hairlines: {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    opacity: 0.06,
    backgroundImage: 'repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 24px)',
    maskImage: 'radial-gradient(130% 115% at 100% 0%, black, transparent 62%)',
  },
  bandInset: {
    position: 'relative',
    paddingBlock: 24,
  },
  bannerSeat: {
    position: 'relative',
  },
  bannerShown: {
    opacity: 1,
    transitionProperty: 'opacity',
    transitionDuration: '200ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  bannerParked: {
    pointerEvents: 'none',
    position: 'absolute',
    insetInline: 0,
    top: 0,
    opacity: 0,
  },
  bodyColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  fillFlex: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  sectionStack: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
  },
  // No band: the section says its own name in a line of its own and takes
  // the whole content area, edge to edge, from the top. What the band's
  // body would have said about the round - a draft, another clock - still
  // stands above it, inset the way the section insets its own first line.
  bareColumn: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    // as fillColumn, and for the same reason
    flexShrink: { default: 1, [breakpoints.phone]: 0 },
    flexBasis: { default: '0%', [breakpoints.phone]: 'auto' },
    flexDirection: 'column',
  },
  bareNote: {
    marginInline: { default: 24, [breakpoints.phone]: 16 },
    marginTop: { default: 16, [breakpoints.phone]: 12 },
  },
  draftNote: {
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  // a screen of the batch that is not for this reader: the answer in the
  // room the screen would have had, a little above the middle
  notYours: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingBottom: '8vh',
  },
})

const BannerSlot = createContext<HTMLElement | null>(null)

/** what a reader is told on a screen of the batch that is for somebody else */
const DENIED = {
  personal: m.batch_deniedPersonal,
  review: m.batch_deniedReview,
  manage: m.batch_deniedManage,
  results: m.batch_deniedResults,
} as const satisfies Record<BatchStanding, unknown>

/**
 * The screen's entrance, or the same box without one: decided once, when
 * it mounts, so nothing under it is mounted again when that changes.
 */
function Arrival({
  play,
  className,
  children,
}: {
  play: boolean
  className: string | undefined
  children: ReactNode
}) {
  const [entering] = useState(play)
  return entering ? (
    <Reveal className={className}>{children}</Reveal>
  ) : (
    <div data-arrival="still" className={className}>
      {children}
    </div>
  )
}

/**
 * What the band says while something inside the section is open.
 *
 * Rendered from wherever the open thing lives, because its title and its
 * save button are that component's own state; lifting them out to name the
 * band would put half an editor in its parent.
 */
export function BatchBanner({ children }: { children: ReactNode }) {
  const slot = useContext(BannerSlot)
  return <Portal into={slot}>{children}</Portal>
}

export function BatchScreen({
  title,
  description,
  actions,
  size = 'default',
  chrome = 'band',
  fill = false,
  banner,
  notes,
  requires,
  children,
}: {
  /** which of the batch's pages this is; the bar above says which batch */
  title: string
  /** what the section says about itself under its name: a line of words, or a line of facts */
  description?: ReactNode
  /** what the section says about itself beside its name, at a glance */
  actions?: ReactNode
  size?: 'default' | 'wide' | 'full'
  /**
   * `none` drops the band and the page gutters: the section owns the whole
   * content area and draws its own edges. For a workbench that fills the
   * screen, where a heading band would only push the work down. `bare` is
   * the same room for a section that says its own name in a line of its
   * own, with what the band's body says about the round - a draft, another
   * clock - kept above it.
   */
  chrome?: 'band' | 'none' | 'bare'
  /** Keep an internally scrolling workbench within the shell's available height. */
  fill?: boolean
  /**
   * Which heading the band is showing. A section that opens one of its own
   * rows hands the band to it and says so here; anything it hands over is
   * expected to keep the band's own shape, so the swap moves nothing.
   */
  banner?: 'section' | 'open'
  /**
   * Whether what the band's body says about the round - a draft, another
   * clock - stands above the section. By default it follows the band. A
   * section whose address already names something inside it says so here,
   * so the notes are not drawn over its outline and then taken away from
   * under the thing when it arrives.
   */
  notes?: boolean
  /**
   * Who in the batch this screen is for, when not everybody who can open
   * the batch: anybody else is told so here, with the way to the overview,
   * rather than meeting whatever the screen's own reads refuse them with.
   */
  requires?: BatchStanding
  /** rendered once the batch is loaded, because a section without one is blank */
  children: (batch: BatchDto) => ReactNode
}) {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)

  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  // the section's own name is what shows unless it says otherwise
  const showing = banner ?? 'section'
  const noting = notes ?? showing === 'section'

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    // a section is a route away, not a reload: what changes the batch
    // invalidates this key explicitly and is not waiting on the clock
    staleTime: 30_000,
    // an address that cannot name a batch is not asked about
    enabled: isRecordId(batchId),
  })
  const batch = detail.data?.batch
  const absent = useBatchAbsence(batchId, detail)
  // Whether this screen has shown its batch yet. A screen that moves
  // between a bare section and one that draws its own edges - a list and
  // the person opened from it - is moving inside itself, and makes its
  // entrance once rather than again under the move it is already making.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (batch !== undefined && !shown) setShown(true)
  }, [batch, shown])

  // No batch to be a screen of. Inside the workspace shell the bar above
  // has already said so and the shell has folded this screen away; this is
  // what stands where no shell folds for it. No band either way: a heading
  // naming a section of nothing is a heading that is not true.
  if (absent !== null) {
    return (
      <LoadFailure
        failure={absent}
        back={{ page: 'assessment/batches', label: m.batch_goneBack() }}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    )
  }
  if (
    batch !== undefined &&
    requires !== undefined &&
    !holdsStanding(batch.capabilities, requires)
  ) {
    return (
      <div
        data-testid="batch-standing-missing"
        data-requires={requires}
        {...stylex.props(styles.notYours)}
      >
        <LoadFailure
          size="section"
          failure={{
            kind: 'denied',
            title: DENIED[requires](),
            description: m.batch_deniedHint(),
            retryable: false,
          }}
          back={{ page: 'assessment/batch', params: { batchId }, label: m.batch_deniedBack() }}
        />
      </div>
    )
  }

  if (chrome === 'bare') {
    return (
      <AsyncSection
        pending={detail.isPending}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void detail.refetch()}
        xstyle={styles.fillColumn}
      >
        {batch && (
          <Arrival play={!shown} className={stylex.props(styles.bareColumn).className}>
            {batch.status === 'draft' && (
              <p {...stylex.props(styles.draftNote, styles.bareNote)}>{m.batch_draftBanner()}</p>
            )}
            <BatchZone zone={batch.timezone}>
              <ZoneAwayNotice xstyle={styles.bareNote} />
              {children(batch)}
            </BatchZone>
          </Arrival>
        )}
      </AsyncSection>
    )
  }

  if (chrome === 'none') {
    return (
      <AsyncSection
        pending={detail.isPending}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void detail.refetch()}
        xstyle={[styles.fillColumn, fill && styles.boundedColumn]}
      >
        {batch && <BatchZone zone={batch.timezone}>{children(batch)}</BatchZone>}
      </AsyncSection>
    )
  }

  return (
    <BannerSlot.Provider value={slot}>
      {/* Edge to edge, cutting the content area in two: a band inset inside
          the page's own width is a card pretending to be a header, and it
          reads as one more box among the boxes below it. */}
      <div data-testid="batch-band" data-banner={showing} {...stylex.props(styles.band)}>
        {/* Hairlines in one direction, widely spaced, gathered at the far
            corner and gone by the time they reach the words: crossed the
            other way they read as graph paper, and evenly spread they read
            as a texture somebody chose. Here it is only depth. */}
        <div aria-hidden {...stylex.props(styles.hairlines)} />
        {/* Two headings changing places where they stand. Whatever takes the
            band over is built to the same shape as the section's own
            heading, so the swap moves nothing; Resizing is the fallback for
            a heading that genuinely outgrows it, which is copy wrapping on a
            narrow window rather than anything the swap itself does.

            Only the heading being left behind fades. Handing the band over,
            that reads as a crossfade, because the one arriving renders in
            the same breath. Taking it back, the one leaving is already gone
            - the screen it belonged to left with it - so a fade in would be
            a fade up from nothing, which is the band blinking. */}
        <PageContainer size={size} xstyle={styles.bandInset}>
          <Resizing>
            {/* The heading parked out of sight is out of reach too: not a
                second heading to a screen reader, and no key in it to tab
                to that nobody can see. */}
            <div {...stylex.props(styles.bannerSeat)}>
              <div
                aria-hidden={showing !== 'section' || undefined}
                inert={showing !== 'section'}
                {...stylex.props(showing === 'section' ? styles.bannerShown : styles.bannerParked)}
              >
                <PageHeader
                  title={title}
                  description={description}
                  actions={actions}
                  variant="banner"
                />
              </div>
              <div
                ref={setSlot}
                aria-hidden={showing === 'section' || undefined}
                inert={showing === 'section'}
                {...stylex.props(showing === 'section' ? styles.bannerParked : styles.bannerShown)}
              />
            </div>
          </Resizing>
        </PageContainer>
      </div>
      <PageContainer size={size} xstyle={styles.bodyColumn}>
        <AsyncSection
          pending={detail.isPending}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void detail.refetch()}
          xstyle={styles.fillFlex}
        >
          {batch && (
            /* One arrival for every section of a batch, said once here.
               Moving between sections is lateral - the same batch, read
               another way - so only the body travels, and it travels a
               little: the band above says which batch this is and must not
               twitch each time somebody looks at another part of it.
               Mount-only, so a section that draws its own movement inside
               (a row opening, a claim stepped to) is not animated twice. */
            <Reveal className={stylex.props(styles.sectionStack).className}>
              {/* said on the section, not over a question being composed:
                  the band has handed over, and the body is the question's */}
              {batch.status === 'draft' && noting && (
                <p {...stylex.props(styles.draftNote)}>{m.batch_draftBanner()}</p>
              )}
              <BatchZone zone={batch.timezone}>
                {/* only to a reader whose device keeps another zone: every
                    time below is read on the batch's clock, not theirs */}
                {noting && <ZoneAwayNotice />}
                {children(batch)}
              </BatchZone>
            </Reveal>
          )}
        </AsyncSection>
      </PageContainer>
    </BannerSlot.Provider>
  )
}
