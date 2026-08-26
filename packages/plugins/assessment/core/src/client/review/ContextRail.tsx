import { memo, useMemo } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { Kbd } from '@qualy/ui/kbd'
import { assessmentMessages as m } from '../i18n.ts'
import { entryStatusMessage, trimAmount, type EntryDto } from '../entry/model.ts'
import { summaryOf, type ReviewDto } from './model.ts'
import { useFinePointer } from './pointer.ts'
import { Pane } from './Pane.tsx'

/** what stands beside the filing: the terms it is judged under */
export const ContextRail = memo(function ContextRail({
  review,
  onOpenSibling,
}: {
  review: ReviewDto
  onOpenSibling: (entryId: string) => void
}) {
  return (
    <Pane
      as="aside"
      part="about"
      // a pager face is a whole page, so it keeps the page's white; only
      // the desk needs the border to mark where the reference column starts
      className="lg:border-l"
      inner="gap-4 p-4 lg:p-5"
    >
      <AboutParts review={review} onOpenSibling={onOpenSibling} />
    </Pane>
  )
})

/**
 * The terms this filing is judged under: what the clause says, whose hands
 * it passes through, what it is worth, and what else the same person filed
 * against the same question.
 *
 * Its own component because it is read in two shapes. Wide enough for three
 * columns it is the third; under that it is a layer the header pushes out,
 * and stacked it is the last section of the page. One rendering either way:
 * a reviewer comparing what they were told at two window widths must not be
 * comparing two different screens.
 */
function AboutParts({
  review,
  onOpenSibling,
}: {
  review: ReviewDto
  onOpenSibling: (entryId: string) => void
}) {
  const { format, locale } = useI18n()
  const fine = useFinePointer()
  const listed = useMemo(
    () => new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }),
    [locale],
  )
  const context = review.context
  // Blocks under hairlines rather than four bordered cards: at 19rem a card's
  // border and padding cost more width than they buy, and boxing every peer
  // makes four parts of one question read as four unrelated panels. The
  // clause keeps a filled card, because it is quoted matter rather than this
  // screen's own words.
  return (
    <>
      {/* the clause. Reserved, not written: nothing in the round carries the
          wording yet, so the block holds its place. */}
      <section className="flex shrink-0 flex-col gap-2 rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {format(m.myEntriesBasis)}
        </p>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          {format(m.myEntriesBasisSoon)}
        </p>
      </section>

      <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {format(m.reviewChainTitle)}
        </p>
        <Route
          stages={review.chain.normal}
          here={review.chain.route === 'normal' ? review.chain.stageId : null}
          title={review.chain.escalation.length > 0 ? format(m.reviewRouteNormal) : null}
          listed={listed}
        />
        {review.chain.escalation.length > 0 && (
          <Route
            stages={review.chain.escalation}
            here={review.chain.route === 'escalation' ? review.chain.stageId : null}
            title={format(m.reviewRouteEscalation)}
            listed={listed}
          />
        )}
      </section>

      {context !== null && (
        <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {format(m.reviewAboutTitle)}
          </p>
          {context.worth.each !== null && (
            <AboutRow label={format(m.reviewAboutEach)} value={trimAmount(context.worth.each)} />
          )}
          {context.worth.maxEntries !== null && (
            <AboutRow label={format(m.reviewAboutMax)} value={String(context.worth.maxEntries)} />
          )}
          {context.worth.groupCap !== null && (
            <AboutRow
              // the group by name when there is one: "所属分组上限" makes a
              // reader work out which group, and the answer is on screen
              label={
                context.worth.groupName === null
                  ? format(m.reviewAboutGroupCap)
                  : format(m.reviewAboutGroupCapNamed, { group: context.worth.groupName })
              }
              value={trimAmount(context.worth.groupCap)}
            />
          )}
        </section>
      )}

      {context !== null && context.siblings.length > 0 && (
        <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
          <div className="flex items-baseline gap-2">
            <p className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {format(m.reviewSiblingsTitle)}
            </p>
            <span className="flex-1" />
            {/* the keys, once, over the list they open - rather than the
                count, which the list itself already shows */}
            {fine && (
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {format(m.reviewSiblingsKeys, {
                  count: Math.min(context.siblings.length, 9),
                })}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-0.5">
            {context.siblings.map((sibling, index) => (
              <li key={sibling.entryId}>
                {/* every claim opens: reading one against another is how a
                    duplicate is caught, and the aside is where they meet */}
                <button
                  type="button"
                  onClick={() => onOpenSibling(sibling.entryId)}
                  className="-mx-1.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      sibling.current
                        ? 'bg-foreground'
                        : sibling.status === 'rejected' || sibling.status === 'needs_revision'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground/40',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      sibling.current ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {sibling.current && (
                      <span className="pr-1.5 text-muted-foreground">
                        {format(m.reviewSiblingThis)}
                      </span>
                    )}
                    {summaryOf(sibling.values) === ''
                      ? review.itemTitle
                      : summaryOf(sibling.values)}
                  </span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    {format(
                      entryStatusMessage[sibling.status as EntryDto['status']] ?? m.eventOther,
                    )}
                  </span>
                  {fine && index < 9 && <Kbd className="shrink-0">{`⌥${index + 1}`}</Kbd>}
                </button>
              </li>
            ))}
          </ul>
          {context.worth.maxEntries !== null &&
            context.siblings.length >= context.worth.maxEntries && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.reviewSiblingsFull)}
              </p>
            )}
        </section>
      )}
    </>
  )
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    // A leader rules the gap so the eye carries from a short name to a value
    // three rows down, which is what a column of unequal names needs. It
    // wraps rather than squeezing the name: a truncated "材料时间范围" names
    // nothing, and the range is long enough to want the width.
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
      <span className="ml-auto shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/** one route, in order, with the step this round is standing at marked */
