import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// A line alert: one sentence and the key that acts on it. The key used to
// hang over the words from the corner, over padding guessed wide enough for
// it; an English sentence ran longer than the guess and went under the key.
// Here the key stands in the line's flow - the words wrap beside it, and
// where the alert is too narrow for both, the key drops under the words, at
// the edge they start from. Asserted on geometry and computed style.

afterEach(() => page.viewport(1280, 800))

const LONG =
  'Three people on this batch now hold their staff roles through different units than the ones they were accepted in, and somebody has to decide'

function Line({
  width,
  icon = true,
  description,
  variant,
}: {
  width: number
  icon?: boolean
  description?: string
  variant?: 'default' | 'warning'
}) {
  return (
    <UiProvider scheme="light">
      <div style={{ width }}>
        <Alert layout="line" {...(variant === undefined ? {} : { variant })}>
          {icon && <TriangleAlertIcon />}
          <AlertTitle>{LONG}</AlertTitle>
          {description !== undefined && <AlertDescription>{description}</AlertDescription>}
          <AlertAction>
            <Button size="sm" variant="outline">
              Review changes
            </Button>
          </AlertAction>
        </Alert>
      </div>
    </UiProvider>
  )
}

const parts = () => {
  const alert = page.getByRole('alert').element()
  const rect = (slot: string) =>
    alert.querySelector(`[data-slot="${slot}"]`)!.getBoundingClientRect()
  return {
    alert: alert.getBoundingClientRect(),
    words: rect('alert-title'),
    key: page.getByRole('button', { name: 'Review changes' }).element().getBoundingClientRect(),
    icon: alert.querySelector('svg')?.getBoundingClientRect(),
  }
}

describe('a line alert', () => {
  it('keeps its key beside the words, and the words out from under it', async () => {
    await render(<Line width={720} />)
    await expect.element(page.getByRole('button', { name: 'Review changes' })).toBeVisible()
    const { alert, words, key } = parts()
    // one row: the key beside the words, not under them
    expect(key.top).toBeLessThan(words.bottom)
    // the words wrap before the key rather than run under it
    expect(words.height).toBeGreaterThan(20)
    expect(words.right).toBeLessThanOrEqual(key.left - 12 + 1)
    // at the end of the line, and a whole key
    expect(Math.round(alert.right - key.right)).toBe(13)
    expect(key.height).toBe(32)
  })

  it('drops its key under the words where the alert is too narrow for both', async () => {
    await page.viewport(390, 844)
    await render(<Line width={358} />)
    await expect.element(page.getByRole('button', { name: 'Review changes' })).toBeVisible()
    const { alert, words, key, icon } = parts()
    expect(key.top).toBeGreaterThanOrEqual(words.bottom)
    // under the words, at the edge they start from, past the icon
    expect(Math.abs(key.left - words.left)).toBeLessThanOrEqual(1)
    expect(key.left).toBeGreaterThan(icon!.right)
    // the words take the whole line the key left them
    expect(words.right).toBeGreaterThan(alert.right - 24)
  })

  it('starts its words at its edge when there is no icon', async () => {
    await render(<Line width={720} icon={false} />)
    await expect.element(page.getByRole('button', { name: 'Review changes' })).toBeVisible()
    const { alert, words, key } = parts()
    expect(Math.round(words.left - alert.left)).toBe(17)
    expect(key.top).toBeLessThan(words.bottom)
  })

  // Alone, the title is the sentence and reads in the body's weight; over a
  // body it is the heading again, and the body sits under it, beside the key.
  it('reads its title as the sentence, or as the heading over a body', async () => {
    await render(
      <>
        <div data-testid="alone">
          <Line width={720} />
        </div>
        <div data-testid="headed">
          <Line width={720} description="the scoring service did not answer" />
        </div>
      </>,
    )
    await expect.element(page.getByTestId('headed').getByRole('button')).toBeVisible()
    const title = (host: string) =>
      page.getByTestId(host).element().querySelector('[data-slot="alert-title"]')!
    const weight = (host: string) => Number(getComputedStyle(title(host)).fontWeight)
    expect(weight('alone')).toBe(400)
    expect(weight('headed')).toBe(500)
    const headed = page.getByTestId('headed').element()
    const body = headed.querySelector('[data-slot="alert-description"]')!.getBoundingClientRect()
    const heading = title('headed').getBoundingClientRect()
    expect(body.top).toBeGreaterThanOrEqual(heading.bottom)
    expect(Math.abs(body.left - heading.left)).toBeLessThanOrEqual(1)
    const key = page.getByTestId('headed').getByRole('button').element().getBoundingClientRect()
    expect(body.right).toBeLessThanOrEqual(key.left)
  })

  // What waits on somebody's decision is amber: the icon, and a wash under
  // the words, which stay in ink.
  it('says a decision is owed in amber, keeping its words in ink', async () => {
    await render(
      <>
        <div data-testid="warning">
          <Line width={720} variant="warning" />
        </div>
        <div data-testid="plain">
          <Line width={720} />
        </div>
      </>,
    )
    await expect.element(page.getByTestId('plain').getByRole('button')).toBeVisible()
    const probe = document.createElement('span')
    probe.style.color = 'var(--q-warning)'
    document.body.append(probe)
    const amber = getComputedStyle(probe).color
    probe.remove()
    const alert = (host: string) => page.getByTestId(host).getByRole('alert').element()
    expect(getComputedStyle(alert('warning').querySelector('svg')!).color).toBe(amber)
    expect(getComputedStyle(alert('warning')).backgroundColor).not.toBe(
      getComputedStyle(alert('plain')).backgroundColor,
    )
    const ink = (host: string) =>
      getComputedStyle(alert(host).querySelector('[data-slot="alert-title"]')!).color
    expect(ink('warning')).toBe(ink('plain'))
  })
})
