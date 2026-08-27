import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { peopleImportPicker } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Running the organization query again, once.
//
// The same act that filled the roster when the batch was created, offered
// whenever somebody wants it. The selection is made by the picker that owns
// people; what it would do here is this screen's own answer, and it is said
// as a number before the button will do anything.

interface Selection {
  orgNodeIds: readonly string[]
  userTypeIds: readonly string[]
}

const styles = stylex.create({
  body: { height: '58vh' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  foot: { justifyContent: { default: null, '@media (min-width: 640px)': 'space-between' } },
  footSide: { display: 'flex', alignItems: 'center', gap: 8 },
})

const EMPTY: Selection = { orgNodeIds: [], userTypeIds: [] }

export function ImportDialog({
  batchId,
  open,
  pending,
  onImport,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onImport: (selection: Selection) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [selection, setSelection] = useState<Selection>(EMPTY)
  useEffect(() => {
    if (open) setSelection(EMPTY)
  }, [open])

  const ready = selection.orgNodeIds.length > 0 && selection.userTypeIds.length > 0
  // counted before anybody is added, and counted again by the server when
  // they are: this number is what somebody is agreeing to
  const candidates = useQuery({
    ...query.assessment.previewImport.queryOptions({
      params: { batchId },
      query: {
        orgNodeIds: [...selection.orgNodeIds],
        userTypeIds: [...selection.userTypeIds],
      },
    }),
    enabled: open && ready,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="42rem">
        <DialogHeader>
          <DialogTitle>{format(m.importTitle)}</DialogTitle>
          <DialogDescription>{format(m.importHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <UiSlot
            token={peopleImportPicker}
            context={{ value: selection, onChange: setSelection }}
            fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
          />
        </DialogBody>
        <DialogFooter className={stylex.props(styles.foot).className}>
          <span
            // how many this import would add, as a number; the sentence
            // around it is copy and changes without the count changing
            data-testid="import-candidates"
            data-ready={String(ready && candidates.data !== undefined)}
            data-count={ready && candidates.data ? String(candidates.data.candidates) : ''}
            {...stylex.props(styles.quiet)}
          >
            {ready && candidates.data
              ? format(m.importCandidates, { count: candidates.data.candidates })
              : format(m.importChoose)}
          </span>
          <div {...stylex.props(styles.footSide)}>
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={pending || !ready || (candidates.data?.candidates ?? 0) === 0}
              onClick={() => onImport(selection)}
            >
              {format(m.importConfirm)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
