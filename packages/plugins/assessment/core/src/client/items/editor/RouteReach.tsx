import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { TriangleAlertIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { UnreachablePeople } from '../../roster/UnreachablePeople.tsx'

// A route that finds some of the roster nowhere, said under the route while
// it is being composed (§32.93).
//
// Every step asks for a kind of unit, and some people on the roster sit
// under none of them: their submission - or their appeal, on the escalation
// route - would be refused, and no appointment mends it. Said in amber and
// not as a fault that holds the save: the route may be right and the roster
// the thing to change, and the two are changed in either order. Who they
// are is a press away, a page at a time.

const styles = stylex.create({
  notice: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
    paddingInline: 12,
    paddingBlock: 8,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 10%, transparent)`,
  },
  words: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '16rem',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.warningForeground,
  },
  icon: { width: 14, height: 14, flexShrink: 0, marginTop: 2 },
})

/** the unit kinds a route asks for, and the round they are asked of */
interface Asked {
  readonly batchId: string
  readonly chain: 'normal' | 'escalation'
  readonly levels: readonly string[]
}

/**
 * People per page, as the list in the dialog asks for them: the count is
 * read with the list's own first page, so the list opens on what is already
 * in hand rather than on an outline.
 */
const PER_PAGE = '10'

export function RouteReach(asked: Asked) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const [open, setOpen] = useState(false)
  const shown = useLingering(open ? asked : null)
  // The first page, which is also what the notice counts: one read for
  // both. A reader who may not manage the roster is refused, and is told
  // nothing rather than something went wrong.
  const first = useQuery({
    ...query.assessment.listUnreachableParticipants.queryOptions({
      params: { batchId: asked.batchId },
      query: { nodeTypeIds: [...asked.levels], page: '1', limit: PER_PAGE },
    }),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const total = first.isError ? 0 : (first.data?.total ?? 0)
  if (total === 0) return null

  return (
    <>
      <div
        {...stylex.props(styles.notice)}
        data-testid="route-reach"
        data-route={asked.chain}
        data-count={total}
      >
        <p {...stylex.props(styles.words)}>
          <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon)} />
          <span>
            {format(asked.chain === 'normal' ? m.itemsReachNormal : m.itemsReachEscalation, {
              count: total,
            })}
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {format(m.itemsReachView)}
        </Button>
      </div>
      {shown !== null && (
        <UnreachableDialog asked={shown} open={open} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/** who they are, a page at a time, as the roster's own list of them says it */
function UnreachableDialog({
  asked,
  open,
  onClose,
}: {
  asked: Asked
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  onClose: () => void
}) {
  const { format } = useI18n()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="route-reach-dialog" size="40rem">
        <DialogHeader>
          <DialogTitle>
            {format(
              asked.chain === 'normal' ? m.itemsReachTitleNormal : m.itemsReachTitleEscalation,
            )}
          </DialogTitle>
          <DialogDescription>{format(m.itemsReachHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <UnreachablePeople batchId={asked.batchId} of={{ nodeTypeIds: asked.levels }} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
