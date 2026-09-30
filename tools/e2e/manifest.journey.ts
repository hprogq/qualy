import { describe, expect, it } from 'vitest'
import { browsing, signIn } from './support.ts'

// The manifest decides what a reader is shown, never what they may do. A
// student whose browser is handed an administrator's manifest - by a local
// override, an extension, a proxy on their own machine - gets the
// administrator's navigation and pages mounted, since the bundle carries
// every page of the assembly; and every read those pages make, and every
// write the student sends with their own session, is refused by the server,
// which decides from the session and the database alone.

/** whether an answer carries anything: a list with something in it, or a count above nought */
const holdsRecords = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === 'object' && value !== null
      ? Object.entries(value).some(
          ([key, inner]) =>
            (/^(total|count)$/i.test(key) && typeof inner === 'number' && inner > 0) ||
            holdsRecords(inner),
        )
      : false

/** what the student's pages asked of the administrator's domains */
const ADMIN_API = /^\/api\/(iam|org|audit|auth\/providers)(\/|$)/

describe('a reader handed an administrator’s manifest', () => {
  const session = browsing()

  it('mounts the administrator’s pages and is refused every read and write behind them', async () => {
    const page = session.page()
    // the administrator's manifest, as the server answers it to them
    await signIn(page, 'admin')
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/app/manifest' && response.status() === 200,
    )
    await page.goto('/organization/tree')
    const handed = await (await answered).text()

    await page.context().clearCookies()
    await signIn(page, 'student')
    await page.route('**/api/app/manifest', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: handed }),
    )
    const asked: { path: string; status: number; body: unknown }[] = []
    page.on('response', async (response) => {
      const path = new URL(response.url()).pathname
      if (!ADMIN_API.test(path)) return
      const body: unknown = response.ok() ? await response.json().catch(() => null) : null
      asked.push({ path, status: response.status(), body })
    })
    for (const route of ['/organization/tree', '/organization/roles', '/organization/users']) {
      const before = asked.length
      await page.goto(route)
      // the administrator's page is what stands here, not a sign-in or a
      // page that cannot be found: it is routed, mounted, and asking
      await expect.poll(() => asked.length, { timeout: 20_000 }).toBeGreaterThan(before)
      await page.waitForTimeout(1_500)
      expect(new URL(page.url()).pathname).toBe(route)
    }
    // refused, or answered for the reader's own reach, which is nothing: a
    // read is the asked scope intersected with the granted one, so an
    // answer with no records in it is the right one
    console.log(
      asked
        .map(
          (one) =>
            `${String(one.status)} ${one.path} ${JSON.stringify(one.body)?.slice(0, 160) ?? ''}`,
        )
        .join('\n'),
    )
    expect(asked.filter((one) => one.status < 400 && holdsRecords(one.body))).toEqual([])

    // writes the student sends with their own session, well formed
    const probe = `manifest-probe-${String(Date.now())}`
    const role = await page.request.post('/api/iam/roles', {
      data: { name: probe, kind: 'tenant' },
    })
    expect(role.status()).toBe(403)
    expect(((await role.json()) as { _tag: string })._tag).toBe('ACCESS_DENIED')
    const type = await page.request.post('/api/org/types', { data: { name: probe } })
    expect(type.status()).toBe(403)
    expect(((await type.json()) as { _tag: string })._tag).toBe('ACCESS_DENIED')

    // and nothing was made, as the administrator reads it
    await page.unroute('**/api/app/manifest')
    await page.context().clearCookies()
    await signIn(page, 'admin')
    const roles = (await (await page.request.get('/api/iam/roles')).json()) as {
      roles: { name: string }[]
    }
    expect(roles.roles.map((one) => one.name)).not.toContain(probe)
    const types = (await (await page.request.get('/api/org/types')).json()) as {
      types: { name: string }[]
    }
    expect(types.types.map((one) => one.name)).not.toContain(probe)
  })
})
