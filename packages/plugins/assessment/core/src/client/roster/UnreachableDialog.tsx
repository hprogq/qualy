import { useLocale } from '@qualy/web-i18n'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, ChevronRightIcon, CircleCheckIcon } from 'lucide-react'
import { PageLink, useApiQuery, useLoadFailure, usePageHref } from '@qualy/web-runtime'

import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { assessmentApi } from '../api.ts'

import { DialogBlank } from '../DialogBlank.tsx'
import { UnreachablePeople } from './UnreachablePeople.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Which questions some people on the roster cannot file, and who they are.
//
// A question's ordinary route asks, step by step, for kinds of unit; somebody
// who sits under none of them has nowhere for their filing to go (§32.93).
// The two ways out are the question's and the list's: change the route, or
// take the people off.
//
// Across a wide window the questions stand on the left and the chosen one's
// people on the right, a page at a time, so going through them is one press
// per question. On a phone a question opens its people in place of the list,
// with the way back above them.

const styles = stylex.create({
  panel: { height: 'min(86dvh, 36rem)' },
  panelPhone: { height: 'auto', maxHeight: 'min(90dvh, 44rem)' },
  dialogHead: { paddingInlineEnd: 28 },
  body: { gap: 12 },
  // the two panes share one frame, cut by one rule
  frame: {
    display: 'grid',
    gridTemplateColumns: 'minmax(13rem, 17rem) minmax(0, 1fr)',
    flexGrow: 1,
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  aside: {
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'none',
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
  },
  pane: { display: 'flex', minWidth: 0, minHeight: 0, flexDirection: 'column' },
  paneHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  detail: { overflowY: 'hidden' },
  detailHead: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 12,
  },
  back: { alignSelf: 'flex-start' },
  headRow: { display: 'flex', alignItems: 'center', gap: 12 },
  keys: { justifyContent: 'space-between' },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 48, width: '100%' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 6,
    listStyleType: 'none',
    gap: 2,
  },
  listPhone: {
    padding: 0,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    overflow: 'hidden',
    gap: 0,
  },
  // one question: a press away from its people
  question: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 10,
    paddingInline: 12,
    paddingBlock: 10,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: 'transparent', ':hover': tokens.hoverSurface },
    color: tokens.foreground,
    fontFamily: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `inset 0 0 0 2px ${tokens.focusRing}` },
  },
  questionPhone: {
    borderRadius: 0,
    paddingInline: 14,
    paddingBlock: 12,
  },
  questionDivided: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  chosen: {
    backgroundColor: { default: tokens.surface, ':hover': tokens.surface },
    boxShadow: {
      default: `0 0 0 1px ${tokens.border}, 0 1px 2px color-mix(in oklab, ${tokens.foreground} 6%, transparent)`,
      ':focus-visible': `inset 0 0 0 2px ${tokens.focusRing}`,
    },
  },
  what: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  title: {
    minWidth: 0,
    fontSize: 13.5,
    lineHeight: '1.25rem',
    fontWeight: 500,
    overflowWrap: 'anywhere',
  },
  headTitle: { fontSize: 15, fontWeight: 600 },
  levels: { fontSize: 12, color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  count: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: tokens.radiusPill,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
    color: tokens.warningForeground,
    fontSize: 12,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  arrow: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  people: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
})

type Route = {
  readonly itemId: string
  readonly itemTitle: string
  readonly participants: number
  readonly levelNames: readonly string[]
}

