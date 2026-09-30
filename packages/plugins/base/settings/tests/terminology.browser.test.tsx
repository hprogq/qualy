import TerminologyPage from '../src/client/TerminologyPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { termRef } from '@qualy/settings-contract'
import { useTerm } from '../src/client/terms.ts'
import { TERMS_CONTEXT } from '../src/terms-context.ts'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The terminology screen and the hook every other screen reads through:
// what the tenant said wins, what it left blank falls back, and a save
// carries the version it read and brings the page's words up to date.

const term = termRef('probe/person-id')

const terminology = (override: Record<string, string> = {}, version = 0) => ({
  // what the server answers: the declarations' words, already said
  categories: [{ id: 'probe/people', label: '用户与登录', order: 10 }],
  terms: [
    {
      id: term.id,
      categoryId: 'probe/people',
      label: '人员编号',
      description: '在本机构内识别人员的业务编号',
      order: 10,
      maxLength: 64,
      defaults: { 'zh-CN': '学工号', 'en-US': 'Student or staff ID' },
      override,
      version,
    },
  ],
})

function Probe() {
  const word = useTerm(term)
  return <span data-testid="word">{word}</span>
}

describe('the tenant word for a term', () => {
  it('is the word the page was opened with', async () => {
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              context: { [TERMS_CONTEXT]: { [term.id]: '统一编号' } },
            }),
        },
      }),
      children: <Probe />,
    })
    await expect.element(page.getByTestId('word')).toHaveTextContent('统一编号')
  })

  it("stands the term's id in where nothing provides the words", async () => {
    await renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
      children: <Probe />,
    })
    await expect.element(page.getByTestId('word')).toHaveTextContent(term.id)
  })
})

describe('the terminology screen', () => {
  it('saves what was typed under the version it read, and resets to the default', async () => {
    const put = vi.fn(() =>
      Effect.succeed({ id: term.id, override: { 'zh-CN': '统一编号' }, version: 3 }),
    )
    const manifest = vi.fn(() => Effect.succeed(emptyManifest()))
    await renderScreen({
      client: fakeClient({
        app: { getManifest: manifest },
        settings: { getTerminology: () => Effect.succeed(terminology({}, 2)), putTerm: put },
      }),
      children: <TerminologyPage />,
    })
    await expect.element(page.getByText('人员编号')).toBeVisible()
    const box = page.getByLabelText('简体中文')
    await expect.element(box).toHaveAttribute('placeholder', '学工号')
    await box.fill('统一编号')
    const asked = manifest.mock.calls.length
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    // and the words every other screen reads come again with the manifest
    await vi.waitFor(() => expect(manifest.mock.calls.length).toBeGreaterThan(asked))
    const request = (put.mock.calls[0] as unknown as [{ params: unknown; payload: unknown }])[0]
    expect(request.params).toEqual({ namespace: 'probe', name: 'person-id' })
    expect(request.payload).toEqual({
      version: 2,
      override: { 'zh-CN': '统一编号', 'en-US': '' },
    })
  })
})

// Words that could not be read said the server's sentence and a retry,
// whatever the reason; ones the reader may not read are not worth a retry,
// and the answer is a pane under the page's own title.
describe('the terminology screen when the words could not be read', () => {
  it('says words the reader may not read as that, with no retry', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        settings: { getTerminology: () => Effect.fail(apiError('ACCESS_DENIED')) },
      }),
      children: <TerminologyPage />,
    })
    const state = page.getByTestId('terminology-page').getByResourceState()
    await expect.element(state).toHaveAttribute('data-state', 'denied')
    await expect.element(state.getByRole('heading', { level: 2 })).toBeVisible()
    expect(state.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
  })
})

describe('the terminology screen on a phone', () => {
  it('lists the words and opens one to change it', async () => {
    // A dozen terms is a dozen forms, and a dozen forms opened at once is a
    // screen apiece. The list says what each word is today; the boxes are
    // behind the press that changes one.
    await page.viewport(390, 844)
    const put = vi.fn(() =>
      Effect.succeed({ id: term.id, override: { 'zh-CN': '统一编号' }, version: 3 }),
    )
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        settings: { getTerminology: () => Effect.succeed(terminology({}, 2)), putTerm: put },
      }),
      children: <TerminologyPage />,
    })
    await expect.element(page.getByText('人员编号')).toBeVisible()
    // no form is open until one is asked for
    expect(page.getByLabelText('简体中文').elements()).toHaveLength(0)

    await page.getByText('人员编号').click()
    const box = page.getByLabelText('简体中文')
    await expect.element(box).toBeVisible()
    await box.fill('统一编号')
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    const request = (put.mock.calls[0] as unknown as [{ payload: unknown }])[0]
    expect(request.payload).toEqual({ version: 2, override: { 'zh-CN': '统一编号', 'en-US': '' } })
    await page.viewport(1280, 800)
  })
})
