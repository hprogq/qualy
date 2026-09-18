import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Spinner } from '@qualy/ui/spinner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { EyeIcon, Share2Icon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { shortWhen } from './library-styles.ts'
import { ReleaseInfoPopover, type ReleaseInfo } from './ReleaseInfoPopover.tsx'
import type { WorkbenchView } from './workbench-view.ts'
import { workbenchStyles as w } from './workbench-styles.ts'

// A formula's versions, as a place to go rather than a record to read.
//
// Two lists, because they are two different facts. Publications are what a
// question can be scored by, each under the name its author gave it; saved
// revisions are what the draft was at each save. Pressing either opens that
// state in the workbench, read-only; the way back to the draft stands at the
// top of the list, and what an open version can still do - be restored, be
// shared - stands at its foot.

export type HistoryList = 'releases' | 'revisions'

const styles = stylex.create({
  panel: { width: 520 },
  // a phone's sheet comes up from the foot and never takes the whole screen
  panelPhone: { width: null, maxHeight: '76%' },
  tabs: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    paddingInline: 24,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
  },
  tabList: { gap: 0 },
  tab: { height: 34, gap: 6, paddingInline: 0, marginRight: 16, borderRadius: 0, fontSize: 12 },
  count: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  back: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
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
  // one version is a row: what it is, and at its end what can be done with it
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 12,
    paddingLeft: 24,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  rowHere: { backgroundColor: tokens.surfaceMuted },
  body: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 4 },
  act: {
    display: 'inline-flex',
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 8,
    padding: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  actHere: { backgroundColor: tokens.border, color: tokens.foreground },
  // a version already offered somewhere says so twice: in the colour of the
  // mark that changes it, and in words beside its name
  actShared: { color: { default: tokens.successForeground, ':hover': tokens.successForeground } },
  line: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  // the chevron answers for the whole row, so it stands beside both its lines
  rowBody: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 5 },
  rowGrid: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 500,
  },
  nameHere: { fontWeight: 600 },
  sharedWords: {
    flexShrink: 0,
    fontSize: 11.5,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.successForeground,
  },
  unnamed: { color: tokens.mutedForeground, fontWeight: 400 },
  meta: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: 11.5,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  metaRule: { width: 1, height: 10, flexShrink: 0, backgroundColor: tokens.border },
  metaWho: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingBlock: 10,
    paddingInline: 24,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
  },
  footWords: {
    minWidth: 0,
    flexGrow: 1,
    fontSize: 11.5,
    lineHeight: 1.5,
    color: tokens.surfaceMutedForeground,
  },
  restore: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 28,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: tokens.surface, ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.foreground, ':disabled': tokens.mutedForeground },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
})