function Route({
  title,
  stages,
  here,
  listed,
}: {
  /** named only when there are two routes to tell apart */
  title: string | null
  stages: ReviewDto['chain']['normal']
  here: string | null
  listed: Intl.ListFormat
}) {
  const { format } = useI18n()
  const at = stages.findIndex((stage) => stage.id === here)
  return (
    <div className="flex flex-col gap-1.5">
      {/* the route's name is part of the map, not another caption: the
          caption above says what the block is, this says which road */}
      {title !== null && <p className="text-sm font-medium">{title}</p>}
      <ol className="flex flex-col gap-1.5">
        {stages.map((stage, index) => {
          const current = stage.id === here
          // behind the step this round stands at, so it has been through
          const passed = at !== -1 && index < at
          return (
            <li key={stage.id} className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums',
                  current
                    ? 'border-foreground bg-foreground text-background'
                    : passed
                      ? 'border-transparent bg-muted text-foreground'
                      : 'border-border text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-baseline gap-2">
                  {/* the administrator's name for the step where one exists;
                      the unit-and-roles composite only as the fallback */}
                  <span className={cn('min-w-0 truncate text-sm', current && 'font-medium')}>
                    {stage.nodeName === null
                      ? format(
                          stage.skipped === 'no-holder'
                            ? m.reviewStageNoHolder
                            : m.reviewStageSkipped,
                        )
                      : (stage.label ?? `${stage.nodeName}／${listed.format(stage.roleNames)}`)}
                  </span>
                  <span className="flex-1" />
                  {/* what happened at this step, where the eye already is:
                      a step with nothing beside it is one still ahead */}
                  {(current || passed) && (
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                      {format(
                        current
                          ? m.reviewStageHere
                          : stage.skipped === 'reviewer-conflict'
                            ? m.reviewStageStepped
                            : m.reviewStagePassed,
                      )}
                    </span>
                  )}
                </div>
                {stage.nodeName !== null && stage.reviewers !== null && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {stage.reviewers.length === 0
                      ? format(m.reviewStageNobody)
                      : format(m.reviewStageReviewers, { who: listed.format(stage.reviewers) })}
                  </span>
                )}
                {/* what the concluded sitting here said, name by name: the
                    evidence the judge after it reads */}
                {stage.opinions !== null && stage.opinions.length > 0 && (
                  <div
                    data-testid="stage-opinions"
                    data-stage={stage.id}
                    className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-muted/50 p-2.5"
                  >
                    {stage.opinions.map((opinion, said) => (
                      <div key={said} className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-medium">
                            {opinion.who ?? format(m.eventSomebody)}
                          </span>
                          <span
                            data-opinion={opinion.decision}
                            className={
                              opinion.decision === 'approve'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {format(
                              opinion.decision === 'approve'
                                ? m.reviewOpinionApprove
                                : m.reviewOpinionReject,
                            )}
                          </span>
                          {opinion.reason !== null && (
                            <span className="min-w-0 truncate text-muted-foreground">
                              {opinion.reason}
                            </span>
                          )}
                        </div>
                        {opinion.comment !== null && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {opinion.comment}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
