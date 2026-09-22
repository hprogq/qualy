import { useState } from 'react'
import { HistoryIcon, UploadIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { BandAction } from '@qualy/ui/screen'
import { useLingering } from '@qualy/ui/use-lingering'
import type { UsersPageActionsContext } from '@qualy/ui-contract'
import { directoryImportMessages as m } from './i18n.ts'
import { ImportRecordSheet } from './ImportRecord.tsx'
import { ImportRecords } from './ImportRecords.tsx'
import { ImportWizard } from './ImportWizard.tsx'

// Importing people, from the roster and without leaving it.
//
// The import itself is a task with an end, so it runs in a panel over the
// page it adds to. What was imported before is a list to look through, which
// is the same panel with a table in it; one record opens as a sheet beside
// it, and the list is still there when the record is put away.

export default function ImportUsersAction({ context }: { context: UsersPageActionsContext }) {
  const { format } = useI18n()
  const [importing, setImporting] = useState(false)
  const [listing, setListing] = useState(false)
  const [recordId, setRecordId] = useState<string | null>(null)
  // the record keeps drawing what it showed while its sheet slides away
  const shown = useLingering(recordId)
  // a fresh wizard each time the panel opens: a half-mapped file from the
  // last visit is not where anybody expects to start
  const [round, setRound] = useState(0)
  const startImport = () => {
    setRound((now) => now + 1)
    setListing(false)
    setImporting(true)
  }

  return (
    // No seat of its own: in the band these are two of its actions and it
    // spaces them; in the menu they are two of its rows, and a seat between
    // them put both on one row.
    <>
      <BandAction
        testId="import-records-open"
        icon={<HistoryIcon aria-hidden />}
        onSelect={() => setListing(true)}
      >
        {format(m.recordsTitle)}
      </BandAction>
      <BandAction variant="outline" icon={<UploadIcon aria-hidden />} onSelect={startImport}>
        {format(m.action)}
      </BandAction>

      <ImportWizard
        key={round}
        open={importing}
        anchorNodeId={context.anchorNodeId}
        onClose={() => setImporting(false)}
        onOpenRecord={(importId) => {
          setImporting(false)
          setRecordId(importId)
        }}
      />

      <ImportRecords
        open={listing}
        onClose={() => setListing(false)}
        onOpen={setRecordId}
        onImport={startImport}
      />

      {shown !== null && (
        <ImportRecordSheet
          key={shown}
          importId={shown}
          open={recordId !== null}
          onClose={() => setRecordId(null)}
        />
      )}
    </>
  )
}
