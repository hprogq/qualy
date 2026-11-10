import { Link, useNavigate } from 'react-router'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { installSink, resetObservability } from '@qualy/browser-observability'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

const manifest = {
  ...emptyManifest(),
  layouts: [{ contract: 'app-shell/v1' as const }],
  pages: [
    { id: 'test/start', path: '/start', layout: 'app-shell/v1' as const, title: 'Start' },
    { id: 'test/detail', path: '/detail/:id', layout: 'app-shell/v1' as const, title: 'Detail' },
  ],
}
const controls = () => (
  <>
    <Link to="/detail/private-id?secret=private-value">Detail</Link>
    <Link to="/detail/private-id?secret=other">Search</Link>
    <Link to="/detail/private-id?secret=other#section">Hash</Link>
    <Back />
  </>
)
function Back() {
  const navigate = useNavigate()
  return <button onClick={() => void navigate(-1)}>Back</button>
}
afterEach(() => resetObservability())
it('reports committed async navigation using only the authorized route, and ignores initial mount', async () => {
  const reports: { page: unknown; duration: number }[] = []
  installSink({
    captureException() {},
    captureDiagnostic() {},
    setPage() {},
    recordNavigation(page, duration) {
      reports.push({ page, duration })
    },
  })
  let reads = 0
  let release = () => {}
  let wait = Promise.resolve()
  const arm = () => {
    wait = new Promise<void>((resolve) => {
      release = resolve
    })
  }
  arm()
  const client = fakeClient({
    app: {
      getManifest: () =>
        Effect.promise(async () => {
          if (reads++ > 0) await wait
          return manifest
        }),
    },
  })
  await renderScreen({
    client,
    route: '/start',
    routes: [
      { path: '/start', element: controls() },
      { path: '/detail/:id', element: controls() },
    ],
  })
  await expect.element(page.getByRole('link', { name: 'Detail' })).toBeVisible()
  expect(reports).toHaveLength(0)
  await page.getByRole('link', { name: 'Detail' }).click()
  release()
  await expect.poll(() => reports.length).toBe(1)
  expect(reports[0]?.page).toEqual({ pageId: 'test/detail', route: '/detail/:id' })
  expect(reports[0]?.duration).toBeGreaterThanOrEqual(0)
  arm()
  await page.getByRole('link', { name: 'Search' }).click()
  release()
  await expect.poll(() => reports.length).toBe(2)
  expect(reports[1]?.page).toEqual({ pageId: 'test/detail', route: '/detail/:id' })
  await page.getByRole('link', { name: 'Hash' }).click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(reports).toHaveLength(2)
  await page.getByRole('button', { name: 'Back' }).click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(reports).toHaveLength(2)
  arm()
  await page.getByRole('button', { name: 'Back' }).click()
  release()
  await expect.poll(() => reports.length).toBe(3)
  expect(reports[2]?.page).toEqual({ pageId: 'test/detail', route: '/detail/:id' })
})

it('only records the destination that commits when an in-flight navigation is replaced', async () => {
  const reports: unknown[] = []
  installSink({
    captureException() {},
    captureDiagnostic() {},
    setPage() {},
    recordNavigation(page) {
      reports.push(page)
    },
  })
  let reads = 0
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = fakeClient({
    app: {
      getManifest: () =>
        Effect.promise(async () => {
          if (reads++ > 0) await waiting
          return manifest
        }),
    },
  })
  await renderScreen({
    client,
    route: '/start',
    routes: [
      { path: '/start', element: controls() },
      { path: '/detail/:id', element: controls() },
    ],
  })
  await expect.element(page.getByRole('link', { name: 'Detail' })).toBeVisible()
  await page.getByRole('link', { name: 'Detail' }).click()
  await page.getByRole('link', { name: 'Search' }).click()
  release()
  await expect.poll(() => reports.length).toBe(1)
  expect(reports).toEqual([{ pageId: 'test/detail', route: '/detail/:id' }])
})
