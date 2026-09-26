import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { AccessPanel } from './access/AccessPanel.tsx'
import { assessmentMessages as m } from './i18n.ts'

/**
 * Who may work on one batch, and what it accepted of their authority.
 *
 * Wide: at a desk a person's roles, where each is held and six capabilities
 * share one row, and a reading column left the roles a quarter of it.
 */
export default function BatchAccessPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabAccess)} description={format(m.accessHint)} size="wide">
      {(batch) => <AccessPanel batchId={batch.id} archived={batch.status === 'archived'} />}
    </BatchScreen>
  )
}
