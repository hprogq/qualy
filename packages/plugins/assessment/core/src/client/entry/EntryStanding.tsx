import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import { entryStatusMessage, type EntryDto } from './model.ts'

/**
 * Where a claim stands, as a dot and a word.
 *
 * The dot carries the weight: filled and dark for what counts, hollow for a
 * draft nobody has been handed yet, red for whatever is waiting on the
 * reader. The pill's own edge follows, so a card can be read across the pane
 * without reading the word. One component for the card and the drawer, so
 * the two can never call the same claim two different things.
 */
export function EntryStanding({
  status,
  revised,
  asked,
}: {
  status: EntryDto['status']
  revised?: boolean
  /** a reviewer is waiting for material, which outranks "in review" */
  asked?: boolean
}) {
  const { format } = useI18n()
  const word =
    asked === true
      ? m.entryStatusAwaitingSupplement
      : status === 'draft' && revised === true
        ? // a draft with a round behind it is not a fresh draft: it exists
          // because something was asked of it
          m.entryStatusRevising
        : entryStatusMessage[status]
  const alert = asked === true || status === 'rejected' || status === 'needs_revision'
  const hollow = status === 'draft' && asked !== true
  return (
    <span
      // the standing itself, beside the word for it: a test about what a
      // claim is doing asks this, not the sentence the word happens to be
      data-testid="entry-standing"
      data-entry-standing={asked === true ? 'awaiting_supplement' : status}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap',
        alert && 'border-destructive/35 text-destructive',
        hollow && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          hollow
            ? 'border border-muted-foreground/50'
            : alert
              ? 'bg-destructive'
              : status === 'approved'
                ? 'bg-foreground'
                : 'bg-muted-foreground/60',
        )}
      />
      {format(word)}
    </span>
  )
}
