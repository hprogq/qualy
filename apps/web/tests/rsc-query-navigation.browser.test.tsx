import { useEffect } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { unstable_RSCHydratedRouter as RSCHydratedRouter } from 'react-router/dom'
import { Outlet, useNavigate, useSearchParams } from 'react-router'
import type { unstable_RSCPayload as RSCPayload } from 'react-router'
import { withRoutePolicies } from '@qualy/web-rsc/route-policies'
import { pageRevalidation } from '@qualy/web-runtime/revalidation'

it('keeps query navigation local after the initial RSC route catalog is applied', async () => {
  const homePath = window.location.pathname
  const path = '/qualy-test-account'
  let mounts = 0
  function Account() {
    const [search, setSearch] = useSearchParams()
    useEffect(() => {
      mounts++
    }, [])
    return (
      <main>
        <output data-testid="selection">{search.get('item') ?? 'first'}</output>
        <button onClick={() => setSearch({ item: 'second' })}>select item</button>
        <button onClick={() => history.back()}>back</button>
        <button onClick={() => history.forward()}>forward</button>
      </main>
    )
  }
  function Home() {
    const navigate = useNavigate()
    return <button onClick={() => void navigate(path)}>open account</button>
  }
  const root = {
    id: 'qualy:document',
    path: '',
    hasComponent: true,
    hasLoader: false,
    hasAction: false,
  }
  const home = {
    id: 'page:home',
    parentId: root.id,
    path: homePath,
    hasComponent: true,
    hasLoader: false,
    hasAction: false,
  }
  const route = {
    id: 'page:account',
    parentId: root.id,
    path,
    hasComponent: true,
    hasLoader: false,
    hasAction: false,
  }
  const rootMatch = {
    ...root,
    element: <Outlet />,
    params: {},
    pathname: '/',
    pathnameBase: '/',
    shouldRevalidate: pageRevalidation,
  }
  const payload: RSCPayload = {
    type: 'render',
    basename: undefined,
    loaderData: { [root.id]: null, [home.id]: null },
    actionData: null,
    errors: null,
    location: { pathname: homePath, search: '', hash: '', key: 'initial', state: null },
    routeDiscovery: { mode: 'initial' },
    matches: [
      rootMatch,
      {
        ...home,
        element: <Home />,
        params: {},
        pathname: homePath,
        pathnameBase: homePath,
        shouldRevalidate: pageRevalidation,
      },
    ],
    // An unvisited page is discovered without its revalidation policy.
    patches: Promise.resolve([root, home, route]),
  }
  const accountPayload: RSCPayload = {
    ...payload,
    loaderData: { [root.id]: null, [route.id]: null },
    location: { ...payload.location, pathname: path },
    matches: [
      rootMatch,
      {
        ...route,
        element: <Account />,
        params: {},
        pathname: path,
        pathnameBase: path,
        shouldRevalidate: pageRevalidation,
      },
    ],
    patches: undefined,
  }
  const fetch = vi.fn(async () => new Response('flight'))
  const decode = vi.fn(async () => accountPayload)
  const view = await render(
    <RSCHydratedRouter
      payload={withRoutePolicies(payload)}
      fetch={fetch}
      createFromReadableStream={decode}
    />,
  )
  await page.getByRole('button', { name: 'open account' }).click()
  await expect.element(page.getByTestId('selection')).toHaveTextContent('first')
  await page.getByRole('button', { name: 'select item' }).click()
  await expect.element(page.getByTestId('selection')).toHaveTextContent('second')
  await page.getByRole('button', { name: 'back', exact: true }).click()
  await expect.element(page.getByTestId('selection')).toHaveTextContent('first')
  await page.getByRole('button', { name: 'forward', exact: true }).click()
  await expect.element(page.getByTestId('selection')).toHaveTextContent('second')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(mounts).toBe(1)
  await view.unmount()
})
