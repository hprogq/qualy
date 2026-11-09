import { useEffect, useRef } from 'react'
import { XIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useLocale } from '@qualy/web-i18n'
import * as commonMessages from '@qualy/web-i18n/messages'
import { deviceEverDiffers, readableZone } from './zone.ts'
import { zoneLabelOf } from './zone-label.ts'
import * as m from '#messages'

const styles = stylex.create({
  noticeDescription: { color: tokens.foreground },
  noticeClose: {
    position: 'absolute',
    insetBlockStart: 6,
    insetInlineEnd: 6,
    display: 'grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    borderRadius: tokens.radiusMd,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: 'transparent', ':hover': tokens.hoverSurface },
    outline: { default: 'none', ':focus-visible': `2px solid ${tokens.focusRing}` },
    outlineOffset: -2,
  },
})

/** A workspace entry, not a section change, can announce a different clock. */
export function useBatchZoneNotice(batchId: string, storedZone: string | undefined) {
  const locale = useLocale()
  const visit = useRef({ batchId, announced: false })

  useEffect(() => {
    if (visit.current.batchId !== batchId) visit.current = { batchId, announced: false }
    if (visit.current.announced || storedZone === undefined) return

    let toastId: string | number | undefined
    // The document mounts the shared toaster in a portal after hydration.
    // Defer the notice briefly so the portal is ready and quick exits stay quiet.
    const timer = window.setTimeout(() => {
      visit.current.announced = true
      const zone = readableZone(storedZone)
      const now = Date.now()
      if (zone === undefined || !deviceEverDiffers(zone, now)) return
      const { label } = zoneLabelOf(zone, locale, now)
      toastId = toast.info(m.settings_timezone(), {
        description: (
          <span {...stylex.props(styles.noticeDescription)}>{m.zone_away({ zone: label })}</span>
        ),
        position: 'bottom-right',
        duration: 6500,
        cancel: (
          <button
            type="button"
            aria-label={commonMessages.action_close()}
            onClick={() => {
              if (toastId !== undefined) toast.dismiss(toastId)
            }}
            {...stylex.props(styles.noticeClose)}
          >
            <XIcon size={14} aria-hidden />
          </button>
        ),
        testId: 'batch-zone-notice',
      })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      if (toastId !== undefined) toast.dismiss(toastId)
    }
  }, [batchId, locale, storedZone])
}
