import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'

// One line saying something changed, and the button that opens it.
//
// The changes themselves can run to thousands of rows, so they are not what a
// reader meets on arrival: the subject of this page is the people working on
// the batch, and it has to start at the top of the screen.

export function AccessSyncNotice({
  pendingTotal,
  lapsedTotal,
  onOpen,
}: {
  pendingTotal: number
  lapsedTotal: number
  onOpen: () => void
}) {
  const { format } = useI18n()
  if (pendingTotal === 0 && lapsedTotal === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3',
        // amber only while somebody still has to decide something; a standing
        // fact must not wear the colour of an alarm that never clears
        pendingTotal > 0 ? 'border-amber-500/40 bg-amber-500/8' : 'bg-muted/40',
      )}
    >
      <p className="text-sm">
        {format(pendingTotal > 0 ? m.accessSyncPrompt : m.accessSyncLapsedPrompt)}
      </p>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {format(m.accessSyncOpen)}
      </Button>
    </div>
  )
}
