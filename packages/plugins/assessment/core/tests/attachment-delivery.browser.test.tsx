import { Effect } from 'effect'
import { useState } from 'react'
import { RecoveringImage } from '../src/client/entry/AttachmentPhotos.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AttachmentLink } from '../src/client/entry/AttachmentLink.tsx'
import { AttachmentScope } from '../src/client/entry/AttachmentScope.tsx'
import { EntryFiles } from '../src/attachment/contexts.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const ID = '11111111-1111-4111-8111-111111111111'
const NAME = 'certificate.pdf'
const brokenImage = 'data:image/png;base64,AA=='
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfXkAAAAASUVORK5CYII='

const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const reference = EntryFiles.at({ entryId: ENTRY_ID })
const attachmentContentUrl = () => reference.contentUrl(ID, 'reader')
const descriptor = (mime = 'application/pdf') => ({
  id: ID,
  filename: NAME,
  declaredMime: mime,
  size: '100',
  status: 'bound' as const,
})
const mount = async (mime = 'application/pdf', copies = 1) => {
  const describe = vi.fn(() => Effect.succeed({ attachments: [] }))
  const view = await renderScreen({
    client: fakeClient({
      app: {
        getManifest: { ...emptyManifest(), viewer: 'authenticated' as const, identity: 'reader' },
      },
      assessment: { listStagedAttachmentDescriptors: describe },
    }),
    children: (
      <AttachmentScope files={[descriptor(mime)]} context={reference}>
        {Array.from({ length: copies }, (_, index) => (
          <AttachmentLink key={index} attachmentId={ID} variant="line" />
        ))}
      </AttachmentScope>
    ),
  })
  return { ...view, describe }
}

afterEach(() => vi.restoreAllMocks())

