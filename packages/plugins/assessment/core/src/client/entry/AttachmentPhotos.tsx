import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { PhotoProvider } from '@qualy/ui/photo-view'
import { Spinner } from '@qualy/ui/spinner'
import * as stylex from '@stylexjs/stylex'
import * as m from '#messages'

type Renew = () => Promise<string | null>
const Recoveries = createContext<Map<string, Set<Renew>> | null>(null)

const styles = stylex.create({
  fallback: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  recovered: { maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' },
})

/** The failed lightbox uses the same bounded reauthorization as its thumbnail. */
export function AttachmentPhotos({ children }: { children: ReactNode }) {
  const recoveries = useRef(new Map<string, Set<Renew>>()).current
  return (
    <Recoveries.Provider value={recoveries}>
      <PhotoProvider
        maskOpacity={0.85}
        brokenElement={({ src }: { src: string }) => (
          <RecoveringImage
            src={src}
            alt={m.entry_previewFailed()}
            initiallyFailed
            renew={recoveries.get(src)?.values().next().value}
            className={stylex.props(styles.recovered).className}
          />
        )}
      >
        {children}
      </PhotoProvider>
    </Recoveries.Provider>
  )
}

export function usePhotoRecovery(src: string, renew: Renew) {
  const recoveries = useContext(Recoveries)
  useEffect(() => {
    if (recoveries === null) return
    const callbacks = recoveries.get(src) ?? new Set<Renew>()
    callbacks.add(renew)
    recoveries.set(src, callbacks)
    return () => {
      callbacks.delete(renew)
      if (callbacks.size === 0) recoveries.delete(src)
    }
  }, [recoveries, src, renew])
}

/** One failed load may acquire a fresh link; another failure stays visible. */
export function RecoveringImage({
  src,
  renew,
  initiallyFailed = false,
  ...props
}: ComponentProps<'img'> & { src: string; renew?: Renew | undefined; initiallyFailed?: boolean }) {
  const [state, setState] = useState<{
    url: string
    attempt: number
    failed: boolean
    waiting: boolean
  }>({
    url: src,
    attempt: 0,
    failed: initiallyFailed,
    waiting: false,
  })
  const requested = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const recover = async () => {
    if (requested.current || renew === undefined) {
      setState((before) => ({ ...before, failed: true, waiting: false }))
      return
    }
    requested.current = true
    setState((before) => ({ ...before, waiting: true }))
    let fresh: string | null = null
    try {
      fresh = await renew()
    } catch {
      /* the application already handles API failures */
    }
    if (!mounted.current) return
    setState({ url: fresh ?? src, attempt: 1, failed: fresh === null, waiting: false })
  }
  useEffect(() => {
    if (initiallyFailed) void recover()
    // The retry belongs to this image load, not to each descriptor update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (state.waiting)
    return (
      <span {...stylex.props(styles.fallback)}>
        <Spinner />
      </span>
    )
  if (state.failed)
    return (
      <span role="img" aria-label={props.alt} {...stylex.props(styles.fallback)}>
        {m.entry_previewFailed()}
      </span>
    )
  return (
    <img
      {...props}
      src={state.attempt === 0 ? src : state.url}
      key={state.attempt}
      onError={() => {
        void recover()
      }}
    />
  )
}
