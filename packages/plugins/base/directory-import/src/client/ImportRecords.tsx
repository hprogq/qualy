import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, UploadIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@qualy/ui/empty'
import { Cell, LeadWord, Table, TableHead, TableRow, TableSkeleton, Tag } from '@qualy/ui/screen'
import { Pager } from '@qualy/ui/pager'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { directoryApi } from './api.ts'
import { FlowFrame } from './flow.tsx'
import { directoryImportMessages as m } from './i18n.ts'
import { whenText } from './words.ts'

// What has been imported before, newest first, a page at a time.
//
// The same panel the wizard runs in, with a table in it instead of a form:
// looking at the history and starting another import are the same errand
// from the reader's side, so the way to start one is in this panel's head.
//
// Narrow, a row of five columns is not a row; each import becomes a card of
// three lines - what file, what it did, and who did it when - and the whole
// card is the way into its record.

/** imports to a page of the record list */
const RECORDS_PER_PAGE = 10

const PHONE = 768

const styles = stylex.create({
  fills: { display: 'flex', minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' },
  note: { fontSize: 12.5, color: tokens.mutedForeground },
  cards: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
    paddingInline: 14,
    paddingBlock: 14,
    borderWidth: 0,
    borderRadius: 14,
    backgroundColor: {
      default: tokens.surface,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.surface})`,
    },
    boxShadow: `0 0 0 1px ${tokens.border}`,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
  },
  cardHead: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  cardName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14.5,
    fontWeight: 600,
  },
  chevron: { flexShrink: 0, marginLeft: 'auto', color: tokens.mutedForeground },
  cardCounts: {
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  cardWho: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  rule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  pager: { display: 'flex', width: '100%', alignItems: 'center', gap: 8 },
  spring: { flexGrow: 1 },
})

/**
 * Past imports, in the wizard's own panel; a row opens its record beside
 * whatever frames this list.
 */
export function ImportRecords({
  open,
  onClose,
  onOpen,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onOpen: (importId: string) => void
  /** the other half of the same errand: import again, from where the history is */
  onImport: () => void
}) {
  const { format, formatError, locale } = useI18n()
  const phone = useIsBelow(PHONE)
  const query = useApiQuery(directoryApi)
  const [page, setPage] = useState(1)
  const imports = useQuery({
    ...query.directory.listUserImports.queryOptions({
      query: { page: String(page), limit: String(RECORDS_PER_PAGE) },
    }),
    placeholderData: keepPreviousData,
  })
  const items = imports.data?.items ?? []
  const total = imports.data?.total ?? 0

  /** a file's name, with the one word that can stand beside it */
  const reversed = (one: (typeof items)[number]) =>
    one.standing.living === 0 && one.createdUserCount > 0

  return (
    <FlowFrame
      open={open}
      onClose={onClose}
      testId="import-records"
      title={format(m.recordsTitle)}
      subtitle={format(m.recordsHint)}
      cancelLabel={format(m.recordClose)}
      closeLabel={format(m.recordClose)}
      actions={[]}
      headActions={
        <Button size="sm" onClick={onImport}>
          <UploadIcon aria-hidden />
          {format(m.action)}
        </Button>
      }
      {...(total > RECORDS_PER_PAGE
        ? {
            foot: (
              <div {...stylex.props(styles.pager)}>
                <Pager
                  testId="import-records-pager"
                  label={format(m.pagerLabel)}
                  page={imports.data?.page ?? page}
                  pageSize={RECORDS_PER_PAGE}
                  total={total}
                  disabled={imports.isFetching}
                  summary={format(m.countOf, { count: total })}
                  onPage={setPage}
                />
              </div>
            ),
          }
        : {})}
    >
      <AsyncSection
        pending={imports.isPending}
        error={imports.isError ? formatError(imports.error) : null}
        loadingLabel={format(m.recordsLoading)}
        retryLabel={format(m.retry)}
        onRetry={() => void imports.refetch()}
        skeleton={<TableSkeleton rows={6} />}
        xstyle={styles.fills}
      >
        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{format(m.recordsEmpty)}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={onImport}>
                <UploadIcon aria-hidden />
                {format(m.action)}
              </Button>
            </EmptyContent>
          </Empty>
        ) : phone ? (
          <div {...stylex.props(styles.cards)}>
            {items.map((one) => (
              <button
                key={one.id}
                type="button"
                {...stylex.props(styles.card)}
                data-testid="import-record"
                data-import={one.id}
                data-living={one.standing.living}
                onClick={() => onOpen(one.id)}
              >
                <span {...stylex.props(styles.cardHead)}>
                  <span {...stylex.props(styles.cardName)}>{one.filename}</span>
                  {reversed(one) && <Tag>{format(m.recordReversed)}</Tag>}
                  <ChevronRightIcon size={14} aria-hidden {...stylex.props(styles.chevron)} />
                </span>
                <span {...stylex.props(styles.cardCounts)}>
                  {format(m.recordCounts, {
                    users: one.createdUserCount,
                    existing: one.existingUserCount,
                    nodes: one.createdNodeCount,
                  })}
                </span>
                <span {...stylex.props(styles.cardWho)}>
                  <span>{one.actorName ?? '—'}</span>
                  <span aria-hidden {...stylex.props(styles.rule)} />
                  <span>{whenText(locale, one.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Table columns="minmax(0, 1.3fr) minmax(0, 1.4fr) 6rem 8.5rem" openable>
            <TableHead>
              <span>{format(m.recordFile)}</span>
              <span>{format(m.recordOutcome)}</span>
              <span>{format(m.recordBy)}</span>
              <span>{format(m.recordAt)}</span>
            </TableHead>
            {items.map((one) => (
              <TableRow
                key={one.id}
                onOpen={() => onOpen(one.id)}
                data-testid="import-record"
                data-import={one.id}
                data-living={one.standing.living}
              >
                <Cell lead title={one.filename}>
                  <LeadWord>{one.filename}</LeadWord>
                  {reversed(one) && <Tag outline>{format(m.recordReversed)}</Tag>}
                </Cell>
                <Cell>
                  {format(m.recordCounts, {
                    users: one.createdUserCount,
                    existing: one.existingUserCount,
                    nodes: one.createdNodeCount,
                  })}
                </Cell>
                <Cell>{one.actorName ?? '—'}</Cell>
                <Cell numeric narrow="end">
                  {whenText(locale, one.createdAt)}
                </Cell>
              </TableRow>
            ))}
          </Table>
        )}
      </AsyncSection>
    </FlowFrame>
  )
}
