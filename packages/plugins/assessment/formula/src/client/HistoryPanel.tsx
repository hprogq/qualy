import * as stylex from '@stylexjs/stylex'
import { useMemo, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Spinner } from '@qualy/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { shortWhen } from './library-styles.ts'
import { ReleaseInfoPopover, type ReleaseInfo } from './ReleaseInfoPopover.tsx'
import type { WorkbenchView } from './workbench-view.ts'
import { SideHead } from './WorkbenchLayout.tsx'
import { TagsIcon } from 'lucide-react'
import { workbenchStyles as w } from './workbench-styles.ts'

// A formula's history, as a place to go rather than a record to read.
//
// Two lists, because they are two different facts. Publications are what a
// question can be scored by, each under the name its author gave it; saved
// revisions are what the draft was at each save. Pressing either opens that
// state in the workbench, read-only, and pressing it again comes back to the
// draft - so does the way back the panel offers while a piece is open.

export type HistoryList = 'releases' | 'revisions'

const styles = stylex.create({
  frame: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  primary: { display: 'flex', flexShrink: 0, paddingInline: 16, paddingTop: 12, paddingBottom: 10 },
  switch: { paddingInline: 16, paddingTop: 4, paddingBottom: 8, flexShrink: 0 },
  switchList: { width: '100%' },
  switchTab: { flexGrow: 1, justifyContent: 'center', fontSize: 12.5 },
  count: {
    marginLeft: 5,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  list: {
    minHeight: 0,
    flexGrow: 1,
    overflowY: 'auto',
    margin: 0,
    padding: 0,
    paddingBottom: 8,
    listStyle: 'none',
  },
  fill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 24,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingRight: 10,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: 'transparent',
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
  },
  rowHere: { borderLeftColor: tokens.foreground, backgroundColor: tokens.surfaceMuted },
  item: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 3,
    paddingBlock: 9,
    paddingLeft: 14,
    paddingRight: 4,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: tokens.foreground,
    cursor: 'pointer',
  },
  itemLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  itemName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 500,
  },
  unnamed: { color: tokens.mutedForeground, fontWeight: 400 },
  itemMeta: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    columnGap: 10,
    fontSize: 11.5,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 90%, transparent)`,
  },
  more: {
    display: 'flex',
    width: '100%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
})

export function HistoryPanel({
  functionId,
  releases,
  latestVersionNo,
  draftRevision,
  view,
  onView,
  list,
  onList,
  primary,
}: {
  readonly functionId: string
  /** newest first */
  readonly releases: readonly ReleaseInfo[]
  readonly latestVersionNo: number | null
  /** the revision the draft is at now */
  readonly draftRevision: number
  readonly view: WorkbenchView
  readonly onView: (view: WorkbenchView) => void
  readonly list: HistoryList
  readonly onList: (list: HistoryList) => void
  /** the panel's one leading action: publishing from the draft, the way back from history */
  readonly primary?: ReactNode
}) {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()

  const revisions = useInfiniteQuery({
    queryKey: [
      ...query.assessmentFormula.listFormulaDraftRevisions.key({
        params: { functionId },
        query: {},
      }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      runApi(
        api.assessmentFormula.listFormulaDraftRevisions({
          params: { functionId },
          query: pageParam !== undefined ? { cursor: pageParam } : {},
        }),
      ),
    ...cursorPages,
    enabled: list === 'revisions',
  })
  const revisionItems = useMemo(
    () => revisions.data?.pages.flatMap((page) => page.items) ?? [],
    [revisions.data],
  )

  // pressing what is open comes back to the draft
  const open = (next: WorkbenchView) => {
    const here =
      (next.kind === 'release' && view.kind === 'release' && next.versionNo === view.versionNo) ||
      (next.kind === 'revision' && view.kind === 'revision' && next.revisionNo === view.revisionNo)
    onView(here ? { kind: 'draft' } : next)
  }

  const originWords = (item: (typeof revisionItems)[number]): string | null => {
    switch (item.origin) {
      case 'created':
        return format(m.revisionCreated)
      case 'copied-from-template':
        return format(m.revisionCopied)
      case 'migration':
        return format(m.revisionMigration)
      case 'restored-from-version':
        return format(m.revisionRestoredRelease, {
          name:
            item.sourceVersion === null
              ? ''
              : (item.sourceVersion.releaseName ??
                format(m.releaseOrdinal, { number: item.sourceVersion.versionNo })),
        })
      case 'restored-from-draft':
        return format(m.revisionRestoredRevision, { number: item.sourceDraftRevisionNo ?? 0 })
      default:
        return null
    }
  }

  const releaseList =
    releases.length === 0 ? (
      <div {...stylex.props(styles.fill)}>
        <EmptyRow>{format(m.versionsEmpty)}</EmptyRow>
      </div>
    ) : (
      <ul data-testid="formula-versions" {...stylex.props(styles.list)}>
        {releases.map((release) => {
          const here = view.kind === 'release' && view.versionNo === release.versionNo
          return (
            <li key={release.versionNo} {...stylex.props(styles.row, here && styles.rowHere)}>
              <button
                type="button"
                data-testid="formula-release"
                data-version={release.versionNo}
                aria-current={here ? 'true' : undefined}
                onClick={() => open({ kind: 'release', versionNo: release.versionNo })}
                {...stylex.props(styles.item)}
              >
                <span {...stylex.props(styles.itemLine)}>
                  <span
                    {...stylex.props(
                      styles.itemName,
                      release.releaseName === null && styles.unnamed,
                    )}
                  >
                    {release.releaseName ?? format(m.releaseUnnamed)}
                  </span>
                  {release.versionNo === latestVersionNo && (
                    <span {...stylex.props(w.standing, w.standingGood)}>
                      {format(m.versionLatest)}
                    </span>
                  )}
                </span>
                <span {...stylex.props(styles.itemMeta)}>
                  <span>{shortWhen(release.publishedAt, format, locale)}</span>
                  <span>{format(m.releaseOrdinal, { number: release.versionNo })}</span>
                </span>
              </button>
              <ReleaseInfoPopover functionId={functionId} release={release} />
            </li>
          )
        })}
      </ul>
    )

  const revisionList = revisions.isPending ? (
    <div role="status" {...stylex.props(styles.fill)}>
      <Spinner aria-label={format(m.editorLoading)} />
    </div>
  ) : revisions.isError ? (
    <div {...stylex.props(styles.fill)}>
      <EmptyRow role="alert">{formatError(revisions.error)}</EmptyRow>
    </div>
  ) : revisionItems.length === 0 ? (
    <div data-testid="formula-revisions-empty" {...stylex.props(styles.fill)}>
      <EmptyRow>{format(m.revisionsEmpty)}</EmptyRow>
    </div>
  ) : (
    <ul data-testid="formula-revisions" {...stylex.props(styles.list)}>
      {revisionItems.map((item) => {
        const here = view.kind === 'revision' && view.revisionNo === item.revisionNo
        const origin = originWords(item)
        return (
          <li key={item.revisionNo} {...stylex.props(styles.row, here && styles.rowHere)}>
            <button
              type="button"
              data-testid="formula-revision"
              data-revision={item.revisionNo}
              aria-current={here ? 'true' : undefined}
              onClick={() => open({ kind: 'revision', revisionNo: item.revisionNo })}
              {...stylex.props(styles.item)}
            >
              <span {...stylex.props(styles.itemLine)}>
                <span {...stylex.props(styles.itemName)}>
                  {format(m.revisionNumber, { number: item.revisionNo })}
                </span>
                {item.revisionNo === draftRevision && (
                  <span {...stylex.props(w.standing, w.standingQuiet)}>
                    {format(m.revisionCurrent)}
                  </span>
                )}
              </span>
              <span {...stylex.props(styles.itemMeta)}>
                <span>{shortWhen(item.savedAt, format, locale)}</span>
                {item.savedByName === null ? null : <span>{item.savedByName}</span>}
              </span>
              {origin === null ? null : <span {...stylex.props(styles.itemMeta)}>{origin}</span>}
            </button>
          </li>
        )
      })}
      {revisions.hasNextPage && (
        <li>
          <button
            type="button"
            disabled={revisions.isFetchingNextPage}
            onClick={() => void revisions.fetchNextPage()}
            {...stylex.props(styles.more)}
          >
            {format(m.loadMore)}
          </button>
        </li>
      )}
    </ul>
  )

  return (
    <div {...stylex.props(styles.frame)}>
      <SideHead title={format(m.historyTitle)} column icon={<TagsIcon size={14} aria-hidden />} />
      {primary === undefined || primary === null ? null : (
        <div {...stylex.props(styles.primary)}>{primary}</div>
      )}
      <div {...stylex.props(styles.switch)}>
        <Tabs
          variant="segmented"
          value={list}
          onValueChange={(next) => onList(next as HistoryList)}
        >
          <TabsList aria-label={format(m.historyTitle)} xstyle={styles.switchList}>
            <TabsTrigger value="releases" xstyle={styles.switchTab}>
              {format(m.historyReleases)}
              <span {...stylex.props(styles.count)}>{releases.length}</span>
            </TabsTrigger>
            <TabsTrigger value="revisions" xstyle={styles.switchTab}>
              {format(m.historyRevisions)}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {list === 'releases' ? releaseList : revisionList}
    </div>
  )
}
