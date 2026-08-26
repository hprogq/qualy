import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Portal } from '@qualy/ui/portal'
import { Resizing } from '@qualy/ui/reveal'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { BatchDto } from '../phase/model.ts'

// What every section of a batch needs and none of them should fetch twice:
// the batch itself.
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
  fillColumn: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
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
  draftNote: {
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

const BannerSlot = createContext<HTMLElement | null>(null)

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
  banner,
  children,
}: {
  /** which of the batch's pages this is; the bar above says which batch */
  title: string
  description?: string
  /** what the section says about itself beside its name, at a glance */
  actions?: ReactNode
  size?: 'default' | 'wide' | 'full'
  /**
   * `none` drops the band and the page gutters: the section owns the whole
   * content area and draws its own edges. For a workbench that fills the
   * screen, where a heading band would only push the work down.
   */
  chrome?: 'band' | 'none'
  /**
   * Which heading the band is showing. A section that opens one of its own
   * rows hands the band to it and says so here; anything it hands over is
   * expected to keep the band's own shape, so the swap moves nothing.
   */
  banner?: 'section' | 'open'
  /** rendered once the batch is loaded, because a section without one is blank */
  children: (batch: BatchDto) => ReactNode
}) {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  // the section's own name is what shows unless it says otherwise
  const showing = banner ?? 'section'

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    // a section is a route away, not a reload: what changes the batch
    // invalidates this key explicitly and is not waiting on the clock
    staleTime: 30_000,
  })
  const batch = detail.data?.batch

  if (chrome === 'none') {
    return (
      <AsyncSection
        pending={detail.isPending}
        error={detail.isError ? formatError(detail.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void detail.refetch()}
        xstyle={styles.fillColumn}
      >
        {batch && children(batch)}
      </AsyncSection>
    )
  }

  return (
    <BannerSlot.Provider value={slot}>
      {/* Edge to edge, cutting the content area in two: a band inset inside
          the page's own width is a card pretending to be a header, and it
          reads as one more box among the boxes below it. */}
      <div {...stylex.props(styles.band)}>
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
            <div {...stylex.props(styles.bannerSeat)}>
              <div
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
                {...stylex.props(showing === 'section' ? styles.bannerParked : styles.bannerShown)}
              />
            </div>
          </Resizing>
        </PageContainer>
      </div>
      <PageContainer size={size} xstyle={styles.bodyColumn}>
        <AsyncSection
          pending={detail.isPending}
          error={detail.isError ? formatError(detail.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void detail.refetch()}
          xstyle={styles.fillFlex}
        >
          {batch && (
            <div {...stylex.props(styles.sectionStack)}>
              {batch.status === 'draft' && (
                <p {...stylex.props(styles.draftNote)}>{format(m.draftBanner)}</p>
              )}
              {children(batch)}
            </div>
          )}
        </AsyncSection>
      </PageContainer>
    </BannerSlot.Provider>
  )
}
