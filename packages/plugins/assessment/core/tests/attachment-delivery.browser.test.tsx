import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AttachmentLink } from '../src/client/entry/AttachmentLink.tsx'
import { attachmentContentUrl } from '../src/client/entry/model.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const ID = '11111111-1111-4111-8111-111111111111'
const NAME = 'certificate.pdf'
const freshPdf = 'https://files.example.test/v1/fresh'
const oldPdf = 'https://files.example.test/v1/old'
const brokenImage = 'data:image/png;base64,AA=='
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfXkAAAAASUVORK5CYII='

const descriptor = (url: string, mime = 'application/pdf') => ({
  id: ID,
  filename: NAME,
  declaredMime: mime,
  size: '100',
  delivery: { kind: 'redirect', url, expiresInSeconds: 60 },
})

const mount = (describe: () => Effect.Effect<unknown>, copies = 1) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      assessment: { listAttachmentDescriptors: describe },
    }),
    children: Array.from({ length: copies }, (_, index) => (
      <AttachmentLink key={index} attachmentId={ID} variant="line" />
    )),
  })

afterEach(() => vi.restoreAllMocks())

// StrictMode abandons its first mount. Honor that cancellation before
// recording requests, as a transport would, rather than counting aborted work.
const serve = (reply: (url: string) => Response) => {
  const received: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    await Promise.resolve()
    init?.signal?.throwIfAborted()
    received.push(String(input))
    return reply(String(input))
  })
  return received
}

describe('attachment delivery in the browser', () => {
  it('always downloads through the authenticated content endpoint', async () => {
    await mount(() => Effect.succeed({ attachments: [descriptor(oldPdf)] }))
    await expect.element(page.getByRole('button', { name: NAME })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: NAME }))
      .toHaveAttribute('href', attachmentContentUrl(ID))
  })

  it('reauthorizes a failed PDF once, without closing the preview', async () => {
    let descriptions = 0
    const describe = vi.fn(() =>
      Effect.sync(() => ({
        attachments: [descriptor(descriptions++ === 0 ? oldPdf : freshPdf)],
      })),
    )
    const received = serve((url) => {
      if (url === oldPdf) throw new TypeError('cross-origin read failed')
      return new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } })
    })
    await mount(describe)
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
      .not.toBeNull()
    expect(received).toEqual([oldPdf, freshPdf])
    expect(describe).toHaveBeenCalledTimes(2)
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('stops after the renewed link fails and allows another explicit opening', async () => {
    const describe = vi.fn(() => Effect.succeed({ attachments: [descriptor(oldPdf)] }))
    const received = serve(() => new Response(null, { status: 403 }))
    await mount(describe)
    await page.getByRole('button', { name: NAME }).click()
    await expect.element(page.getByRole('dialog').getByRole('status')).toBeVisible()
    expect(received).toHaveLength(2)
    expect(describe).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await page.getByRole('button', { name: NAME }).click()
    await expect.element(page.getByRole('dialog').getByRole('status')).toBeVisible()
    expect(received).toHaveLength(4)
    expect(describe).toHaveBeenCalledTimes(3)
  })

  it('recovers an image lightbox with one fresh link', async () => {
    let descriptions = 0
    const describe = vi.fn(() =>
      Effect.sync(() => ({
        attachments: [descriptor(descriptions++ === 0 ? brokenImage : image, 'image/png')],
      })),
    )
    await mount(describe)
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() =>
        [...document.querySelectorAll<HTMLImageElement>('.PhotoView-Portal img')].some(
          (element) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true)
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('merges concurrent thumbnail renewal and leaves a visible failure after retry', async () => {
    const describe = vi.fn(() =>
      Effect.succeed({ attachments: [descriptor(brokenImage, 'image/png')] }).pipe(
        Effect.delay(30),
      ),
    )
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: { listAttachmentDescriptors: describe },
      }),
      children: (
        <>
          <AttachmentLink attachmentId={ID} variant="preview" />
          <AttachmentLink attachmentId={ID} variant="preview" />
        </>
      ),
    })
    await expect.poll(() => document.querySelectorAll('span[role="img"]').length).toBe(2)
    expect(describe).toHaveBeenCalledTimes(2)
  })
})
