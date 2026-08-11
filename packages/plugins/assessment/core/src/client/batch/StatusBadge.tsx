import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { assessmentMessages as m } from '../i18n.ts'

/**
 * Where a batch stands, said the same way in the list and on the batch itself.
 *
 * Four words for three stored values: a batch that has promised to start but
 * has not arrived there yet is neither a draft nor under way, and calling it
 * "in progress" while nobody can do anything in it reads as a bug. It is the
 * absence of a current phase that says so, which is also what makes the batch
 * invisible to participants.
 */
export function StatusBadge({
  status,
  currentPhaseId = null,
}: {
  status: 'draft' | 'active' | 'archived'
  currentPhaseId?: string | null
}) {
  const { format } = useI18n()
  if (status === 'draft') return <Badge variant="outline">{format(m.statusDraft)}</Badge>
  if (status === 'archived') return <Badge variant="secondary">{format(m.statusArchived)}</Badge>
  if (currentPhaseId === null) return <Badge variant="outline">{format(m.statusPending)}</Badge>
  return <Badge>{format(m.statusActive)}</Badge>
}
