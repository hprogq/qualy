import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, DownloadIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { useApiQuery, usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { PageHeader, BannerBack } from '@qualy/ui/admin'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { useBatchLive } from '../live.ts'
import { BatchBanner, BatchScreen } from '../batch/BatchScreen.tsx'
import type { BatchDto } from '../phase/model.ts'
import { AdministrativeActDetail } from './AdministrativeActDetail.tsx'
import { AdministrativeActHistory } from './AdministrativeActHistory.tsx'
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

const wide = '@media (min-width: 900px)'

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
  // Sized to the line it sits in, not to itself. The description slot is one
  // 1.25rem line of 0.875rem text; a control with its own padding makes that
  // line taller, and the band visibly grows the moment somebody opens a
  // sub-screen. So: no vertical padding, the same font and line-height as
  // the prose around it, and the hover ground drawn outside the flow.
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tabs: { paddingBottom: 12 },
  // One band: what to look at, what to search, what to do. The actions used
  // to sit up in the page header, a whole banner away from the tabs - so a
  // reader on the imports tab was offered "record one" as the main action of
  // a screen they were not on.
  // Wide, one line: tabs, search, actions. Narrow there is not room for
  // all three, and the thing that must not be pushed off is the pair of
  // actions - a screen whose main verbs have wrapped below the fold looks
  // like a screen that cannot do anything. So the search drops to a line of
  // its own and the tabs keep the actions company.
  band: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) auto', [wide]: 'max-content 1fr max-content' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 10,
    paddingBottom: 12,
  },
  tabSeat: { gridColumnStart: 1, gridRowStart: 1, minWidth: 0 },
  bandTabs: { paddingBottom: 0 },
  searchSeat: {
    position: 'relative',
    gridColumn: { default: '1 / span 2', [wide]: '2' },
    gridRowStart: { default: 2, [wide]: 1 },
    justifySelf: { default: 'stretch', [wide]: 'end' },
    minWidth: 0,
    width: { default: 'auto', [wide]: 'min(22rem, 100%)' },
  },
  searchGlass: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  searchIndent: { paddingLeft: 36 },
  actions: {
    display: 'flex',
    gridColumnStart: { default: 2, [wide]: 3 },
    gridRowStart: 1,
    flexShrink: 0,
    justifyContent: 'flex-end',
    gap: 8,
  },
  icon: { width: 15, height: 15 },
  // tall enough to hold a form without the panel growing past the window,
  // and scrolling inside rather than out
  // As tall as it needs up to a ceiling, and no taller. A fixed height left
  // a short first step floating in the middle of an empty panel; an
  // unbounded one moved the footer every time the form grew. The body
  // scrolls when it reaches the ceiling, and its content starts at the top
  // rather than being centred in whatever is left.
  // the errand's own bands carry the side padding, so the rule above its
  // keys can run the full width of the panel
  // A floor as well as a ceiling. The first step cannot draw until the
  // questions arrive, and a panel sized to nothing folds shut and reopens
  // the moment they do - so it holds a spinner at the size it is about to
  // be. The floor sits under every step's natural height, so nothing
  // rattles around in it once there is something to show.
  errandPanel: {
    minHeight: 'min(70vh, 26rem)',
    maxHeight: 'min(86vh, 52rem)',
    paddingInline: 0,
  },
  errandHead: { paddingInline: 24 },
  // The errand inside runs its own three moves and scrolls only the middle
  // one, so this slot hands its height over rather than scrolling: two
  // scrollbars for one panel would put the step rail and the pair of keys
  // out of reach exactly when a long form needs them.
  // minWidth as well as minHeight: a grid item sized by `auto` is at least
  // as wide as its own min-content, and one band inside that refuses to
  // shrink makes the whole panel scroll sideways
  errandBody: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexDirection: 'column',
    // the slot's own bleed is given back: the room a focus ring needs is
    // inside the errand's bands now, and 4px hanging off each side of a
    // panel that no longer pads sideways is 4px of sideways scrolling
    margin: 0,
    padding: 0,
  },
})

/** the three indexes of one book: by fact, by act, by file */
const TOP = ['records', 'acts', 'imports']

/** how deep the screen is, so the drill knows which way it moved */
const depthOf = (view: string) => (TOP.includes(view) ? 0 : 1)

