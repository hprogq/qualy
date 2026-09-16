import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon } from 'lucide-react'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AdministrativeEntryList } from './AdministrativeEntryList.tsx'
import { ManualRecordView } from './ManualRecordView.tsx'
import { AdministrativeEntrySheet } from './AdministrativeEntrySheet.tsx'

// The administrative record book, and the two things done to it.
//
// It opens on what has already been decided rather than on a blank form:
// somebody arriving here asks "what has been recorded", and a form answers a
// different question. Recording one is a level down inside this same page -
// the address says so, the browser's back button is the way out - because
// the form is too much to put in a dialog and too little to be a second
// section of the rail.
//
// Which claim is open lives in the address too, so a reload and a shared
// link both land where the reader was.

const styles = stylex.create({
  grow: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  head: { display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12 },
  backIcon: { width: 14, height: 14 },
})

export default function AdministrativeRecordsPage() {
  const { format } = useI18n()
  // Which half of the page is showing, and which claim is open over it.
  // Opening the form is somewhere to come back FROM; opening a claim is
  // somewhere to come back from too - both push.
  const [mode] = usePageQueryState('mode', '', { history: 'push' })
  const [entryId] = usePageQueryState('entry', '', { history: 'push' })
  const address = usePageQueryUpdate()
  const manual = mode === 'manual'
  // which way the screen last moved, worked out from where it was rather
  // than recorded at each press
  // kept mounted while the sheet shuts, or it would vanish rather than close;
  // absent entirely when nothing is open, so a page nobody has drilled into
  // asks for nothing
  const openEntry = useLingering(entryId === '' ? null : entryId)
  const [seen, setSeen] = useState(mode)
  const move: DrillMove = seen === mode ? 'none' : manual ? 'in' : 'out'
  if (seen !== mode) setSeen(mode)

  return (
    <BatchScreen
      title={format(m.recordTab)}
      description={format(m.recordHint)}
      actions={
        manual ? null : (
          <Button size="sm" onClick={() => address({ mode: 'manual' }, { history: 'push' })}>
            {format(m.recordNewAction)}
          </Button>
        )
      }
    >
      {(batch) =>
        batch.capabilities.record ? (
          <>
            <Drill
              move={move}
              drillKey={manual ? 'manual' : 'records'}
              className={stylex.props(styles.grow).className}
            >
              {manual ? (
                <div>
                  <div {...stylex.props(styles.head)}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => address({ mode: '' })}
                      aria-label={format(m.recordBack)}
                    >
                      <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
                      {format(m.recordBack)}
                    </Button>
                  </div>
                  <ManualRecordView batchId={batch.id} materialRange={batch.materialRange} />
                </div>
              ) : (
                <AdministrativeEntryList
                  batchId={batch.id}
                  onOpen={(id) => address({ entry: id }, { history: 'push' })}
                />
              )}
            </Drill>
            {/* one claim, read and corrected over whichever half is showing:
                the siblings around it are the context it is read against */}
            {openEntry !== null && (
              <AdministrativeEntrySheet
                key={openEntry}
                open={entryId !== ''}
                batchId={batch.id}
                entryId={openEntry}
                onClose={() => address({ entry: '' })}
              />
            )}
          </>
        ) : (
          <p {...stylex.props(styles.quiet)}>{format(m.recordNoStanding)}</p>
        )
      }
    </BatchScreen>
  )
}
