import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { assessmentMessages as m } from '../i18n.ts'

/** a batch's lifecycle, said the same way in the list and on the batch itself */
export function StatusBadge({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const { format } = useI18n()
  if (status === 'draft') return <Badge variant="outline">{format(m.statusDraft)}</Badge>
  if (status === 'active') return <Badge>{format(m.statusActive)}</Badge>
  return <Badge variant="secondary">{format(m.statusArchived)}</Badge>
}
