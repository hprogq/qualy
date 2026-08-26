import { memo, useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Kbd } from '@qualy/ui/kbd'
import { assessmentMessages as m } from '../i18n.ts'
import { entryStatusMessage, trimAmount, type EntryDto } from '../entry/model.ts'
import { summaryOf, type ReviewDto } from './model.ts'
import { useFinePointer } from './pointer.ts'
import { Pane } from './Pane.tsx'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

const paneStyles = stylex.create({
  frame: {
    borderLeftWidth: {
      default: 0,
      '@media (min-width: 1024px)': 1,
    },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  inner: {
    gap: 16,
    padding: {
      default: 16,
      '@media (min-width: 1024px)': 20,
    },
  },
})

const styles = stylex.create({
  clauseCard: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 8,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 12,
    paddingBlock: 10,
  },
  caption: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.025em',
    textTransform: 'uppercase',
    color: tokens.mutedForeground,
  },
  clauseBody: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  block: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  headRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  noShrink: {
    flexShrink: 0,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  aside: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  siblingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  siblingButton: {
    marginInline: -6,
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    paddingInline: 6,
    paddingBlock: 4,
    textAlign: 'left',
    fontSize: 14,
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  siblingDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
  },
  dotCurrent: {
    backgroundColor: tokens.foreground,
  },
  dotRefused: {
    backgroundColor: tokens.danger,
  },
  dotQuiet: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  siblingName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nameCurrent: {
    fontWeight: 500,
  },
  nameOther: {
    color: tokens.mutedForeground,
  },
  thisMark: {
    paddingRight: 6,
    color: tokens.mutedForeground,
  },
  note: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  aboutRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 2,
    fontSize: 14,
  },
  aboutLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  leader: {
    height: 1,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  aboutValue: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },
  routeStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  routeName: {
    fontSize: 14,
    fontWeight: 500,
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepNo: {
    marginTop: 1,
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  stepNoCurrent: {
    borderColor: tokens.foreground,
    backgroundColor: tokens.foreground,
    color: tokens.background,
  },
  stepNoPassed: {
    borderColor: 'transparent',
    backgroundColor: tokens.surfaceMuted,
    color: tokens.foreground,
  },
  stepNoAhead: {
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  stepBody: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  stepHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  stepName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  stepNameCurrent: {
    fontWeight: 500,
  },
  stepWho: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  opinions: {
    marginTop: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: tokens.radiusLg,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    padding: 10,
  },
  opinion: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  opinionHead: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    fontSize: 12,
  },
  opinionWho: {
    fontWeight: 500,
  },
  opinionApprove: {
    color: tokens.successForeground,
  },
  opinionReject: {
    color: tokens.danger,
  },
  opinionReason: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
})

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
      xstyle={paneStyles.frame}
      innerXstyle={paneStyles.inner}
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
      <section {...stylex.props(styles.clauseCard)}>
        <p {...stylex.props(styles.caption)}>{format(m.myEntriesBasis)}</p>
        <p {...stylex.props(styles.clauseBody)}>{format(m.myEntriesBasisSoon)}</p>
      </section>

      <section {...stylex.props(styles.block)}>
        <p {...stylex.props(styles.caption)}>{format(m.reviewChainTitle)}</p>
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
        <section {...stylex.props(styles.block)}>
          <p {...stylex.props(styles.caption)}>{format(m.reviewAboutTitle)}</p>
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
        <section {...stylex.props(styles.block)}>
          <div {...stylex.props(styles.headRow)}>
            <p {...stylex.props(styles.caption, styles.noShrink)}>
              {format(m.reviewSiblingsTitle)}
            </p>
            <span {...stylex.props(styles.spacer)} />
            {/* the keys, once, over the list they open - rather than the
                count, which the list itself already shows */}
            {fine && (
              <span {...stylex.props(styles.aside)}>
                {format(m.reviewSiblingsKeys, {
                  count: Math.min(context.siblings.length, 9),
                })}
              </span>
            )}
          </div>
          <ul {...stylex.props(styles.siblingList)}>
            {context.siblings.map((sibling, index) => (
              <li key={sibling.entryId}>
                {/* every claim opens: reading one against another is how a
                    duplicate is caught, and the aside is where they meet */}
                <button
                  type="button"
                  onClick={() => onOpenSibling(sibling.entryId)}
                  {...stylex.props(styles.siblingButton)}
                >
                  <span
                    aria-hidden
                    {...stylex.props(
                      styles.siblingDot,
                      sibling.current
                        ? styles.dotCurrent
                        : sibling.status === 'rejected' || sibling.status === 'needs_revision'
                          ? styles.dotRefused
                          : styles.dotQuiet,
                    )}
                  />
                  <span
                    {...stylex.props(
                      styles.siblingName,
                      sibling.current ? styles.nameCurrent : styles.nameOther,
                    )}
                  >
                    {sibling.current && (
                      <span {...stylex.props(styles.thisMark)}>{format(m.reviewSiblingThis)}</span>
                    )}
                    {summaryOf(sibling.values) === ''
                      ? review.itemTitle
                      : summaryOf(sibling.values)}
                  </span>
                  <span {...stylex.props(styles.aside)}>
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
              <p {...stylex.props(styles.note)}>{format(m.reviewSiblingsFull)}</p>
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
    <div {...stylex.props(styles.aboutRow)}>
      <span {...stylex.props(styles.aboutLabel)}>{label}</span>
      <span aria-hidden {...stylex.props(styles.leader)} />
      <span {...stylex.props(styles.aboutValue)}>{value}</span>
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
    <div {...stylex.props(styles.routeStack)}>
      {/* the route's name is part of the map, not another caption: the
          caption above says what the block is, this says which road */}
      {title !== null && <p {...stylex.props(styles.routeName)}>{title}</p>}
      <ol {...stylex.props(styles.routeStack)}>
        {stages.map((stage, index) => {
          const current = stage.id === here
          // behind the step this round stands at, so it has been through
          const passed = at !== -1 && index < at
          return (
            <li key={stage.id} {...stylex.props(styles.step)}>
              <span
                {...stylex.props(
                  styles.stepNo,
                  current
                    ? styles.stepNoCurrent
                    : passed
                      ? styles.stepNoPassed
                      : styles.stepNoAhead,
                )}
              >
                {index + 1}
              </span>
              <div {...stylex.props(styles.stepBody)}>
                <div {...stylex.props(styles.stepHead)}>
                  {/* the administrator's name for the step where one exists;
                      the unit-and-roles composite only as the fallback */}
                  <span {...stylex.props(styles.stepName, current && styles.stepNameCurrent)}>
                    {stage.nodeName === null
                      ? format(
                          stage.skipped === 'no-holder'
                            ? m.reviewStageNoHolder
                            : m.reviewStageSkipped,
                        )
                      : (stage.label ?? `${stage.nodeName}／${listed.format(stage.roleNames)}`)}
                  </span>
                  <span {...stylex.props(styles.spacer)} />
                  {/* what happened at this step, where the eye already is:
                      a step with nothing beside it is one still ahead */}
                  {(current || passed) && (
                    <span {...stylex.props(styles.aside)}>
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
                  <span {...stylex.props(styles.stepWho)}>
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
                    {...stylex.props(styles.opinions)}
                  >
                    {stage.opinions.map((opinion, said) => (
                      <div key={said} {...stylex.props(styles.opinion)}>
                        <div {...stylex.props(styles.opinionHead)}>
                          <span {...stylex.props(styles.opinionWho)}>
                            {opinion.who ?? format(m.eventSomebody)}
                          </span>
                          <span
                            data-opinion={opinion.decision}
                            {...stylex.props(
                              opinion.decision === 'approve'
                                ? styles.opinionApprove
                                : styles.opinionReject,
                            )}
                          >
                            {format(
                              opinion.decision === 'approve'
                                ? m.reviewOpinionApprove
                                : m.reviewOpinionReject,
                            )}
                          </span>
                          {opinion.reason !== null && (
                            <span {...stylex.props(styles.opinionReason)}>{opinion.reason}</span>
                          )}
                        </div>
                        {opinion.comment !== null && (
                          <p {...stylex.props(styles.note)}>{opinion.comment}</p>
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
