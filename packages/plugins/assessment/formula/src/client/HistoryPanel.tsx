import * as stylex from '@stylexjs/stylex'
import { useMemo, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { shortWhen } from './library-styles.ts'
import type { WorkbenchView } from './workbench-view.ts'
import { SideHead } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

// A formula's history, as a place to go rather than a record to read.
//
// Two lists, because they are two different facts. Publications are what a
// question can be scored by, each under the name its author gave it; saved
// revisions are what the draft was at each save. Pressing either opens that
// state in the workbench, read-only - the list only chooses.

export interface ReleaseSummary {
  readonly versionNo: number
  readonly releaseName: string | null
  readonly publishedAt: string
  readonly publishedByName: string | null
}

export type HistoryList = 'releases' | 'revisions'

const styles = stylex.create({
  frame: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  switch: { paddingInline: 16, paddingBottom: 8, flexShrink: 0 },
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
  item: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 3,
    paddingBlock: 9,
    paddingInline: 16,
    borderWidth: 0,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: 'transparent',
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    textAlign: 'left',
    color: tokens.foreground,
    cursor: 'pointer',
  },
  itemHere: {
    borderLeftColor: tokens.foreground,
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
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
  action,
}: {
  readonly functionId: string
  /** newest first */
  readonly releases: readonly ReleaseSummary[]
  readonly latestVersionNo: number | null
  /** the revision the draft is at now */
  readonly draftRevision: number
  readonly view: WorkbenchView
  readonly onView: (view: WorkbenchView) => void
  readonly list: HistoryList
  readonly onList: (list: HistoryList) => void
  /** what starts a new entry here - publishing - when the view offers it */
  readonly action?: ReactNode
}) {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, locale } = useI18n()

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

  const originWords = (item: (typeof revisionItems)[number]): string | null => {
    switch (item.origin) {
      case 'created':
        return format(m.revisionCreated)
      case 'copied-from-template':
        return format(m.revisionCopied)
      case 'migration':
        return format(m.revisionMigration)
      case 'restored-from-version':
        return item.sourceVersion === null
          ? format(m.revisionRestoredRelease, { name: '' })
          : format(m.revisionRestoredRelease, {
              name:
                item.sourceVersion.releaseName ??
                format(m.releaseOrdinal, { number: item.sourceVersion.versionNo }),
            })
      case 'restored-from-draft':
        return format(m.revisionRestoredRevision, { number: item.sourceDraftRevisionNo ?? 0 })
      default:
        return null
    }
  }

  return (
    <div {...stylex.props(styles.frame)}>
      <SideHead title={format(m.historyTitle)} action={action} />
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
      {list === 'releases' ? (
        releases.length === 0 ? (
          <p {...stylex.props(w.sideEmpty)}>{format(m.versionsEmpty)}</p>
        ) : (
          <ul data-testid="formula-versions" {...stylex.props(styles.list)}>
            {releases.map((release) => {
              const here = view.kind === 'release' && view.versionNo === release.versionNo
              return (
                <li key={release.versionNo}>
                  <button
                    type="button"
                    data-testid="formula-release"
                    data-version={release.versionNo}
                    aria-current={here ? 'true' : undefined}
                    onClick={() => onView({ kind: 'release', versionNo: release.versionNo })}
                    {...stylex.props(styles.item, here && styles.itemHere)}
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
                </li>
              )
            })}
          </ul>
        )
      ) : (
        <ul data-testid="formula-revisions" {...stylex.props(styles.list)}>
          {revisionItems.map((item) => {
            const here = view.kind === 'revision' && view.revisionNo === item.revisionNo
            const origin = originWords(item)
            return (
              <li key={item.revisionNo}>
                <button
                  type="button"
                  data-testid="formula-revision"
                  data-revision={item.revisionNo}
                  aria-current={here ? 'true' : undefined}
                  onClick={() => onView({ kind: 'revision', revisionNo: item.revisionNo })}
                  {...stylex.props(styles.item, here && styles.itemHere)}
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
                  {origin === null ? null : (
                    <span {...stylex.props(styles.itemMeta)}>{origin}</span>
                  )}
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
      )}
    </div>
  )
}
