import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  WorkspaceCapabilityScope,
  usePublishWorkspaceCapabilities,
  useWorkspaceCapabilities,
} from '@qualy/web-runtime'

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
    render(<Harness />)

    // before anything is published: ungated renders, gated does not flash in
    await expect.element(page.getByText('总览')).toBeVisible()
    expect(await page.getByText('审核').elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'publish' }).click()
    await expect.element(page.getByText('审核')).toBeVisible()

    await page.getByRole('button', { name: 'withdraw' }).click()
    await expect.element(page.getByText('总览')).toBeVisible()
    expect(await page.getByText('审核').elements()).toHaveLength(0)
  })
})
