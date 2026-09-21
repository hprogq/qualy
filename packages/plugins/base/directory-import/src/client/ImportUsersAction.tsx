import { useState } from 'react'
import { HistoryIcon, UploadIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { FormDialog } from '@qualy/ui/admin'
import { BandAction } from '@qualy/ui/screen'
import { useLingering } from '@qualy/ui/use-lingering'
import type { UsersPageActionsContext } from '@qualy/ui-contract'
import { directoryImportMessages as m } from './i18n.ts'
import { ImportRecordSheet } from './ImportRecord.tsx'
import { ImportRecords, ImportWizard } from './ImportWizard.tsx'

// Importing people, from the roster and without leaving it.
//
// The import itself is a task with an end, so it is a dialog over the page
// it adds to. What was imported before is a list to look through, which is
// also a dialog; one record opens as a sheet beside it, and the list is still
// there when the record is put away.

export default function ImportUsersAction({ context }: { context: UsersPageActionsContext }) {
  const { format } = useI18n()
  const [importing, setImporting] = useState(false)
  const [listing, setListing] = useState(false)
  const [recordId, setRecordId] = useState<string | null>(null)
  // the record keeps drawing what it showed while its sheet slides away
  const shown = useLingering(recordId)
  // a fresh wizard each time the dialog opens: a half-mapped file from the
  // last visit is not where anybody expects to start
  const [round, setRound] = useState(0)

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
      <BandAction
        variant="outline"
        icon={<UploadIcon aria-hidden />}
        onSelect={() => {
          setRound((now) => now + 1)
          setImporting(true)
        }}
      >
        {format(m.action)}
      </BandAction>

      <FormDialog
        open={importing}
        size="wide"
        title={format(m.title)}
        description={format(m.hint)}
        onClose={() => setImporting(false)}
      >
        <ImportWizard
          key={round}
          anchorNodeId={context.anchorNodeId}
          onOpenRecord={(importId) => {
            setImporting(false)
            setRecordId(importId)
          }}
        />
      </FormDialog>

      <FormDialog
        open={listing}
        size="wide"
        title={format(m.recordsTitle)}
        onClose={() => setListing(false)}
      >
        <ImportRecords onOpen={setRecordId} />
      </FormDialog>

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
