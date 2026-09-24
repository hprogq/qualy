import TerminologyPage from '../src/client/TerminologyPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { defineSettingCategory, defineTerm } from '@qualy/settings-contract'
import { literal } from '@qualy/i18n-contract'
import { useTerm } from '../src/client/terms.ts'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The terminology screen and the hook every other screen reads through:
// what the tenant said wins, what it left blank falls back, and a save
// carries the version it read.

const category = defineSettingCategory({
  id: 'probe/people',
  label: literal('用户与登录'),
  order: 10,
})

const term = defineTerm({
  id: 'probe/person-id',
  categoryId: category.id,
  label: literal('人员编号'),
  description: literal('在本机构内识别人员的业务编号'),
  defaults: { 'zh-CN': '学工号', 'en-US': 'Student or staff ID' },
  order: 10,
})

const terminology = (override: Record<string, string> = {}, version = 0) => ({
  categories: [{ id: category.id, label: category.label, order: category.order }],
  terms: [
    {
      id: term.id,
      categoryId: term.categoryId,
      label: term.label,
      description: term.description ?? null,
      order: term.order,
      maxLength: term.maxLength,
      defaults: term.defaults,
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
  it('is the override where one was chosen, the default elsewhere', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        settings: { getTerminology: () => Effect.succeed(terminology({ 'zh-CN': '统一编号' }, 2)) },
      }),
      children: <Probe />,
    })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="word"]')?.textContent).toBe('统一编号'),
    )
  })

  it('shows the default while the words cannot be reached', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        settings: { getTerminology: () => Effect.fail(apiError('SETTING_NOT_FOUND')) },
      }),
      children: <Probe />,
    })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="word"]')?.textContent).toBe('学工号'),
    )
  })
})

describe('the terminology screen', () => {
  it('saves what was typed under the version it read, and resets to the default', async () => {
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
    const box = page.getByLabelText('简体中文')
    await expect.element(box).toHaveAttribute('placeholder', '学工号')
    await box.fill('统一编号')
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    const request = (put.mock.calls[0] as unknown as [{ params: unknown; payload: unknown }])[0]
    expect(request.params).toEqual({ namespace: 'probe', name: 'person-id' })
    expect(request.payload).toEqual({
      version: 2,
      override: { 'zh-CN': '统一编号', 'en-US': '' },
    })
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
