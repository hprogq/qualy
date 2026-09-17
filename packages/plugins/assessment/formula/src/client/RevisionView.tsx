import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Spinner } from '@qualy/ui/spinner'
import { downloadText, fileNameOf } from '@qualy/ui/download'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { DownloadIcon, HistoryIcon, MoreHorizontalIcon, Undo2Icon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { fullWhen } from './library-styles.ts'
import { inputSummaryOf } from './report-words.ts'
import { SourceView } from './SourceView.tsx'
import { SideHead, WorkbenchBar, WorkbenchLayout } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

// One saved state of the draft, as it was saved: its source and its examples,
// read-only. Restoring it does not rewind anything - it becomes the draft's
// newest revision, naming this one as where it came from.

const styles = stylex.create({
  info: { display: 'flex', flexDirection: 'column', gap: 8, paddingInline: 16, paddingBottom: 14 },
  infoFact: { display: 'flex', gap: 10, fontSize: 12.5 },
  infoLabel: { flexShrink: 0, width: '4.5rem', color: tokens.mutedForeground },
  infoValue: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  loading: {
    display: 'flex',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  gateText: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
})

export function RevisionView({
  functionId,
  functionName,
  revisionNo,
  draftRevision,
  archived,
  narrow,
  titleRef,
  history,
  onBack,
  onRestore,
  restoring,
}: {
  readonly functionId: string
  readonly functionName: string
  readonly revisionNo: number
  /** the revision the draft is at now: restoring it would change nothing */
  readonly draftRevision: number
  readonly archived: boolean
  readonly narrow: boolean
  readonly titleRef: (node: HTMLElement | null) => void
  readonly history: ReactNode
  readonly onBack: () => void
  readonly onRestore: (revisionNo: number) => void
  readonly restoring: boolean
}) {
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()
  const [panelTab, setPanelTab] = useState('examples')
  const [phoneTab, setPhoneTab] = useState('source')

  const detail = useQuery(
    query.assessmentFormula.getFormulaDraftRevision.queryOptions({
      params: { functionId, revisionNo: String(revisionNo) },
    }),
  )
  const revision = detail.data?.revision
  const current = revisionNo === draftRevision
  const label = format(m.revisionNumber, { number: revisionNo })

  const download = () => {
    if (revision === undefined) return
    downloadText({
      filename: fileNameOf([functionName, label], '.ts'),
      text: revision.sourceTs,
      type: 'text/typescript;charset=utf-8',
    })
  }

  const origin = (): string => {
    if (revision === undefined) return ''
    switch (revision.origin) {
      case 'created':
        return format(m.revisionCreated)
      case 'saved':
        return format(m.revisionSaved)
      case 'copied-from-template':
        return format(m.revisionCopied)
      case 'migration':
        return format(m.revisionMigration)
      case 'restored-from-version':
        return format(m.revisionRestoredRelease, {
          name:
            revision.sourceVersion === null
              ? ''
              : (revision.sourceVersion.releaseName ??
                format(m.releaseOrdinal, { number: revision.sourceVersion.versionNo })),
        })
      case 'restored-from-draft':
        return format(m.revisionRestoredRevision, { number: revision.sourceDraftRevisionNo ?? 0 })
    }
  }

  const pending = (
    <div role="status" {...stylex.props(styles.loading)}>
      {detail.isError ? (
        <EmptyRow role="alert">{formatError(detail.error)}</EmptyRow>
      ) : (
        <Spinner aria-label={format(m.editorLoading)} />
      )}
    </div>
  )

  const source =
    revision === undefined ? (
      pending
    ) : revision.sourceTs === '' ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.revisionEmptySource)}</EmptyRow>
      </div>
    ) : (
      <>
        <div {...stylex.props(w.paneHead)}>
          <span {...stylex.props(w.paneLabel)}>{format(m.revisionSource)}</span>
          <span {...stylex.props(w.spring)} />
          <span {...stylex.props(w.paneNote)}>{format(m.readOnly)}</span>
        </div>
        <SourceView
          source={revision.sourceTs}
          data-testid="formula-revision-source"
          aria-label={format(m.revisionSource)}
          xstyle={w.paneSource}
        />
      </>
    )

  const facts =
    revision === undefined ? null : (
      <dl {...stylex.props(styles.info)} data-testid="formula-revision-info">
        {(
          [
            [m.revisionLabel, label],
            [m.revisionSavedAt, fullWhen(revision.savedAt, locale)],
            [m.revisionSavedBy, revision.savedByName ?? format(m.templatesAuthorUnknown)],
            [m.revisionOrigin, origin()],
          ] as const
        ).map(([name, value]) => (
          <div key={name.id} {...stylex.props(styles.infoFact)}>
            <dt {...stylex.props(styles.infoLabel)}>{format(name)}</dt>
            <dd {...stylex.props(styles.infoValue)}>{value}</dd>
          </div>
        ))}
      </dl>
    )

  const examples =
    revision === undefined ? null : revision.tests.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.revisionNoExamples)}</EmptyRow>
      </div>
    ) : (
      <table data-testid="formula-revision-examples" {...stylex.props(w.reportTable)}>
        <thead>
          <tr>
            <th {...stylex.props(w.reportHead)}>{format(m.testName)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesInputColumn)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesExpectedColumn)}</th>
          </tr>
        </thead>
        <tbody>
          {revision.tests.map((test, index) => (
            <tr key={index}>
              <td {...stylex.props(w.reportCell)}>
                {test.name === '' ? format(m.exampleUnnamed) : test.name}
              </td>
              <td {...stylex.props(w.reportCell, w.wrapMono, w.quiet)}>
                {inputSummaryOf(test.input)}
              </td>
              <td {...stylex.props(w.reportCell, w.mono)}>
                {test.expected === '' ? '—' : test.expected}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )

  const details =
    revision === undefined ? null : (
      <dl {...stylex.props(w.facts)}>
        {(
          [
            [m.revisionOrigin, origin()],
            [m.revisionSavedAt, fullWhen(revision.savedAt, locale)],
            [m.revisionSavedBy, revision.savedByName ?? format(m.templatesAuthorUnknown)],
            [m.envSourceSha, revision.sourceSha256],
          ] as const
        ).map(([name, value]) => (
          <div key={name.id} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{format(name)}</dt>
            <dd {...stylex.props(w.factValue, name === m.envSourceSha && w.wrapMono)}>{value}</dd>
          </div>
        ))}
      </dl>
    )

  const scroll = (node: ReactNode) => <div {...stylex.props(w.panelScroll)}>{node}</div>
  const restoreDisabled = archived || restoring || current || revision === undefined

  return (
    <WorkbenchLayout
      narrow={narrow}
      testId="formula-revision-view"
      status="revision"
      bar={
        <WorkbenchBar
          narrow={narrow}
          backLabel={format(m.listTitle)}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{functionName}</span>}
          badge={
            <span {...stylex.props(w.standing, w.standingOutline)}>
              {format(m.revisionReadOnlyBadge)}
            </span>
          }
          status={
            <>
              <span>{label}</span>
              {current ? <span>{format(m.revisionCurrent)}</span> : null}
            </>
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onBack}>
                <Undo2Icon aria-hidden />
                {format(m.backToDraft)}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={revision === undefined}
                onClick={download}
              >
                <DownloadIcon aria-hidden />
                {format(m.downloadCode)}
              </Button>
              <Button
                size="sm"
                data-testid="formula-revision-restore"
                disabled={restoreDisabled}
                onClick={() => onRestore(revisionNo)}
              >
                <HistoryIcon aria-hidden />
                {format(m.revisionRestore)}
              </Button>
            </>
          }
          phoneMenu={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={format(m.moreActions)}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onBack}>{format(m.backToDraft)}</DropdownMenuItem>
                <DropdownMenuItem disabled={revision === undefined} onSelect={download}>
                  {format(m.downloadCode)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      side={
        <>
          <SideHead title={format(m.revisionInfo)} />
          {facts}
        </>
      }
      history={history}
      panelTabs={[
        {
          value: 'examples',
          label: format(m.testsTitle),
          count: revision?.tests.length ?? 0,
          content: scroll(examples),
        },
        { value: 'details', label: format(m.revisionInfo), content: scroll(details) },
      ]}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={format(m.revisionInfo)}
      phoneTabs={[
        { value: 'source', label: format(m.phoneSourceTab), content: source },
        {
          value: 'examples',
          label: format(m.testsTitle),
          count: revision?.tests.length ?? 0,
          content: examples,
        },
        { value: 'info', label: format(m.revisionInfo), content: details },
        { value: 'history', label: format(m.historyTitle), content: history },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={
        <>
          <span {...stylex.props(styles.gateText)}>{label}</span>
          <Button size="sm" disabled={restoreDisabled} onClick={() => onRestore(revisionNo)}>
            <HistoryIcon aria-hidden />
            {format(m.revisionRestore)}
          </Button>
        </>
      }
    />
  )
}
