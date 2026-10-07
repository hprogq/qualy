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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
// take the people off. A question opens a separate paginated detail inside
// this dialog, keeping its people out of the list of other questions.

const styles = stylex.create({
  // as tall as what it holds, up to a ceiling where the questions scroll
  panel: { maxHeight: 'min(90dvh, 44rem)' },
  dialogHead: { paddingInlineEnd: 28 },
  body: { gap: 12 },
  detail: { overflowY: 'hidden' },
  detailHead: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 12,
  },
  back: { alignSelf: 'flex-start' },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 64, width: '100%' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    gap: 10,
  },
  question: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 12,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
  },
  what: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  title: {
    minWidth: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 500,
    overflowWrap: 'anywhere',
  },
  levels: { fontSize: 12.5, color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  count: {
    flexShrink: 0,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  keys: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
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
  const selected = routes.find((route) => route.itemId === selectedId)
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
    if (!open) return
    if (selectedKey !== undefined) {
      backRef.current?.focus()
    } else if (previous !== undefined) {
      const row = [...(listRef.current?.children ?? [])].find(
        (element) => element.getAttribute('data-item') === previous,
      )
      row?.querySelector<HTMLButtonElement>('button[data-open-people]')?.focus()
    }
  }, [open, selectedKey])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="unreachable-dialog" size="44rem" xstyle={styles.panel}>
        <DialogHeader className={stylex.props(styles.dialogHead).className}>
          <DialogTitle>
            {routeKind === 'normal'
              ? m.roster_unreachableTitle()
              : m.roster_unreachableAppealTitle()}
          </DialogTitle>
        </DialogHeader>
        <DialogBody xstyle={[styles.body, selected !== undefined && styles.detail]}>
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
              </div>
            }
          >
            {selected !== undefined ? (
              <>
                <div {...stylex.props(styles.detailHead)}>
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
                  <QuestionHeading route={selected} />
                </div>
                <UnreachablePeople
                  key={`${selected.itemId}:${routeKind}`}
                  batchId={batchId}
                  of={{ itemId: selected.itemId, route: routeKind }}
                  onOpenPerson={onOpenPerson}
                />
              </>
            ) : routes.length === 0 ? (
              <DialogBlank
                testId="unreachable-quiet"
                icon={<CircleCheckIcon />}
                title={
                  routeKind === 'normal'
                    ? m.roster_unreachableQuiet()
                    : m.roster_unreachableAppealQuiet()
                }
              />
            ) : (
              <ul ref={listRef} data-testid="unreachable-questions" {...stylex.props(styles.list)}>
                {routes.map((route) => (
                  <QuestionRow
                    key={route.itemId}
                    batchId={batchId}
                    route={route}
                    onOpenPeople={() => setSelectedId(route.itemId)}
                  />
                ))}
              </ul>
            )}
          </AsyncSection>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_close()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** one question, what its steps ask for, and its people on request */
function QuestionRow({
  batchId,
  route,
  onOpenPeople,
}: {
  batchId: string
  route: Route
  onOpenPeople: () => void
}) {
  // a reader who cannot open the question's settings is not led to a closed door
  const settings = usePageHref('assessment/batch-items', {
    params: { batchId },
    search: { question: route.itemId },
  })
  return (
    <li
      data-testid="unreachable-question"
      data-item={route.itemId}
      data-count={route.participants}
      {...stylex.props(styles.question)}
    >
      <QuestionHeading route={route} />
      <div {...stylex.props(styles.keys)}>
        {settings !== undefined && (
          <Button size="sm" variant="outline" asChild>
            <PageLink
              page="assessment/batch-items"
              params={{ batchId }}
              search={{ question: route.itemId }}
            >
              {m.roster_unreachableEditQuestion()}
            </PageLink>
          </Button>
        )}
        <Button size="sm" variant="secondary" data-open-people onClick={onOpenPeople}>
          {m.roster_unreachableShowPeople()}
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function QuestionHeading({ route }: { route: Route }) {
  const locale = useLocale()
  const levels =
    route.levelNames.length === 0
      ? null
      : new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(
          route.levelNames,
        )
  return (
    <div {...stylex.props(styles.head)}>
      <span {...stylex.props(styles.what)}>
        <span {...stylex.props(styles.title)}>{route.itemTitle}</span>
        {levels !== null && (
          <span {...stylex.props(styles.levels)}>{m.roster_unreachableLevels({ levels })}</span>
        )}
      </span>
      <span {...stylex.props(styles.count)}>
        {m.roster_unreachableCount({ count: route.participants })}
      </span>
    </div>
  )
}
