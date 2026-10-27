import { createContext, useContext, useEffect } from 'react'

export type Renew = () => Promise<string | null>
export const Recoveries = createContext<Map<string, Set<Renew>> | null>(null)

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
