import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { UiProvider } from '@qualy/ui/provider'
import { RenderNetworkError, RenderResponseError } from '@qualy/web-runtime/render-network-error'
import { DocumentError, PageError } from '../src/rsc/route-error.tsx'
import '../src/app.css'

const mount = (router: ReturnType<typeof createMemoryRouter>) => {
  document.documentElement.dataset['locale'] = 'zh-CN'
  return render(
    <UiProvider scheme="light">
      <RouterProvider router={router} />
    </UiProvider>,
  )
}

describe('the RSC route error screen', () => {
  it('holds an instant failed retry, ignores another press, and shows the server reference', async () => {
    const requestId = '2493330c-c85b-488c-a533-a95008204f42'
    let attempts = 0
    const router = createMemoryRouter([
      {
        path: '/',
        ErrorBoundary: DocumentError,
        loader: () => {
          ++attempts
          throw new RenderResponseError(503, requestId)
        },
      },
    ])
    try {
      await mount(router)
      await expect.element(page.getByText(requestId, { exact: true })).toBeVisible()
      const button = page.getByRole('button', { name: '重试' })
      const element = button.element() as HTMLButtonElement
      element.click()
      element.click()
      await expect.element(button).toHaveAttribute('aria-busy', 'true')
      await expect.element(button).toHaveAttribute('data-retry-shake', '1')
      expect(attempts).toBe(2)
    } finally {
      router.dispose()
    }
  })
  it('leaves the error screen even when retry succeeds before a loading frame can paint', async () => {
    let attempts = 0
    const router = createMemoryRouter([
      {
        path: '/',
        ErrorBoundary: DocumentError,
        loader: () => {
          if (++attempts === 1) throw new RenderNetworkError(new Error('offline'))
          return null
        },
        Component: () => <main data-testid="instant">ready</main>,
      },
    ])
    try {
      await mount(router)
      await page.getByRole('button', { name: '重试' }).click()
      await expect.element(page.getByTestId('instant')).toBeVisible()
      expect(attempts).toBe(2)
      expect(router.state.location.pathname).toBe('/')
    } finally {
      router.dispose()
    }
  })
  it('works without the document runtime and retries the failed request with pending feedback', async () => {
    let tries = 0
    let finish!: () => void
    const arrived = new Promise<void>((resolve) => {
      finish = resolve
    })
    const router = createMemoryRouter([
      {
        path: '/',
        ErrorBoundary: DocumentError,
        loader: async () => {
          if (++tries === 1) throw new RenderNetworkError(new TypeError('private network detail'))
          await arrived
          return null
        },
        Component: () => <main data-testid="arrived">ready</main>,
      },
    ])
    try {
      await mount(router)
      await expect
        .poll(() =>
          document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
        )
        .toBe('offline')
      expect(document.body.textContent).not.toContain('private network detail')
      expect(document.body.textContent).not.toContain('Unexpected Application Error')
      // The emergency surface must not need the application's style pipeline.
      const main = page.getByTestId('route-error').element()
      await expect.element(page.getByText(/^W-[a-f0-9]{24}$/)).toBeVisible()
      const css = main.querySelector('style')?.sheet
      const sheets = [...document.styleSheets].filter((sheet) => sheet !== css && !sheet.disabled)
      try {
        sheets.forEach((sheet) => (sheet.disabled = true))
        const button = page.getByRole('button', { name: '重试' }).element()
        const home = page.getByRole('link', { name: '返回首页' }).element()
        expect(getComputedStyle(button).borderTopWidth).toBe('1px')
        expect(getComputedStyle(button).borderRadius).toBe('8px')
        expect(getComputedStyle(button).backgroundColor).toBe('rgb(25, 24, 23)')
        expect(getComputedStyle(home).borderTopColor).toBe('rgb(222, 221, 218)')
        const mark = main.querySelector('[data-emergency-mark]')!.getBoundingClientRect()
        const body = main.querySelector('[data-slot="resource-state"]')!.getBoundingClientRect()
        const reference = main.querySelector('[data-problem-reference]')!.getBoundingClientRect()
        const frame = main.getBoundingClientRect()
        expect(Math.abs(mark.x + mark.width / 2 - (body.x + body.width / 2))).toBeLessThan(1)
        expect(Math.abs(body.x + body.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(1)
        expect(reference.top - body.bottom).toBeGreaterThanOrEqual(24)
        expect(frame.bottom - reference.bottom).toBeGreaterThanOrEqual(24)
      } finally {
        sheets.forEach((sheet) => (sheet.disabled = false))
      }
      await page.getByRole('button', { name: '重试' }).click()
      await expect.poll(() => tries).toBe(2)
      await expect
        .element(page.getByRole('button', { name: '重试' }))
        .toHaveAttribute('aria-busy', 'true')
      finish()
      await expect.element(page.getByTestId('arrived')).toBeVisible()
    } finally {
      finish()
      router.dispose()
    }
  })

  it('keeps the shell on a page failure and never describes an ordinary TypeError as offline', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createMemoryRouter(
      [
        {
          Component: () => (
            <>
              <header data-testid="shell">Qualy</header>
              <Outlet />
            </>
          ),
          children: [
            {
              path: '/broken',
              loader: () => {
                throw new TypeError('private server implementation')
              },
              ErrorBoundary: PageError,
            },
            { path: '/', Component: () => <p data-testid="home">home</p> },
          ],
        },
      ],
      { initialEntries: ['/broken'] },
    )
    try {
      await mount(router)
      await expect
        .poll(() =>
          document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
        )
        .toBe('failed')
      const shell = page.getByTestId('shell').element()
      expect(document.body.textContent).not.toContain('private server implementation')
      await page.getByRole('link', { name: '返回首页' }).click()
      await expect.element(page.getByTestId('home')).toBeVisible()
      expect(page.getByTestId('shell').element()).toBe(shell)
    } finally {
      router.dispose()
      report.mockRestore()
    }
  })

  it('offers a way home instead of a retry for a missing route', async () => {
    const router = createMemoryRouter([
      {
        path: '/',
        ErrorBoundary: DocumentError,
        loader: () => {
          throw new Response('private response body', { status: 404 })
        },
      },
    ])
    try {
      await mount(router)
      await expect
        .poll(() =>
          document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
        )
        .toBe('missing')
      expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
      expect(document.body.textContent).not.toContain('private response body')
    } finally {
      router.dispose()
    }
  })
})
