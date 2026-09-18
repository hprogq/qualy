import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { useApiQuery, usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { PageHeader } from '@qualy/ui/admin'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { useBatchLive } from '../live.ts'
import { BatchBanner, BatchScreen } from '../batch/BatchScreen.tsx'
import type { BatchDto } from '../phase/model.ts'
import { AdministrativeEntryList } from './AdministrativeEntryList.tsx'
import { ManualRecordView } from './ManualRecordView.tsx'
import { AdministrativeEntrySheet } from './AdministrativeEntrySheet.tsx'
import { AdministrativeImportView } from './import/AdministrativeImportView.tsx'
import { AdministrativeImportHistory } from './import/AdministrativeImportHistory.tsx'
import { AdministrativeImportDetail } from './import/AdministrativeImportDetail.tsx'

// The administrative record book, and the things done to it.
//
// It opens on what has already been decided rather than on a blank form:
// somebody arriving here asks "what has been recorded", and a form answers a
// different question. The imports are the book's other index - the same
// facts, gathered by the file they arrived in.
//
// Recording one, importing a file and reading one import are each a level
// down inside this same page. The address says which, and the browser's back
// button is the way out, because each is too much to put in a dialog and
// too little to be a second section of the rail. Which claim is open lives
// in the address too, so a reload and a shared link both land where the
// reader was.

const styles = stylex.create({
  grow: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  // sized like the line of prose it sits in rather than like a control: a
  // button at a control's own height makes the band taller than the heading
  // it took over
  backButton: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusSm,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    padding: 2,
    marginInlineEnd: 4,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  backIcon: { width: 14, height: 14 },
  tabs: { paddingBottom: 12 },
  actions: { display: 'flex', gap: 8 },
})

/** how deep the screen is, so the drill knows which way it moved */
const depthOf = (view: string) => (view === 'records' || view === 'imports' ? 0 : 1)

export default function AdministrativeRecordsPage() {
  const { format } = useI18n()
  // Which part of the page is showing, and which claim is open over it.
  // Everything that is somewhere to come back FROM pushes.
  const [tab] = usePageQueryState('tab', '', { history: 'push' })
  const [mode] = usePageQueryState('mode', '', { history: 'push' })
  const [importId] = usePageQueryState('import', '', { history: 'push' })
  const [entryId] = usePageQueryState('entry', '', { history: 'push' })
  const address = usePageQueryUpdate()

  const view =
    mode === 'manual'
      ? 'manual'
      : mode === 'import'
        ? 'import'
        : importId !== ''
          ? `detail:${importId}`
          : tab === 'imports'
            ? 'imports'
            : 'records'
  // kept mounted while the sheet shuts, or it would vanish rather than close;
  // absent entirely when nothing is open, so a page nobody has drilled into
  // asks for nothing
  const openEntry = useLingering(entryId === '' ? null : entryId)
  // which way the screen last moved, worked out from where it was rather
  // than recorded at each press
  const [seen, setSeen] = useState(view)
  // a tab is a sideways step and does not slide; a level down or up does
  const move: DrillMove =
    depthOf(view) === depthOf(seen) ? 'none' : depthOf(view) > depthOf(seen) ? 'in' : 'out'
  if (seen !== view) setSeen(view)

  const top = view === 'records' || view === 'imports'

  return (
    <BatchScreen
      title={format(m.recordTab)}
      description={format(m.recordHint)}
      banner={top ? 'section' : 'open'}
      actions={
        top ? (
          <div {...stylex.props(styles.actions)}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => address({ mode: 'import' }, { history: 'push' })}
            >
              {format(m.importAction)}
            </Button>
            <Button size="sm" onClick={() => address({ mode: 'manual' }, { history: 'push' })}>
              {format(m.recordNewAction)}
            </Button>
          </div>
        ) : null
      }
    >
      {(batch) => (
        <RecordsBody
          batch={batch}
          view={view}
          move={move}
          top={top}
          openEntry={openEntry}
          entryId={entryId}
          address={address}
        />
      )}
    </BatchScreen>
  )
}

