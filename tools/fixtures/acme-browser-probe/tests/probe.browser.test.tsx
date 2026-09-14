import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { emptyManifest, fakeClient, renderScreen } from '@qualy/testkit/browser'
import ProbePage from '@acme/qualy-browser-probe/client/ProbePage'
import { catalogs, errorMessages } from '@acme/qualy-browser-probe/client/i18n'

// A plugin from outside this repository, testing its own screen.
//
// Everything this file names, a third party has: the testkit, its own
// package's export subpaths, and its own catalogs. It reaches for no
// generated aggregate, no host harness and no other plugin - so the test a
// stranger writes for their own screen is exactly this, and the harness
// stops being something only this repository's tests can use.
//
// The package is dist-only on purpose: the screen under test is compiled
// output, resolved through the package's exports map like any dependency.

it('renders its own screen, in its own language, with nothing else assembled', async () => {
  renderScreen({
    // the shell reads one manifest before it renders anything; this plugin
    // contributes no page to it, and does not have to
    client: fakeClient({ app: { getManifest: emptyManifest() } }),
    catalogs: [catalogs],
    errorMessages,
    children: <ProbePage />,
  })

  // located the way a reader finds it, asserted on the fact it carries
  await expect.element(page.getByRole('heading', { name: '探针' })).toBeVisible()
  const standing = page.getByText('就绪')
  await expect.element(standing).toBeVisible()
  expect(await standing.element().getAttribute('data-probe-standing')).toBe('probe-3c07fe')
})
