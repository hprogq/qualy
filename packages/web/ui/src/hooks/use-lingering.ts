import { useRef } from 'react'

/**
 * The last thing there was, kept for as long as something needs to draw it.
 *
 * A panel that closes by being unmounted cannot animate out: the moment the
 * thing it was showing becomes null, its markup is gone and the closing
 * animation has nothing left to run on. The usual shape - `{x && <Panel/>}` -
 * is exactly that mistake, and it is silent, because opening still looks
 * right.
 *
 * So the panel stays mounted and is told whether it is open, and this keeps
 * hold of what it was showing so it still has something to draw on the way
 * out. Returns null only before anything has ever been shown.
 */
export function useLingering<T>(value: T | null): T | null {
  const last = useRef<T | null>(null)
  if (value !== null) last.current = value
  return value ?? last.current
}
