import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// A document read where it stands, in the browser's own sandboxed viewer.
//
// The bytes are still served as a download - that rule is what keeps html
// and svg from running - so the previewer fetches them itself and hands the
// frame a blob whose type it chose. Only types the browser renders inertly
// are ever offered this way (LOOKS_LIKE_A_DOCUMENT); Esc closes, like the
// photo viewer.

const styles = stylex.create({
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
  name,
  onClose,
}: {
  href: string
  mime: string
  name: string
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    let made: string | null = null
    void fetch(href)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(response)))
      .then((bytes) => {
        if (dead) return
        made = URL.createObjectURL(new Blob([bytes], { type: mime }))
        setUrl(made)
      })
      .catch(() => {
        // the viewer has nothing to show; the name is still a download
        if (!dead) onClose()
      })
    return () => {
      dead = true
      if (made !== null) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, mime])

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate pr-8 text-sm">{name}</DialogTitle>
        </DialogHeader>
        {url === null ? (
          <div {...stylex.props(styles.waiting)}>
            <Spinner className={stylex.props(styles.spinner).className} />
          </div>
        ) : (
          <iframe src={url} title={name} {...stylex.props(styles.frame)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
