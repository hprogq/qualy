import * as stylex from '@stylexjs/stylex'
import { XIcon } from 'lucide-react'
import { LoadFailure, useLoadFailure } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { useWorkspaceMode } from './workspace/layout.ts'

// The drawer a link to one of the reader's claims opens, where the claim it
// names is not among theirs: gone, mistyped, or never theirs. Said in the
// place the claim would have stood, with the way back to the list under it,
// rather than nothing opening and the link left standing in the address.

const styles = stylex.create({
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 12,
  },
  title: { margin: 0, flexGrow: 1, fontSize: 15, fontWeight: 600 },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    flexShrink: 0,
    marginTop: 10,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 15%, transparent)`,
  },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
})

export function MissingClaimSheet({
  open,
  back,
  onClose,
}: {
  open: boolean
  /** where closing it leaves the reader, said on its key; the list of claims by default */
  back?: string
  onClose: () => void
}) {
  const { format } = useI18n()
  const phone = useWorkspaceMode() === 'phone'
  const failure = useLoadFailure().missing({
    copy: { missing: { title: format(m.entryMissingTitle) } },
  })
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side={phone ? 'bottom' : 'right'} showCloseButton={false}>
        {phone && <span aria-hidden data-sheet-grab="" {...stylex.props(styles.grab)} />}
        <div {...stylex.props(styles.head)}>
          <SheetTitle className={stylex.props(styles.title).className}>
            {format(m.entrySheetTitle)}
          </SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(commonMessages.close)}
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
        <div data-testid="claim-missing" {...stylex.props(styles.body)}>
          <LoadFailure
            size="section"
            failure={failure}
            extra={
              <Button variant="outline" size="sm" onClick={onClose}>
                {back ?? format(m.entryMissingBack)}
              </Button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
