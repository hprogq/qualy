import { createContext, type Context } from 'react'

// A context that outlives its own module being re-executed.
//
// Hot module replacement re-runs a module whenever anything it imports
// changes. The runtime's entry imports a button and a spinner, so editing
// either re-runs it - and a fresh `createContext()` then makes a SECOND
// context object. The provider above, in a module that was NOT re-run,
// goes on writing to the first one; every consumer below reads the second
// and finds nothing there. The application blanks with "must be used inside
// a Provider" and comes back on a reload, which is exactly what makes it
// look like a mystery rather than a stale module.
//
// So a context is looked up by name once per page instead of being created
// once per module evaluation. In a production build a module is evaluated
// once and this is a single property read; nothing about what the context
// holds or who may read it changes.
//
// The name is the identity. Two modules asking for the same name get the
// same context, which is the point - and why the names here are the ones
// the providers are called after rather than anything shorter.

const held = globalThis as unknown as Record<string, unknown>

export function sharedContext<T>(name: string, initial: T): Context<T> {
  const key = `qualy.context.${name}`
  const found = held[key]
  if (found !== undefined) return found as Context<T>
  const made = createContext<T>(initial)
  held[key] = made
  return made
}