export function UnreachableDialog({
  batchId,
  open,
  onClose,
  onOpenPerson,
  route: routeKind = 'normal',
}: {
  batchId: string
  open: boolean
  onClose: () => void
  /** Open an account when the caller has a roster context for it. */
  onOpenPerson?: (participantId: string) => void
  route?: 'normal' | 'escalation'
}) {
  const query = useApiQuery(assessmentApi)
  const phone = useIsMobile()

  const failures = useLoadFailure()
  // the same reading the roster's notice counts from
  const alerts = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    enabled: open,
  })
  const routes: readonly Route[] = (alerts.data?.unreachable.routes ?? []).filter(
    (route) => route.route === routeKind,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // beside the list, a question is always open: the one chosen, or the first
  const selected =
    routes.find((route) => route.itemId === selectedId) ?? (phone ? undefined : routes[0])
  const selectedKey = selected?.itemId
  const listRef = useRef<HTMLUListElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const previousSelection = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])
  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = selectedKey
    if (!open || !phone) return
    if (selectedKey !== undefined) {
      backRef.current?.focus()
    } else if (previous !== undefined) {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-item="${previous}"] button[data-open-people]`)
        ?.focus()
    }
  }, [open, phone, selectedKey])

  const title =
    routeKind === 'normal' ? m.roster_unreachableTitle() : m.roster_unreachableAppealTitle()
  const people = (route: Route) => (
    <UnreachablePeople
      key={`${route.itemId}:${routeKind}`}
      batchId={batchId}
      of={{ itemId: route.itemId, route: routeKind }}
      onOpenPerson={onOpenPerson}
      fill={!phone}
    />
  )
  const questions = (
    <ul
      ref={listRef}
      data-testid="unreachable-questions"
      {...stylex.props(styles.list, phone && styles.listPhone)}
    >
      {routes.map((route, index) => (
        <QuestionRow
          key={route.itemId}
          route={route}
          phone={phone}
          divided={phone && index > 0}
          chosen={!phone && route.itemId === selectedKey}
          onOpenPeople={() => setSelectedId(route.itemId)}
        />
      ))}
    </ul>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="unreachable-dialog"
        size={phone ? '44rem' : '60rem'}
        xstyle={[styles.panel, (phone || routes.length === 0) && styles.panelPhone]}
      >
        <DialogHeader className={stylex.props(styles.dialogHead).className}>
          <DialogTitle>{title}</DialogTitle>
          {routes.length > 0 && <DialogDescription>{m.roster_unreachableHint()}</DialogDescription>}
        </DialogHeader>
        <DialogBody xstyle={[styles.body, (selected !== undefined || !phone) && styles.detail]}>
          <AsyncSection
            pending={alerts.isPending}
            error={alerts.isError ? failures.of(alerts.error) : null}
            retrying={alerts.isFetching}
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={() => void alerts.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
              </div>
            }
          >
            {routes.length === 0 ? (
              <DialogBlank
                testId="unreachable-quiet"
                icon={<CircleCheckIcon />}
                title={
                  routeKind === 'normal'
                    ? m.roster_unreachableQuiet()
                    : m.roster_unreachableAppealQuiet()
                }
              />
            ) : !phone && selected !== undefined ? (
              <div {...stylex.props(styles.frame)}>
                <nav aria-label={title} {...stylex.props(styles.aside)}>
                  {questions}
                </nav>
                <section aria-label={selected.itemTitle} {...stylex.props(styles.pane)}>
                  <div {...stylex.props(styles.paneHead)}>
                    <QuestionHeading route={selected} large />
                    <EditRoute batchId={batchId} itemId={selected.itemId} />
                  </div>
                  <div {...stylex.props(styles.people)}>{people(selected)}</div>
                </section>
              </div>
            ) : selected !== undefined ? (
              <>
                <div {...stylex.props(styles.detailHead)}>
                  <div {...stylex.props(styles.headRow, styles.keys)}>
                    <Button
                      ref={backRef}
                      size="sm"
                      variant="ghost"
                      className={stylex.props(styles.back).className}
                      onClick={() => setSelectedId(null)}
                    >
                      <ArrowLeftIcon aria-hidden />
                      {commonMessages.action_back()}
                    </Button>
                    <EditRoute batchId={batchId} itemId={selected.itemId} />
                  </div>
                  <div {...stylex.props(styles.headRow)}>
                    <QuestionHeading route={selected} large />
                  </div>
                </div>
                {people(selected)}
              </>
            ) : (
              questions
            )}
          </AsyncSection>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** the way to the question's settings, where the reader may open them */
function EditRoute({ batchId, itemId }: { batchId: string; itemId: string }) {
  // a reader who cannot open the question's settings is not led to a closed door
  const settings = usePageHref('assessment/batch-items', {
    params: { batchId },
    search: { question: itemId },
  })
  if (settings === undefined) return null
  return (
    <Button size="sm" variant="outline" asChild>
      <PageLink page="assessment/batch-items" params={{ batchId }} search={{ question: itemId }}>
        {m.roster_unreachableEditQuestion()}
      </PageLink>
    </Button>
  )
}

/** one question, what its steps ask for, and how many it finds nowhere */
function QuestionRow({
  route,
  phone,
  divided,
  chosen,
  onOpenPeople,
}: {
  route: Route
  phone: boolean
  divided: boolean
  chosen: boolean
  onOpenPeople: () => void
}) {
  return (
    <li
      data-testid="unreachable-question"
      data-item={route.itemId}
      data-count={route.participants}
      data-chosen={chosen}
    >
      <button
        type="button"
        data-open-people
        aria-current={chosen || undefined}
        onClick={onOpenPeople}
        {...stylex.props(
          styles.question,
          phone && styles.questionPhone,
          divided && styles.questionDivided,
          chosen && styles.chosen,
        )}
      >
        <QuestionHeading route={route} />
        {phone && <ChevronRightIcon aria-hidden {...stylex.props(styles.arrow)} />}
      </button>
    </li>
  )
}

function QuestionHeading({ route, large = false }: { route: Route; large?: boolean }) {
  const locale = useLocale()
  const levels =
    route.levelNames.length === 0
      ? null
      : new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(
          route.levelNames,
        )
  return (
    <>
      <span {...stylex.props(styles.what)}>
        <span {...stylex.props(styles.title, large && styles.headTitle)}>{route.itemTitle}</span>
        {levels !== null && (
          <span {...stylex.props(styles.levels)}>{m.roster_unreachableLevels({ levels })}</span>
        )}
      </span>
      <span {...stylex.props(styles.count)}>
        {m.roster_unreachableCount({ count: route.participants })}
      </span>
    </>
  )
}
