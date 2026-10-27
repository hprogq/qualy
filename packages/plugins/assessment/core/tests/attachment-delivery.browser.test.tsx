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
  const fetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (
      String(input) !== attachmentContentUrl(ID) &&
      !String(input).startsWith('https://files.example.test/v1/')
    ) {
      return fetch(input, init)
    }
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

  it('opens and reopens a PDF through fresh authorization after the descriptor expires', async () => {
    const describe = vi.fn(() => Effect.succeed({ attachments: [descriptor(oldPdf)] }))
    const received = serve((url) => {
      if (url !== attachmentContentUrl(ID)) return new Response(null, { status: 403 })
      return new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } })
    })
    await mount(describe)
    await expect.element(page.getByRole('button', { name: NAME })).toBeVisible()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
      .not.toBeNull()
    expect(received).toEqual([attachmentContentUrl(ID)])
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    // The link displayed on the page does not become a signed, expiring URL either.
    await expect
      .element(page.getByRole('link', { name: NAME }))
      .toHaveAttribute('href', attachmentContentUrl(ID))
    vi.spyOn(Date, 'now').mockReturnValue(now + 122_000)
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
      .not.toBeNull()
    expect(received).toEqual([attachmentContentUrl(ID), attachmentContentUrl(ID)])
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('reauthorizes a failed PDF once, without closing the preview', async () => {
    let descriptions = 0
    const describe = vi.fn(() =>
      Effect.sync(() => ({
        attachments: [descriptor(descriptions++ === 0 ? oldPdf : freshPdf)],
      })),
    )
    const received = serve((url) => {
      if (url === attachmentContentUrl(ID)) throw new TypeError('cross-origin read failed')
      return new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } })
    })
    await mount(describe)
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
      .not.toBeNull()
    expect(received).toEqual([attachmentContentUrl(ID), freshPdf])
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

  it('keeps a loaded thumbnail after expiry but reauthorizes a new image opening', async () => {
    const describe = vi.fn(() => Effect.succeed({ attachments: [descriptor(image, 'image/png')] }))
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: { listAttachmentDescriptors: describe },
      }),
      children: <AttachmentLink attachmentId={ID} variant="preview" />,
    })
    const thumbnail = page.getByRole('img', { name: NAME })
    await expect
      .poll(() => (thumbnail.element() as HTMLImageElement).naturalWidth)
      .toBeGreaterThan(0)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    expect(thumbnail.element().getAttribute('src')).toBe(image)
    expect(describe).toHaveBeenCalledTimes(1)
    await thumbnail.click()
    // The test server cannot serve the content endpoint; that new opening
    // must reauthorize once rather than reuse the descriptor's expired URL.
    await expect
      .poll(() =>
        [...document.querySelectorAll<HTMLImageElement>('.PhotoView-Portal img')].some(
          (element) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true)
    expect(describe).toHaveBeenCalledTimes(2)
    expect(thumbnail.element().getAttribute('src')).toBe(image)
  })

  it('does not fall back to the old URL after access is revoked', async () => {
    let descriptions = 0
    const describe = vi.fn(() =>
      Effect.sync(() => ({
        attachments: descriptions++ === 0 ? [descriptor(oldPdf)] : [],
      })),
    )
    const received = serve(() => new Response(null, { status: 403 }))
    await mount(describe)
    await expect.element(page.getByRole('button', { name: NAME })).toBeVisible()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    await page.getByRole('button', { name: NAME }).click()
    await expect.element(page.getByRole('dialog').getByRole('status')).toBeVisible()
    expect(received).toEqual([attachmentContentUrl(ID)])
    expect(describe).toHaveBeenCalledTimes(2)
    expect(document.querySelector('iframe[title="certificate.pdf"]')).toBeNull()
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
