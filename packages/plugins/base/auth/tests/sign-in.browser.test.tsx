import LoginPage from '../src/client/LoginPage.tsx'
import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The sign-in screen finds a driver's renderer by the driver's TYPE.
//
// It used to find it by a string the server derived from the driver plugin's
// package and source file and put in the method list, so every anonymous
// visitor was told which package implements the way in. `local` is what a
// way of signing in is called, the build files the renderer under the same
// word, and this is the only test that walks that resolution.

const password = {
  code: 'password',
  type: 'local',
  name: '账号密码',
  mode: 'component' as const,
}

const screen = (login: Record<string, ReturnType<typeof lazy>>) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      auth: { listLoginMethods: { methods: [password] } },
    }),
    registry: { login },
    // the method is chosen in the address, so the screen opens on the
    // driver's own form rather than on the list
    route: '/login?method=password',
    children: <LoginPage />,
  })

describe('the sign-in screen', () => {
  it('renders the driver filed under the type the method names', async () => {
    screen({ local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) })
    // the local driver's own form, which is the only thing that proves the
    // renderer was resolved rather than the shell drawing an empty card
    await expect.element(page.getByLabelText('用户名')).toBeVisible()
    await expect.element(page.getByLabelText('密码')).toBeVisible()
    // exact, because the way back out of the driver is "← 其他登录方式"
    await expect.element(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  })

  it('catches a renderer that throws instead of taking the screen down', async () => {
    // the sign-in screen used to render the driver itself, outside the
    // surface boundary: a driver that threw on its first render took the
    // whole door with it and nothing said which way in had failed
    const Broken = () => {
      throw new Error('this driver exploded')
    }
    screen({ local: lazy(() => Promise.resolve({ default: Broken })) })
    await expect.element(page.getByText('该登录方式暂不可用')).toBeVisible()
    // and the way out is still there, which is the whole point of catching it
    await expect.element(page.getByRole('button', { name: '← 其他登录方式' })).toBeVisible()
  })

  it('fails closed when this build carries no renderer for that type', async () => {
    // a deployment whose api offers a driver the browser bundle does not
    // have: the screen says so and offers the way back, rather than showing
    // a card with nothing in it
    screen({})
    await expect.element(page.getByText('该登录方式暂不可用')).toBeVisible()
    await expect.element(page.getByLabelText('用户名')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: '← 其他登录方式' })).toBeVisible()
  })
})
