import { z } from 'zod'

// Who may see a surface. An explicit union rather than optional flags: a
// registration that forgets to say is a compile error, never an accidental
// public page. This is a discovery and experience boundary only — the api
// authorizes every request regardless of what the manifest showed.
export type UiVisibility =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; code: string }

export const uiVisibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('authenticated') }),
  z.object({ kind: z.literal('permission'), code: z.string().min(1) }),
])

export const PUBLIC: UiVisibility = { kind: 'public' }
export const AUTHENTICATED: UiVisibility = { kind: 'authenticated' }
export const permissionOf = (code: string): UiVisibility => ({ kind: 'permission', code })

// what the registry knows about the viewer when projecting the manifest
export interface ViewerAccess {
  authenticated: boolean
  permissions: ReadonlySet<string>
}

export const isVisibleTo = (visibility: UiVisibility, viewer: ViewerAccess): boolean => {
  switch (visibility.kind) {
    case 'public':
      return true
    case 'authenticated':
      return viewer.authenticated
    case 'permission':
      return viewer.authenticated && viewer.permissions.has(visibility.code)
  }
}
