import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { useIsMobile, useMediaQuery } from '@qualy/ui/use-mobile'

function PointerShape() {
  return (
    <output
      data-beside={String(useMediaQuery('(min-width: 64rem)', true))}
      data-fine={String(useMediaQuery('(pointer: fine)', true))}
      data-phone={String(useIsMobile())}
    />
  )
}

it('hydrates the server workbench shape before reading the actual viewport and pointer', async () => {
  await page.viewport(390, 844)
  const host = document.createElement('div')
  document.body.append(host)
  host.innerHTML = renderToString(<PointerShape />)
  const first = host.querySelector('output')!
  expect(first.dataset).toMatchObject({ beside: 'true', fine: 'true', phone: 'false' })
  const errors: unknown[] = []
  const root = hydrateRoot(host, <PointerShape />, {
    onRecoverableError: (error) => errors.push(error),
  })
  try {
    await expect
      .poll(() => first.dataset)
      .toMatchObject({
        beside: 'false',
        phone: 'true',
        fine: String(matchMedia('(pointer: fine)').matches),
      })
    expect(host.querySelector('output')).toBe(first)
    expect(errors).toEqual([])

    await page.viewport(1440, 900)
    await expect.poll(() => first.dataset).toMatchObject({ beside: 'true', phone: 'false' })
  } finally {
    root.unmount()
    host.remove()
    await page.viewport(1280, 800)
  }
})