// StrictMode abandons its first mount. Honor that cancellation before
// recording requests, as a transport would, rather than counting aborted work.
const serve = (reply: (url: string) => Response) => {
  const received: string[] = []
  const fetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (
      !String(input).startsWith(attachmentContentUrl()) &&
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
  it('shows a new source after a failed thumbnail', async () => {
    const renew = vi.fn(async () => null)
    function Viewer() {
      const [src, setSrc] = useState(brokenImage)
      return (
        <>
          <button onClick={() => setSrc(image)}>Change source</button>
          <RecoveringImage src={src} alt="attachment" renew={renew} />
        </>
      )
    }
    await renderScreen({
      client: fakeClient({ app: { getManifest: emptyManifest() } }),
      children: <Viewer />,
    })
    await expect.element(page.getByRole('img', { name: 'attachment' })).not.toHaveAttribute('src')
    expect(renew).toHaveBeenCalledTimes(1)
    await page.getByRole('button', { name: 'Change source' }).click()
    await expect
      .element(page.getByRole('img', { name: 'attachment' }))
      .toHaveAttribute('src', image)
    await expect
      .poll(
        () =>
          (page.getByRole('img', { name: 'attachment' }).element() as HTMLImageElement)
            .naturalWidth,
      )
      .toBeGreaterThan(0)
  })

  it('limits retries independently for each supplied source', async () => {
    const renew = vi.fn(async () => null)
    function Viewer() {
      const [src, setSrc] = useState(brokenImage)
      return (
        <>
          <button onClick={() => setSrc(`${brokenImage}#next`)}>Change source</button>
          <RecoveringImage src={src} alt="attachment" renew={renew} />
        </>
      )
    }
    await renderScreen({
      client: fakeClient({ app: { getManifest: emptyManifest() } }),
      children: <Viewer />,
    })
    await expect.poll(() => renew.mock.calls.length).toBe(1)
    await page.getByRole('button', { name: 'Change source' }).click()
    await expect.poll(() => renew.mock.calls.length).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('ignores a previous source renewal after the source changes', async () => {
    let finish!: (value: string | null) => void
    const renew = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve
        }),
    )
    function Viewer() {
      const [src, setSrc] = useState(brokenImage)
      return (
        <>
          <button onClick={() => setSrc(image)}>Change source</button>
          <RecoveringImage src={src} alt="attachment" renew={renew} />
        </>
      )
    }
    await renderScreen({
      client: fakeClient({ app: { getManifest: emptyManifest() } }),
      children: <Viewer />,
    })
    await expect.poll(() => renew.mock.calls.length).toBe(1)
    await page.getByRole('button', { name: 'Change source' }).click()
    await expect
      .element(page.getByRole('img', { name: 'attachment' }))
      .toHaveAttribute('src', image)
    finish(brokenImage)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect
      .element(page.getByRole('img', { name: 'attachment' }))
      .toHaveAttribute('src', image)
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('renders projected metadata without a descriptor or URL lookup request', async () => {
    const { describe } = await mount()
    await expect.element(page.getByRole('button', { name: NAME })).toBeVisible()
    expect(describe).not.toHaveBeenCalled()
  })

  it('opens the original even if the native thumbnail request failed', async () => {
    await mount('image/png')
    await page.getByRole('button', { name: NAME }).click()
    await expect.poll(() => document.querySelector('.PhotoView-Portal')).not.toBeNull()
    await expect
      .poll(() =>
        [...document.querySelectorAll<HTMLImageElement>('.PhotoView-Portal img')].some((img) =>
          img.getAttribute('src')?.includes('purpose=original'),
        ),
      )
      .toBe(true)
  })

  it('builds original and thumbnail URLs from the same document and context', () => {
    const original = new URL(attachmentContentUrl(), location.origin)
    const thumbnail = new URL(reference.contentUrl(ID, 'reader', 'thumbnail'), location.origin)
    expect(original.pathname).toBe('/api/contents/' + ID)
    expect(original.searchParams.get('identity')).toBe('reader')
    expect(original.searchParams.get('context')).toBe('assessment/entry')
    expect(JSON.parse(original.searchParams.get('params')!)).toEqual({ entryId: ENTRY_ID })
    expect(thumbnail.searchParams.get('purpose')).toBe('thumbnail')
    original.searchParams.delete('purpose')
    thumbnail.searchParams.delete('purpose')
    expect(original.href).toBe(thumbnail.href)
    expect(original.searchParams.has('proof')).toBe(false)
  })

  it('always downloads through the identity-bound content endpoint', async () => {
    await mount()
    await expect
      .element(page.getByRole('link', { name: NAME }))
      .toHaveAttribute('href', attachmentContentUrl())
  })

  it('opens and reopens a PDF long after metadata arrived without renewing a URL', async () => {
    const received = serve(
      () => new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } }),
    )
    const { describe } = await mount()
    for (const advance of [61_000, 122_000]) {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + advance)
      await page.getByRole('button', { name: NAME }).click()
      await expect
        .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
        .not.toBeNull()
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    }
    expect(received).toEqual([attachmentContentUrl(), attachmentContentUrl()])
    expect(describe).not.toHaveBeenCalled()
  })

  it('retries a failed PDF once through the same identity-bound application URL', async () => {
    const received = serve((url) => {
      if (!new URL(url, location.origin).searchParams.has('retry'))
        throw new TypeError('read failed')
      return new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } })
    })
    const { describe } = await mount()
    await page.getByRole('button', { name: NAME }).click()
    await expect
      .poll(() => document.querySelector('iframe[title="certificate.pdf"]'))
      .not.toBeNull()
    expect(received).toEqual([attachmentContentUrl(), attachmentContentUrl() + '&retry=1'])
    expect(describe).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('stops after one failed retry and permits another explicit opening', async () => {
    const received = serve(() => new Response(null, { status: 403 }))
    await mount()
    for (const count of [2, 4]) {
      await page.getByRole('button', { name: NAME }).click()
      await expect.element(page.getByRole('dialog').getByRole('status')).toBeVisible()
      expect(received).toHaveLength(count)
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    }
  })

  it('keeps the failed image preview available without substituting another context', async () => {
    const { describe } = await mount('image/png')
    await page.getByRole('button', { name: NAME }).click()
    await expect.poll(() => document.querySelector('.PhotoView-Portal')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(describe).not.toHaveBeenCalled()
    for (const img of document.querySelectorAll<HTMLImageElement>('.PhotoView-Portal img')) {
      const src = img.getAttribute('src')
      if (src) expect(src).toContain('identity=reader')
    }
  })

  it('keeps download links stable after the file delivery window would have expired', async () => {
    await mount()
    const link = page.getByRole('link', { name: NAME })
    await expect.element(link).toHaveAttribute('href', attachmentContentUrl())
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
    await expect.element(link).toHaveAttribute('href', attachmentContentUrl())
  })

  it('shows an access failure without falling back to a file CDN URL', async () => {
    const received = serve(() => new Response(null, { status: 403 }))
    const { describe } = await mount()
    await page.getByRole('button', { name: NAME }).click()
    await expect.element(page.getByRole('dialog').getByRole('status')).toBeVisible()
    expect(received).toEqual([attachmentContentUrl(), attachmentContentUrl() + '&retry=1'])
    expect(received.every((url) => url.startsWith('/api/contents/'))).toBe(true)
    expect(document.querySelector('iframe[title="certificate.pdf"]')).toBeNull()
    expect(describe).not.toHaveBeenCalled()
  })

  it('shares projected metadata across concurrent views without batch conversion', async () => {
    const { describe } = await mount('application/pdf', 2)
    await expect.poll(() => page.getByRole('link', { name: NAME }).elements().length).toBe(2)
    expect(describe).not.toHaveBeenCalled()
    for (const link of page.getByRole('link', { name: NAME }).elements())
      expect(link.getAttribute('href')).toBe(attachmentContentUrl())
  })
})
