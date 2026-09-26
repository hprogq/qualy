import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { PageLink } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// A link that names a page by id, for a reader who may not be able to open
// that page: a link where the manifest has it, and otherwise what the caller
// said to draw instead - the words themselves by default, nothing at all
// when the caller said nothing.

const shown = () => ({
  ...emptyManifest(),
  layouts: [{ contract: 'app-shell/v1' }],
  pages: [{ id: 'auth/users', path: '/organization/users', layout: 'app-shell/v1' }],
})

const mount = (children: React.ReactNode) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(shown()) } }),
    children: <div data-testid="links">{children}</div>,
  })

describe('a link to a page by its id', () => {
  it('leads to a page the reader can open', async () => {
    await mount(<PageLink page="auth/users">people</PageLink>)
    await expect
      .element(page.getByRole('link', { name: 'people' }))
      .toHaveAttribute('href', '/organization/users')
  })

  it('keeps its words, unlinked, for a page the reader cannot open', async () => {
    await mount(<PageLink page="rbac/roles">roles</PageLink>)
    await expect.element(page.getByTestId('links')).toHaveTextContent('roles')
    expect(page.getByRole('link').elements()).toHaveLength(0)
  })

  it('draws nothing at all there when told to', async () => {
    await mount(
      <>
        <PageLink page="rbac/roles" unavailable={null}>
          roles
        </PageLink>
        <PageLink page="rbac/roles" unavailable={<span>no roles</span>}>
          roles
        </PageLink>
      </>,
    )
    await expect.element(page.getByTestId('links')).toHaveTextContent('no roles')
    expect(page.getByTestId('links').element().textContent).toBe('no roles')
  })
})
