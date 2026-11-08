import type { ComponentType } from 'react'
import { loadSurface, readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { SurfaceScope } from '@qualy/web-runtime/surface-scope'
import { deviceOfCookieHeader } from '@qualy/auth-contract/device'
import { recentLoginMethod } from '@qualy/auth-contract/recent-method'
import { authApi } from './api.ts'
import { methodsOf, presenceOf } from './sign-in/answered.ts'
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
// Only an answer is passed on as one. A server that could not be asked is
// not "nobody is signed in": that would draw the form for a visitor who is,
// so the page is drawn undecided and asks for itself once it runs.
//
// The drivers those ways in name are the only login renderers the browser
// is handed. A deployment's other drivers stay where they are.

export default async function SignInPage() {
  const [listed, present] = await Promise.all([
    readApiExit(authApi, (client) => client.auth.listLoginMethods()),
    readApiExit(authApi, (client) => client.auth.getSession()),
  ])
  const context = methodsOf(listed)
  const signedIn = presenceOf(present)
  // The ways in name the renderers the page needs, and only those are
  // handed over: what the browser is handed it is told about. With no list
  // to go by none are, and the page asks this server to draw it again
  // rather than drawing ways in it has no renderer for.
  const types =
    context === undefined ? [] : [...new Set(context.methods.map((method) => method.type))]
  const login: Record<string, ComponentType<any>> = {}
  await Promise.all(
    types.map(async (type) => {
      const renderer = await loadSurface({ kind: 'login', id: type })
      if (renderer !== undefined) login[type] = renderer
    }),
  )
  return (
    <SurfaceScope surfaces={{ login }}>
      <LoginPage
        rendered={{
          context,
          signedIn,
          sharedDevice: deviceOfCookieHeader(renderRequest().cookie) === 'shared',
          recentMethod: recentLoginMethod(renderRequest().cookie),
        }}
      />
    </SurfaceScope>
  )
}
