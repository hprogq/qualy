import { useState } from 'react'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import FormulaListPage from '../src/client/FormulaListPage.tsx'
import FormulaTemplatesPage from '../src/client/FormulaTemplatesPage.tsx'
import { VersionsDrawer, type HistoryList } from '../src/client/VersionsDrawer.tsx'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const row = (at: number) => ({
  id: `formula-${at}`,
  name: `Formula ${at}`,
  description: null,
  authorUserId: 'author',
  status: 'active',
  draftRevision: 1,
  detailsRevision: 1,
  latestVersionNo: null,
  latestReleaseName: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  versionId: `version-${at}`,
  functionId: `formula-${at}`,
  functionName: `Formula ${at}`,
  versionNo: at,
  releaseName: `Release ${at}`,
  releaseNotes: null,
  metadataRevision: 1,
  publishedByName: 'Author',
  publishedAt: '2026-10-01T00:00:00.000Z',
  authorName: 'Author',
  parameters: [],
  sourceStatus: 'active',
  revisionNo: at,
  origin: 'saved',
  savedByName: 'Author',
  savedAt: '2026-10-01T00:00:00.000Z',
  sourceVersion: null,
  sourceDraftRevisionNo: null,
})

describe('formula numbered pages', () => {
  for (const [name, endpoint, Page, testId] of [
    ['library', 'listFormulaFunctions', FormulaListPage, 'formula-row'],
    ['templates', 'listFormulaTemplates', FormulaTemplatesPage, 'template-row'],
  ] as const) {
    it(`${name} jumps to a numbered page and resets the page atomically with search`, async () => {
      const list = vi.fn(({ query }: { query: Record<string, string> }) => {
        const total = query['search'] ? 1 : 151
        const at = Math.min(Number(query['page']), Math.ceil(total / 50))
        return Effect.succeed({ items: [row(at)], total, page: at, pageSize: 50 })
      })
      await renderScreen({
        client: fakeClient({
          app: { getManifest: emptyManifest() },
          assessmentFormula: { [endpoint]: list },
        }),
        route: '/library?page=2',
        path: '/library',
        children: <Page />,
      })
      const pager = page.getByTestId('formula-pager')
      await expect.element(pager).toHaveAttribute('data-page', '2')
      await pager.getByRole('button', { name: '4', exact: true }).click()
      await expect.element(pager).toHaveAttribute('data-page', '4')
      expect(page.getByTestId(testId).elements()).toHaveLength(1)
      expect(addressNow()).toContain('page=4')
      await page.getByRole('textbox').fill('Needle')
      await vi.waitFor(() =>
        expect(list).toHaveBeenLastCalledWith({ query: { page: '1', search: 'Needle' } }),
      )
      expect(
        list.mock.calls.some(
          ([request]) => request.query['search'] && request.query['page'] !== '1',
        ),
      ).toBe(false)
      expect(addressNow()).not.toContain('page=')
    })
  }

  it('keeps the old page during loading, disables paging, and moves keyboard focus to results', async () => {
    let finish: (() => void) | undefined
    const list = ({ query }: { query: Record<string, string> }) => {
      const at = Number(query['page'])
      const result = { items: [row(at)], total: 151, page: at, pageSize: 50 }
      return at === 1
        ? Effect.succeed(result)
        : Effect.promise(
            () =>
              new Promise<typeof result>((resolve) => {
                finish = () => resolve(result)
              }),
          )
    }
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessmentFormula: { listFormulaFunctions: list },
      }),
      route: '/library',
      path: '/library',
      children: <FormulaListPage />,
    })
    const next = page.getByRole('button', { name: '下一页' })
    await expect.element(next).toBeEnabled()
    ;(next.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(next).toBeDisabled()
    expect(page.getByTestId('formula-row').element().textContent).toContain('Formula 1')
    expect(document.activeElement?.hasAttribute('data-formula-results')).toBe(true)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish!()
    await vi.waitFor(() =>
      expect(page.getByTestId('formula-row').element().textContent).toContain('Formula 2'),
    )
    await expect.element(next).toBeEnabled()
  })

  it('keeps every control within a 320px viewport and uses the server corrected page', async () => {
    await page.viewport(320, 740)
    try {
      await renderScreen({
        client: fakeClient({
          app: { getManifest: emptyManifest() },
          assessmentFormula: {
            listFormulaTemplates: { items: [row(4)], page: 4, pageSize: 50, total: 151 },
          },
        }),
        route: '/library?page=999',
        path: '/library',
        children: <FormulaTemplatesPage />,
      })
      const pager = page.getByTestId('formula-pager')
      await expect.element(pager).toHaveAttribute('data-page', '4')
      for (const button of pager.getByRole('button').elements()) {
        const bounds = button.getBoundingClientRect()
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(320)
      }
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('requests only the chosen release or revision page inside the history drawer', async () => {
    const versions = vi.fn(({ query }: { query: Record<string, string> }) =>
      Effect.succeed({
        items: [row(Number(query['page']))],
        total: 151,
        page: Number(query['page']),
        pageSize: 50,
      }),
    )
    const revisions = vi.fn(({ query }: { query: Record<string, string> }) =>
      Effect.succeed({
        items: [row(Number(query['page']))],
        total: 151,
        page: Number(query['page']),
        pageSize: 50,
      }),
    )
    function History() {
      const [list, onList] = useState<HistoryList>('releases')
      return (
        <VersionsDrawer
          open
          onOpenChange={() => {}}
          narrow={false}
          functionId="formula"
          versionCount={151}
          latestVersionNo={151}
          draftRevision={151}
          view={{ kind: 'draft' }}
          onView={() => {}}
          list={list}
          onList={onList}
          archived={false}
          restoring={false}
          onRestoreRelease={() => {}}
          onRestoreRevision={() => {}}
          onShare={() => {}}
          onEditInfo={() => {}}
        />
      )
    }
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessmentFormula: {
          listFormulaVersions: versions,
          getFormulaVersion: { version: row(1) },
          listFormulaDraftRevisions: revisions,
          listFormulaShareOptions: { nodes: [], truncated: false },
        },
      }),
      route: '/history',
      path: '/history',
      children: <History />,
    })
    const releasesPager = page.getByTestId('formula-versions-pager')
    await releasesPager.getByRole('button', { name: '4', exact: true }).click()
    await expect.element(releasesPager).toHaveAttribute('data-page', '4')
    expect(new Set(versions.mock.calls.map(([request]) => request.query['page']))).toEqual(
      new Set(['1', '4']),
    )
    expect(revisions).not.toHaveBeenCalled()
    await page.getByRole('tab').nth(1).click()
    const revisionsPager = page.getByTestId('formula-revisions-pager')
    await revisionsPager.getByRole('button', { name: '4', exact: true }).click()
    await expect.element(revisionsPager).toHaveAttribute('data-page', '4')
    expect(new Set(revisions.mock.calls.map(([request]) => request.query['page']))).toEqual(
      new Set(['1', '4']),
    )
    expect(page.getByTestId('formula-revision').elements()).toHaveLength(1)
  })
})
