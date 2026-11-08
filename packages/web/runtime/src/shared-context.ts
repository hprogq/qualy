import { createContext, type Context } from 'react'

// Browser contexts survive HMR so an updated consumer still reads its
// mounted provider. Server contexts belong to their module graph: retaining
// them on globalThis crosses Vite renderer generations and gives React two
// owners of one provider. Names are unique within the runtime package.
const held: Record<string, unknown> = typeof window === 'undefined' ? {} : globalThis

export function sharedContext<T>(name: string, initial: T): Context<T> {
  const key = `qualy.context.${name}`
  const found = held[key]
  if (found !== undefined) return found as Context<T>
  const made = createContext<T>(initial)
  held[key] = made
  return made
}
