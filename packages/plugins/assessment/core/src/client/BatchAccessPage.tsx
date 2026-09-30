import { BatchScreen } from './batch/BatchScreen.tsx'
import { AccessPanel } from './access/AccessPanel.tsx'
import * as m from '#messages'

/**
 * Who may work on one batch, and what it accepted of their authority.
 *
 * Wide: at a desk a person's roles, where each is held and six capabilities
 * share one row, and a reading column left the roles a quarter of it.
 */
export default function BatchAccessPage() {
  return (
    <BatchScreen title={m.access_tab()} description={m.access_hint()} size="wide" requires="manage">
      {(batch) => <AccessPanel batchId={batch.id} archived={batch.status === 'archived'} />}
    </BatchScreen>
  )
}
