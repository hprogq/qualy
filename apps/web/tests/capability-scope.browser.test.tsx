import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import {
  emptyComponentRegistry,
  RuntimeProvider,
  WorkspaceCapabilityScope,
  usePublishWorkspaceCapabilities,
  useWorkspaceCapabilities,
  type Manifest,
} from '@qualy/web-runtime'

beforeEach(() => {
  document.documentElement.dataset['locale'] = 'en-US'
})
afterEach(() => {
  delete document.documentElement.dataset['locale']
})

// The capability scope's one contract: a gated entry never shows before the
// workspace has spoken, shows exactly while its token is published, and
// disappears when the publisher withdraws. The shell consumes this with the
// same three-line predicate probed here.

function Rail() {
  const capabilities = useWorkspaceCapabilities()
  const items = [
    { id: 'plain', label: '总览' },
    { id: 'gated', label: '审核', capability: 'assessment/review' },
  ]
  return (
    <ul>
      {items
        .filter(
          (item) =>
            item.capability === undefined ||
            (capabilities.status === 'ready' && capabilities.values.has(item.capability)),
        )
        .map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
    </ul>
  )
}

function Publisher({ tokens }: { tokens: readonly string[] | null }) {
  usePublishWorkspaceCapabilities(tokens === null ? null : new Set(tokens))
  return null
}

function Harness() {
  const [tokens, setTokens] = useState<readonly string[] | null>(null)
  return (
    <WorkspaceCapabilityScope>
      <Publisher tokens={tokens} />
      <Rail />
      <button type="button" onClick={() => setTokens(['assessment/review'])}>
        publish
      </button>
      <button type="button" onClick={() => setTokens(null)}>
        withdraw
      </button>
    </WorkspaceCapabilityScope>
  )
}

describe('the workspace capability scope', () => {
  it('hides gated entries until published, shows them while held, and takes them back', async () => {
    await render(<Harness />)

    // before anything is published: ungated renders, gated does not flash in
    await expect.element(page.getByText('总览')).toBeVisible()
    expect(page.getByText('审核').elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'publish' }).click()
    await expect.element(page.getByText('审核')).toBeVisible()

    await page.getByRole('button', { name: 'withdraw' }).click()
    await expect.element(page.getByText('总览')).toBeVisible()
    expect(page.getByText('审核').elements()).toHaveLength(0)
  })

  const manifest: Manifest = {
    viewer: 'authenticated',
    identity: 'capability-reader',
    layouts: [],
    pages: [],
    slots: {},
    collections: {},
    context: {},
  }
  const registry = emptyComponentRegistry()
  const serverTokens = ['assessment/review']
  const draw = (
    publisher: ReactNode,
    initialWorkspaceCapabilities: readonly string[] | undefined,
    pathname = '/batch/a/results',
  ) => (
    <UiProvider scheme="light">
      <RuntimeProvider {...{ registry, manifest, initialWorkspaceCapabilities }}>
        <WorkspaceCapabilityScope pathname={pathname}>
          {publisher}
          <Rail />
        </WorkspaceCapabilityScope>
      </RuntimeProvider>
    </UiProvider>
  )

  it('retains the server projection while a replacement context component is loading', async () => {
    const screen = await render(draw(<Publisher tokens={serverTokens} />, serverTokens))
    const review = page.getByText('审核')
    await expect.element(review).toBeVisible()
    const original = review.element()

    // A context slot can leave before its replacement is mounted. This is
    // not a new authorization result: the server projection remains known.
    await screen.rerender(draw(<p>Loading publisher</p>, serverTokens))
    await expect.element(page.getByText('Loading publisher')).toBeVisible()
    expect(review.element()).toBe(original)
    await screen.rerender(draw(<Publisher tokens={serverTokens} />, serverTokens))
    await expect.element(page.getByText('Loading publisher')).not.toBeInTheDocument()
    expect(review.element()).toBe(original)
  })

  it('still withdraws when the live workspace explicitly reports that it is loading', async () => {
    const screen = await render(draw(<Publisher tokens={serverTokens} />, serverTokens))
    await expect.element(page.getByText('审核')).toBeVisible()
    await screen.rerender(draw(<Publisher tokens={null} />, serverTokens))
    await expect.element(page.getByText('审核')).not.toBeInTheDocument()
  })

  it('does not retain a publication over a new server projection or another path', async () => {
    const screen = await render(draw(<Publisher tokens={serverTokens} />, serverTokens))
    await expect.element(page.getByText('审核')).toBeVisible()
    await screen.rerender(draw(null, []))
    await expect.element(page.getByText('审核')).not.toBeInTheDocument()
    await screen.rerender(draw(<Publisher tokens={serverTokens} />, serverTokens))
    await expect.element(page.getByText('审核')).toBeVisible()
    await screen.rerender(draw(null, undefined, '/batch/b/results'))
    await expect.element(page.getByText('审核')).not.toBeInTheDocument()
  })

  it('does not let an outgoing publisher withdraw its replacement', async () => {
    const screen = await render(draw(<Publisher key="old" tokens={null} />, undefined))
    await screen.rerender(
      draw(
        <>
          <Publisher key="old" tokens={null} />
          <Publisher key="next" tokens={serverTokens} />
        </>,
        undefined,
      ),
    )
    await expect.element(page.getByText('审核')).toBeVisible()
    await screen.rerender(
      draw(
        <>
          <Publisher key="next" tokens={serverTokens} />
        </>,
        undefined,
      ),
    )
    await expect.element(page.getByText('审核')).toBeVisible()
    await screen.rerender(draw(null, undefined))
    await expect.element(page.getByText('审核')).not.toBeInTheDocument()
  })
})