function RecordsBody({
  batch,
  view,
  move,
  top,
  openEntry,
  entryId,
  address,
}: {
  batch: BatchDto
  view: string
  move: DrillMove
  top: boolean
  openEntry: string | null
  entryId: string
  address: ReturnType<typeof usePageQueryUpdate>
}) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  // where the back press goes: out of a form to the book, out of one import
  // to the imports it was opened from
  const back: {
    /** what the band says while this is open */
    title: MessageDescriptor
    /** where pressing the arrow lands, said for a reader who cannot see it */
    from: MessageDescriptor
    label: MessageDescriptor
    to: Record<string, string>
  } =
    view === 'manual'
      ? { title: m.recordNewAction, from: m.recordTab, label: m.recordBack, to: { mode: '' } }
      : view === 'import'
        ? { title: m.importAction, from: m.recordTab, label: m.recordBack, to: { mode: '' } }
        : {
            title: m.importDetailTitle,
            from: m.importTab,
            label: m.importBack,
            to: { import: '', tab: 'imports' },
          }

  // What somebody else just recorded, imported or withdrew in this round
  // moves the book and the imports' standing; nothing else on this page
  // listens for it.
  useBatchLive(batch.id, (kind) => {
    if (kind !== 'sync' && kind !== 'entries-changed') return
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listAdministrativeEntries.key({
        params: { batchId: batch.id },
        query: {},
      }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listAdministrativeImports.key({
        params: { batchId: batch.id },
        query: {},
      }),
    })
    void queryClient.invalidateQueries({ queryKey: query.assessment.getAdministrativeImport.key() })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listAdministrativeImportRows.key(),
    })
  })

  if (!batch.capabilities.record) {
    return <p {...stylex.props(styles.quiet)}>{format(m.recordNoStanding)}</p>
  }

  return (
    <>
      <Drill
        move={move}
        drillKey={top ? 'top' : view}
        className={stylex.props(styles.grow).className}
      >
        {top ? (
          <div>
            <Tabs
              value={view}
              onValueChange={(next) =>
                address({ tab: next === 'imports' ? 'imports' : '' }, { history: 'replace' })
              }
              xstyle={styles.tabs}
            >
              <TabsList>
                <TabsTrigger value="records">{format(m.recordListTab)}</TabsTrigger>
                <TabsTrigger value="imports">{format(m.importTab)}</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === 'imports' ? (
              <AdministrativeImportHistory
                batchId={batch.id}
                onOpen={(id) => address({ import: id }, { history: 'push' })}
                onImport={() => address({ mode: 'import' }, { history: 'push' })}
              />
            ) : (
              <AdministrativeEntryList
                batchId={batch.id}
                onOpen={(id) => address({ entry: id }, { history: 'push' })}
                onRecord={() => address({ mode: 'manual' }, { history: 'push' })}
              />
            )}
          </div>
        ) : (
          <div>
            {/* the band says where the reader is and how to leave; the
                content area below it is only what they came to do */}
            <BatchBanner>
              <PageHeader
                variant="banner"
                title={format(back.title)}
                description={
                  <>
                    {/* text-sized rather than a control's own size: a button
                        as tall as a button in a line of prose makes that line
                        taller than the same line in the heading it took over,
                        and the band would jump on the way in */}
                    <button
                      type="button"
                      aria-label={format(back.label)}
                      onClick={() => address(back.to)}
                      {...stylex.props(styles.backButton)}
                    >
                      <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
                    </button>
                    <span {...stylex.props(styles.truncate)}>{format(back.from)}</span>
                  </>
                }
              />
            </BatchBanner>
            {view === 'manual' ? (
              <ManualRecordView batchId={batch.id} materialRange={batch.materialRange} />
            ) : view === 'import' ? (
              <AdministrativeImportView
                batchId={batch.id}
                // the import just made is where the reader goes next, and the
                // wizard is not somewhere to come back to
                onImported={(id) =>
                  address({ mode: '', tab: 'imports', import: id }, { history: 'replace' })
                }
              />
            ) : (
              <AdministrativeImportDetail
                batchId={batch.id}
                importId={view.slice('detail:'.length)}
                onOpenEntry={(id) => address({ entry: id }, { history: 'push' })}
              />
            )}
          </div>
        )}
      </Drill>
      {/* one claim, read and corrected over whichever part is showing: the
          siblings around it are the context it is read against */}
      {openEntry !== null && (
        <AdministrativeEntrySheet
          key={openEntry}
          open={entryId !== ''}
          batchId={batch.id}
          entryId={openEntry}
          onClose={() => address({ entry: '' })}
          onOpenImport={(id) =>
            address({ entry: '', mode: '', tab: 'imports', import: id }, { history: 'push' })
          }
          onFailed={(reason) => {
            // said out loud, and the address that named it let go of: a link
            // to a record this reader cannot open should not keep re-opening
            // nothing every time the page draws
            toast.error(reason)
            address({ entry: '' })
          }}
        />
      )}
    </>
  )
}