export function VersionsDrawer({
  open,
  onOpenChange,
  narrow,
  functionId,
  releases,
  latestVersionNo,
  draftRevision,
  view,
  onView,
  list,
  onList,
  archived,
  restoring,
  onRestoreRelease,
  onRestoreRevision,
  onShare,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly narrow: boolean
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
  readonly archived: boolean
  readonly restoring: boolean
  readonly onRestoreRelease: (release: { versionNo: number; name: string }) => void
  readonly onRestoreRevision: (revisionNo: number) => void
  /** opens the audience of one publication for changing */
  readonly onShare: (release: ReleaseInfo) => void
}) {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()

  // where this author holds the sharing permission, asked once for the list:
  // a version offered to nobody, by somebody who may offer it to nobody, has
  // no audience to manage
  const shareOptions = useQuery({
    ...query.assessmentFormula.listFormulaShareOptions.queryOptions({ query: {} }),
    enabled: open && releases.length > 0,
  })
  const mayShare = (shareOptions.data?.nodes.length ?? 0) > 0

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
    enabled: open && list === 'revisions',
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
          const shared = release.sharedCount ?? 0
          return (
            <li key={release.versionNo} {...stylex.props(styles.row, here && styles.rowHere)}>
              <div {...stylex.props(styles.body)}>
                <div {...stylex.props(styles.line)}>
                  <span
                    {...stylex.props(
                      styles.name,
                      here && styles.nameHere,
                      release.releaseName === null && styles.unnamed,
                    )}
                  >
                    {release.releaseName ?? format(m.releaseUnnamed)}
                  </span>
                  {release.versionNo === latestVersionNo ? (
                    <span {...stylex.props(w.standing, w.standingQuiet)}>
                      {format(m.versionLatest)}
                    </span>
                  ) : null}
                  {shared === 0 ? null : (
                    <span
                      data-testid="formula-release-shared"
                      data-count={shared}
                      {...stylex.props(styles.sharedWords)}
                    >
                      {format(m.sharingUnits, { count: shared })}
                    </span>
                  )}
                </div>
                <div {...stylex.props(styles.meta)}>
                  <span>{format(m.releaseOrdinal, { number: release.versionNo })}</span>
                  <span aria-hidden {...stylex.props(styles.metaRule)} />
                  <span>{shortWhen(release.publishedAt, format, locale)}</span>
                  {release.publishedByName === null ? null : (
                    <>
                      <span aria-hidden {...stylex.props(styles.metaRule)} />
                      <span {...stylex.props(styles.metaWho)}>{release.publishedByName}</span>
                    </>
                  )}
                </div>
              </div>
              {shared === 0 && !mayShare ? null : (
                <button
                  type="button"
                  data-testid="formula-release-share"
                  data-shared={shared}
                  data-version={release.versionNo}
                  aria-label={
                    shared === 0
                      ? format(m.sharingManage)
                      : format(m.sharingUnits, { count: shared })
                  }
                  title={
                    shared === 0
                      ? format(m.sharingManage)
                      : format(m.sharingUnits, { count: shared })
                  }
                  onClick={() => onShare(release)}
                  {...stylex.props(styles.act, shared > 0 && styles.actShared)}
                >
                  <Share2Icon size={15} aria-hidden />
                </button>
              )}
              <button
                type="button"
                data-testid="formula-release"
                data-version={release.versionNo}
                aria-current={here ? 'true' : undefined}
                aria-label={format(m.versionOpen)}
                title={format(m.versionOpen)}
                onClick={() => {
                  onView({ kind: 'release', versionNo: release.versionNo })
                  onOpenChange(false)
                }}
                {...stylex.props(styles.act, here && styles.actHere)}
              >
                <EyeIcon size={15} aria-hidden />
              </button>
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
            <div {...stylex.props(styles.body)}>
              <div {...stylex.props(styles.line)}>
                <span {...stylex.props(styles.name, here && styles.nameHere)}>
                  {format(m.revisionNumber, { number: item.revisionNo })}
                </span>
                {item.revisionNo === draftRevision ? (
                  <span {...stylex.props(w.standing, w.standingQuiet)}>
                    {format(m.revisionCurrent)}
                  </span>
                ) : null}
              </div>
              <div {...stylex.props(styles.meta)}>
                <span>{shortWhen(item.savedAt, format, locale)}</span>
                {item.savedByName === null ? null : (
                  <>
                    <span aria-hidden {...stylex.props(styles.metaRule)} />
                    <span {...stylex.props(styles.metaWho)}>{item.savedByName}</span>
                  </>
                )}
                {origin === null ? null : (
                  <>
                    <span aria-hidden {...stylex.props(styles.metaRule)} />
                    <span {...stylex.props(styles.metaWho)}>{origin}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              data-testid="formula-revision"
              data-revision={item.revisionNo}
              aria-current={here ? 'true' : undefined}
              aria-label={format(m.versionOpen)}
              title={format(m.versionOpen)}
              onClick={() => {
                onView({ kind: 'revision', revisionNo: item.revisionNo })
                onOpenChange(false)
              }}
              {...stylex.props(styles.act, here && styles.actHere)}
            >
              <EyeIcon size={15} aria-hidden />
            </button>
          </li>
        )
      })}
      {revisions.hasNextPage ? (
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
      ) : null}
    </ul>
  )

  const openRelease =
    view.kind === 'release'
      ? releases.find((release) => release.versionNo === view.versionNo)
      : undefined
  const foot =
    view.kind === 'draft' ? null : (
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.footWords)}>
          {format(view.kind === 'release' ? m.releaseReadOnlyHint : m.revisionReadOnlyHint)}
        </span>
        <button
          type="button"
          data-testid="formula-version-restore"
          disabled={archived || restoring}
          onClick={() => {
            if (view.kind === 'release')
              onRestoreRelease({
                versionNo: view.versionNo,
                name:
                  openRelease?.releaseName ?? format(m.releaseOrdinal, { number: view.versionNo }),
              })
            else onRestoreRevision(view.revisionNo)
          }}
          {...stylex.props(styles.restore)}
        >
          {format(m.releaseRestore)}
        </button>
        {openRelease === undefined ? null : (
          <ReleaseInfoPopover release={openRelease} label={format(m.releaseDetails)} />
        )}
      </div>
    )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={narrow ? 'bottom' : 'right'}
        xstyle={narrow ? styles.panelPhone : styles.panel}
      >
        <SheetHeader>
          <SheetTitle>{format(m.historyTitle)}</SheetTitle>
          <SheetDescription>{format(m.versionsHint)}</SheetDescription>
        </SheetHeader>
        <div {...stylex.props(styles.tabs)}>
          <Tabs value={list} onValueChange={(next) => onList(next as HistoryList)}>
            <TabsList aria-label={format(m.historyTitle)} xstyle={styles.tabList}>
              <TabsTrigger value="releases" xstyle={styles.tab}>
                {format(m.historyReleases)}
                <span {...stylex.props(styles.count)}>{releases.length}</span>
              </TabsTrigger>
              <TabsTrigger value="revisions" xstyle={styles.tab}>
                {format(m.historyRevisions)}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span {...stylex.props(w.spring)} />
          {view.kind === 'draft' ? null : (
            <button
              type="button"
              data-testid="formula-history-back"
              onClick={() => {
                onView({ kind: 'draft' })
                onOpenChange(false)
              }}
              {...stylex.props(styles.back)}
            >
              {format(m.backToDraft)}
            </button>
          )}
        </div>
        {list === 'releases' ? releaseList : revisionList}
        {foot}
      </SheetContent>
    </Sheet>
  )
}