export default function AdministrativeRecordsPage() {
  const { format } = useI18n()
  // Which part of the page is showing, and which claim is open over it.
  // Everything that is somewhere to come back FROM pushes.
  const [tab] = usePageQueryState('tab', '', { history: 'push' })
  const [mode] = usePageQueryState('mode', '', { history: 'push' })
  const [importId] = usePageQueryState('import', '', { history: 'push' })
  const [actId] = usePageQueryState('act', '', { history: 'push' })
  const [entryId] = usePageQueryState('entry', '', { history: 'push' })
  const address = usePageQueryUpdate()

  // Recording and importing are errands, not places. They open over the book
  // rather than replacing it, so finishing one puts the reader back exactly
  // where they were - with the list behind already showing what they did.
  const doing = mode === 'manual' ? 'manual' : mode === 'import' ? 'import' : null
  const view =
    importId !== ''
      ? `detail:${importId}`
      : actId !== ''
        ? `act:${actId}`
        : tab === 'acts'
          ? 'acts'
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

  const top = TOP.includes(view)

  return (
    <BatchScreen
      title={format(m.recordTab)}
      description={format(m.recordHint)}
      banner={top ? 'section' : 'open'}
    >
      {(batch) => (
        <RecordsBody
          batch={batch}
          view={view}
          move={move}
          top={top}
          doing={doing}
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
  doing,
  openEntry,
  entryId,
  address,
}: {
  batch: BatchDto
  view: string
  move: DrillMove
  top: boolean
  /** the errand open over the book, if one is */
  doing: 'manual' | 'import' | null
  openEntry: string | null
  entryId: string
  address: ReturnType<typeof usePageQueryUpdate>
}) {
  const { format } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  // kept while the dialog shuts, or its contents would vanish before the
  // panel does and the whole thing would fold inward
  const errand = useLingering(doing)
  // where the back press goes: out of a form to the book, out of one import
  // to the imports it was opened from
  const back: {
    /** what the band says while this is open */
    title: MessageDescriptor
    /** where pressing the arrow lands, said for a reader who cannot see it */
    from: MessageDescriptor
    label: MessageDescriptor
    to: Record<string, string>
  } = view.startsWith('act:')
    ? {
        title: m.recordActDetailTitle,
        from: m.recordActsTab,
        label: m.recordActBack,
        to: { act: '', tab: 'acts' },
      }
    : {
        title: m.importDetailHeading,
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
            <div {...stylex.props(styles.band)}>
              <div {...stylex.props(styles.tabSeat)}>
                <Tabs
                  value={view}
                  onValueChange={(next) =>
                    address({ tab: next === 'records' ? '' : next }, { history: 'replace' })
                  }
                  xstyle={styles.bandTabs}
                >
                  <TabsList>
                    <TabsTrigger value="records">{format(m.recordListTab)}</TabsTrigger>
                    <TabsTrigger value="acts">{format(m.recordActsTab)}</TabsTrigger>
                    <TabsTrigger value="imports">{format(m.importTab)}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {/* only the records are searchable: the other two tabs are
                  walked by cursor and have nothing to search on, so drawing
                  a box there would promise something that does not exist */}
              {view === 'records' && (
                <div {...stylex.props(styles.searchSeat)}>
                  <SearchIcon aria-hidden {...stylex.props(styles.searchGlass)} />
                  <Input
                    name="administrative-search"
                    value={search}
                    placeholder={format(m.recordSearchList, { businessNo })}
                    aria-label={format(m.recordSearchList, { businessNo })}
                    onChange={(event) => setSearch(event.target.value)}
                    className={stylex.props(styles.searchIndent).className}
                  />
                </div>
              )}
              <div {...stylex.props(styles.actions)}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => address({ mode: 'import' }, { history: 'push' })}
                >
                  <DownloadIcon aria-hidden {...stylex.props(styles.icon)} />
                  {format(m.importAction)}
                </Button>
                <Button size="sm" onClick={() => address({ mode: 'manual' }, { history: 'push' })}>
                  <PlusIcon aria-hidden {...stylex.props(styles.icon)} />
                  {format(m.recordNewAction)}
                </Button>
              </div>
            </div>
            {view === 'acts' ? (
              <AdministrativeActHistory
                batchId={batch.id}
                onOpen={(id) => address({ act: id }, { history: 'push' })}
              />
            ) : view === 'imports' ? (
              <AdministrativeImportHistory
                batchId={batch.id}
                onOpen={(id) => address({ import: id }, { history: 'push' })}
                onImport={() => address({ mode: 'import' }, { history: 'push' })}
              />
            ) : (
              <AdministrativeEntryList
                batchId={batch.id}
                search={search}
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
                  // One pressable sentence rather than an arrow with a label
                  // beside it: the arrow alone made the reader guess where it
                  // goes, and only the arrow was a target. Text-sized, so the
                  // band is the same height going in as coming out.
                  <BannerBack label={format(back.label)} onBack={() => address(back.to)} />
                }
              />
            </BatchBanner>
            {view.startsWith('act:') ? (
              <AdministrativeActDetail
                batchId={batch.id}
                operationId={view.slice('act:'.length)}
                onOpenEntry={(id) => address({ entry: id }, { history: 'push' })}
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
      {/* An errand, opened over the book. Closing it leaves the reader on the
          tab they started from, which is the whole difference between this
          and a sub-screen: nothing to navigate back out of. */}
      <Dialog
        open={doing !== null}
        onOpenChange={(open) => {
          if (!open) address({ mode: '' })
        }}
      >
        <DialogContent size="46rem" xstyle={styles.errandPanel}>
          <DialogHeader className={stylex.props(styles.errandHead).className}>
            <DialogTitle>
              {format(errand === 'import' ? m.importAction : m.recordNewAction)}
            </DialogTitle>
            <DialogDescription>
              {format(errand === 'import' ? m.importDialogHint : m.recordDialogHint)}
            </DialogDescription>
          </DialogHeader>
          <DialogBody xstyle={styles.errandBody}>
            {errand === 'manual' && (
              <ManualRecordView
                batchId={batch.id}
                materialRange={batch.materialRange}
                onDone={() => address({ mode: '' })}
              />
            )}
            {errand === 'import' && (
              <AdministrativeImportView
                batchId={batch.id}
                // the import just made is where the reader goes next, and
                // the errand is not somewhere to come back to
                onImported={(id) =>
                  address({ mode: '', tab: 'imports', import: id }, { history: 'replace' })
                }
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

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
          onOpenAct={(id) =>
            address({ entry: '', mode: '', tab: 'acts', act: id }, { history: 'push' })
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
