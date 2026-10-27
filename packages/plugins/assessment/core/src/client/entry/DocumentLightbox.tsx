import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import * as m from '#messages'

// A document read where it stands, in the browser's own sandboxed viewer.
//
// The bytes are still served as a download - that rule is what keeps html
// and svg from running - so the previewer fetches them itself and hands the
// frame a blob whose type it chose. Only types the browser renders inertly
// are ever offered this way (LOOKS_LIKE_A_DOCUMENT); Esc closes, like the
// photo viewer.

const styles = stylex.create({
  panel: {
    display: 'flex',
    height: '85vh',
    flexDirection: 'column',
    gap: 12,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    paddingRight: 32,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  waiting: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 24,
    height: 24,
  },
  frame: {
    minHeight: 0,
    width: '100%',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
})

export function DocumentLightbox({
  href,
  mime,
  renew,
  name,
  onClose,
}: {
  href: string
  mime: string
  renew: () => Promise<string | null>
  name: string
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Renewal changes the descriptor in the parent. It must not reset this
  // load's retry budget by starting another effect from the new URL.
  const [initialHref] = useState(href)

  useEffect(() => {
    const controller = new AbortController()
    let made: string | null = null
    const load = async () => {
      let current = initialHref
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(current, { signal: controller.signal })
          if (!response.ok) {
            await response.body?.cancel()
            throw new Error('attachment read failed')
          }
          const bytes = await response.arrayBuffer()
          if (controller.signal.aborted) return
          made = URL.createObjectURL(new Blob([bytes], { type: mime }))
          setUrl(made)
          return
        } catch {
          if (controller.signal.aborted) return
          if (attempt === 0) {
            let fresh: string | null = null
            try {
              fresh = await renew()
            } catch {
              /* API failure is handled by the runtime */
            }
            if (controller.signal.aborted) return
            if (fresh !== null) {
              current = fresh
              continue
            }
          }
          setFailed(true)
          return
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      if (made !== null) URL.revokeObjectURL(made)
    }
  }, [initialHref, mime, renew])

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="64rem" xstyle={styles.panel}>
        <DialogHeader>
          <DialogTitle {...stylex.props(styles.name)}>{name}</DialogTitle>
        </DialogHeader>
        {url === null ? (
          <div {...stylex.props(styles.waiting)}>
            {failed ? (
              <p role="status">{m.entry_previewFailed()}</p>
            ) : (
              <Spinner className={stylex.props(styles.spinner).className} />
            )}
          </div>
        ) : (
          <iframe src={url} title={name} {...stylex.props(styles.frame)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
