import type { ComponentType } from 'react'
import { loadSurface, readApi } from '@qualy/web-rsc/request'
import { SurfaceScope } from '@qualy/web-runtime/surface-scope'
import { authApi } from './api.ts'
import LoginPage from './LoginPage.tsx'

// The sign-in page as a server renders it (docs/adr/0012-rsc-data-mode.md).
//
// Everything the page waits for before it can draw a form - which workspace
// this is, its ways in, and whether somebody is already signed in - is asked
// here, in the request that asked for the page, as the visitor who asked.
// The answer about the session is this request's own, never a cached one:
// a cached "signed in" can outlive the session it describes, and this page
// sends a signed-in visitor home.
//
// The drivers those ways in name are the only login renderers the browser
// is handed. A deployment's other drivers stay where they are.

export default async function SignInPage() {
  const [context, signedIn] = await Promise.all([
    readApi(authApi, (client) => client.auth.listLoginMethods()),
    readApi(authApi, (client) => client.auth.getSession()).then(
      () => true,
      () => false,
    ),
  ])
  const login: Record<string, ComponentType<any>> = {}
  await Promise.all(
    [...new Set(context.methods.map((method) => method.type))].map(async (type) => {
      const renderer = await loadSurface({ kind: 'login', id: type })
      if (renderer !== undefined) login[type] = renderer
    }),
  )
  return (
    <SurfaceScope surfaces={{ login }}>
      <LoginPage rendered={{ context, signedIn }} />
    </SurfaceScope>
  )
}
