import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { HistoryIcon, UploadIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DetailSheet } from '@qualy/ui/screen'
import { useLingering } from '@qualy/ui/use-lingering'
import type { UsersPageActionsContext } from '@qualy/ui-contract'
import { directoryImportMessages as m } from './i18n.ts'
import { ImportRecordSheet } from './ImportRecord.tsx'
import { ImportRecords, ImportWizard } from './ImportWizard.tsx'

// Importing people, from the roster and without leaving it.
//
// The import itself is a task with an end, so it is a dialog over the page
// it adds to. What was imported before is reference, so it is a sheet at the
// side - and one record opens as a second sheet over the list it was picked
// from, which is still there when the record is put away.

const styles = stylex.create({
  actions: { display: 'inline-flex', alignItems: 'center', gap: 8 },
})

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
    <span {...stylex.props(styles.actions)}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setListing(true)}
        data-testid="import-records-open"
      >
        <HistoryIcon aria-hidden />
        {format(m.recordsTitle)}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setRound((now) => now + 1)
          setImporting(true)
        }}
      >
        <UploadIcon aria-hidden />
        {format(m.action)}
      </Button>

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

      <DetailSheet
        open={listing}
        onClose={() => setListing(false)}
        title={format(m.recordsTitle)}
        closeLabel={format(m.recordClose)}
        testId="import-records-sheet"
      >
        <ImportRecords onOpen={setRecordId} />
      </DetailSheet>

      {shown !== null && (
        <ImportRecordSheet
          key={shown}
          importId={shown}
          open={recordId !== null}
          onClose={() => setRecordId(null)}
        />
      )}
    </span>
  )
}
