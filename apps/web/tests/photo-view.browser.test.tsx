import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import '../src/app.css'

const image = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="navy"/></svg>',
)}`

it('the image viewer brings its fullscreen stylesheet and closes with Escape', async () => {
  await render(
    <PhotoProvider>
      <PhotoView src={image}>
        <img src={image} alt="Evidence" width={100} height={60} />
      </PhotoView>
    </PhotoProvider>,
  )
  await page.getByRole('img', { name: 'Evidence' }).click()
  await expect.poll(() => document.querySelector('.PhotoView-Portal')).not.toBeNull()
  const portal = document.querySelector<HTMLElement>('.PhotoView-Portal')!
  expect(getComputedStyle(portal).position).toBe('fixed')
  expect(getComputedStyle(portal).pointerEvents).toBe('auto')
  expect(portal.getBoundingClientRect().width).toBe(window.innerWidth)
  expect(portal.getBoundingClientRect().height).toBe(window.innerHeight)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('.PhotoView-Portal')).toBeNull()
})
