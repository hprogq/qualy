import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'

// The clause a section or a question is scored against.
//
// Reserved, not written: nothing in the round carries the wording yet, so
// the block holds its place and says what will stand here rather than
// leaving the pane to be rebuilt around it later.

export function Basis({ compact = false }: { compact?: boolean }) {
  const { format } = useI18n()
  return (
    <section
      className={cn('flex flex-col gap-2 rounded-xl bg-muted/60', compact ? 'p-3.5' : 'p-4')}
    >
      <p className="text-sm font-semibold">{format(m.myEntriesBasis)}</p>
      <p className="border-l-2 border-muted-foreground/30 pl-3 text-sm leading-relaxed text-pretty text-muted-foreground">
        {format(m.myEntriesBasisSoon)}
      </p>
    </section>
  )
}
