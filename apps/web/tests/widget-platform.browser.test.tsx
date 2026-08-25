import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { ThemeProvider, useTheme } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The two seams the widget platform stands on: the product theme stays the
// only scheme authority (the widget library follows its resolved value and
// keeps no state of its own), and a StyleX class wins over the widget
// baseline by declared layer order - no !important, no import-order luck.

function Bridge({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}

function SchemeHarness() {
  const { choice, setChoice } = useTheme()
  return (
    <>
      <button type="button" onClick={() => setChoice('dark')}>
        go dark
      </button>
      <button type="button" onClick={() => setChoice('light')}>
        go light
      </button>
      <button type="button" onClick={() => setChoice('system')}>
        follow system
      </button>
      <output data-testid="choice">{choice}</output>
    </>
  )
}

const root = () => document.documentElement
const widgetScheme = () => root().getAttribute('data-mantine-color-scheme')

describe('the theme bridge keeps one source of truth', () => {
  it('choice drives both the product class and the widget attribute', async () => {
    localStorage.removeItem('qualy.theme')
    render(
      <ThemeProvider>
        <Bridge>
          <SchemeHarness />
        </Bridge>
      </ThemeProvider>,
    )
    // system is the default; both sides agree with the machine from the start
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    await expect.poll(() => widgetScheme()).toBe(systemDark ? 'dark' : 'light')
    expect(root().classList.contains('dark')).toBe(systemDark)

    await page.getByRole('button', { name: 'go dark' }).click()
    await expect.poll(() => widgetScheme()).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('qualy.theme')).toBe('dark')

    await page.getByRole('button', { name: 'go light' }).click()
    await expect.poll(() => widgetScheme()).toBe('light')
    expect(root().classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('qualy.theme')).toBe('light')

    await page.getByRole('button', { name: 'follow system' }).click()
    await expect.poll(() => widgetScheme()).toBe(systemDark ? 'dark' : 'light')

    // the product key is the only persisted theme state anywhere
    const keys = Object.keys(localStorage)
    expect(keys.filter((key) => key.toLowerCase().includes('mantine'))).toEqual([])
    expect(localStorage.getItem('qualy.theme')).toBe('system')
  })
})

const sx = stylex.create({
  loud: { backgroundColor: '#123456' },
})

describe('StyleX sits above the widget layer', () => {
  it('a stylex class repaints a widget without !important', async () => {
    await import('virtual:stylex:runtime')
    render(
      <UiProvider scheme="light">
        <>
          <Button>stock</Button>
          <Button {...stylex.props(sx.loud)}>repainted</Button>
        </>
      </UiProvider>,
    )
    const paint = (name: string) =>
      getComputedStyle(page.getByRole('button', { name }).element()).backgroundColor
    // the widget baseline actually painted the stock one - the override test
    // is vacuous if the baseline is missing
    await expect.poll(() => paint('stock'), { timeout: 5000 }).toBe('oklch(0.205 0 0)')
    // the dev runtime injects the aggregated stylex sheet asynchronously
    await expect.poll(() => paint('repainted'), { timeout: 5000 }).toBe('rgb(18, 52, 86)')
  })
})
