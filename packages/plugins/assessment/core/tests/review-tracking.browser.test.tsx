import { Effect } from 'effect'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ReviewTracking } from '../src/client/review/ReviewTracking.tsx'
import { ReviewRecognitions } from '../src/client/review/ReviewRecognitions.tsx'
import { ReviewRouteTest } from '../src/client/items/editor/ReviewRouteTest.tsx'
import { draftOf } from '../src/client/items/editor/model.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const entryId = '11111111-1111-4111-8111-111111111111'
const PeoplePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/PeoplePickerView'))
const stage = {
  id: 'first',
  route: 'normal',
  label: '专业初审',
  nodeName: '计算机专业',
  roleNames: ['专业负责人'],
  current: true,
  skipped: null,
  blockedReason: null,
  reviewers: [{ id: 'reviewer-id', name: '李老师', businessNo: 'T202001' }],
}

describe('review tracking entry point', () => {
  it('offers a scoped route and current reviewer when the server permits it', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: {
          getReviewTracking: () =>
            Effect.succeed({ available: true, state: 'active', roundNo: 1, stages: [stage] }),
        },
      }),
      children: <ReviewTracking entryId={entryId} />,
    })
    await page.getByRole('button', { name: '审核去向' }).click()
    await expect.element(page.getByRole('dialog', { name: '审核去向' })).toBeVisible()
    await expect.element(page.getByText('专业初审', { exact: true })).toBeVisible()
    await expect.element(page.getByText('李老师（T202001）', { exact: true })).toBeVisible()
    await expect.element(page.getByText('当前节点', { exact: true })).toBeVisible()
  })

  it('does not offer a route or expose staff when the permission is withheld', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: {
          getReviewTracking: () => Effect.succeed({ available: false }),
        },
      }),
      children: <ReviewTracking entryId={entryId} />,
    })
    expect(page.getByRole('button', { name: '审核去向' }).elements()).toHaveLength(0)
    expect(document.body.textContent).not.toContain('T202001')
  })

  it('distinguishes waiting for the participant from waiting for a reviewer', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: {
          getReviewTracking: () =>
            Effect.succeed({
              available: true,
              state: 'awaiting_supplement',
              roundNo: 1,
              stages: [stage],
            }),
        },
      }),
      children: <ReviewTracking entryId={entryId} />,
    })
    await page.getByRole('button', { name: '审核去向' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('等待参评人员补充材料')
  })

  it('reads previous authoritative values using their frozen field labels', async () => {
    const recognition = {
      id: 'recognition-before',
      source: 'review',
      entryRevisionId: 'revision-before',
      fields: [
        {
          id: 'level',
          schema: {
            type: 'string',
            title: '当时的赛事级别',
            enum: ['national'],
            'x-qualy-enumLabels': { national: '国家级' },
          },
        },
      ],
      values: { level: 'national' },
      createdAt: '2026-09-01T00:00:00Z',
      actorName: '李老师',
      byPanel: false,
      reviewEventId: 'event-before',
      reviewInstanceId: 'round-before',
    }
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        assessment: {
          getEntryHistory: () =>
            Effect.succeed({
              revisions: [],
              events: [],
              rounds: [],
              recognitions: [
                recognition,
                {
                  ...recognition,
                  id: 'recognition-now',
                  reviewInstanceId: 'round-now',
                  values: { level: 'not-a-previous-value' },
                },
              ],
            }),
        },
      }),
      children: <ReviewRecognitions entryId={entryId} currentRound="round-now" />,
    })
    const prior = page.getByTestId('prior-recognitions')
    await expect.element(prior.getByText('当时的赛事级别', { exact: true })).toBeVisible()
    await expect.element(prior.getByText('国家级', { exact: true })).toBeVisible()
    await expect.element(prior.getByText('审核认定（李老师）', { exact: true })).toBeVisible()
    expect(prior.element().textContent).not.toContain('not-a-previous-value')
  })

  it('tests an unsaved policy for a selected batch participant', async () => {
    const preview = vi.fn(() => Effect.succeed({ stages: [stage] }))
    const draft = draftOf(null, [], { orgTypes: [], roles: [] })
    draft.title = '未保存的题目'
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              slots: { 'iam/people-picker-view': [{ id: 'auth/people-picker-view', order: 0 }] },
            }),
        },
        assessment: {
          listRosterUnits: () =>
            Effect.succeed({
              units: [{ id: 'unit', name: '软件学院', parentId: null }],
              userTypes: [],
            }),
          listParticipants: () =>
            Effect.succeed({
              items: [
                {
                  id: 'participant',
                  userId: 'user',
                  displayName: '周予安',
                  businessNo: '20230001',
                  userTypeId: 'student',
                  anchorNodeId: 'unit',
                  status: 'active',
                },
              ],
              nextCursor: null,
            }),
          previewReviewRoutes: preview,
        },
      }),
      registry: {
        slots: { 'iam/people-picker-view': { 'auth/people-picker-view': PeoplePickerView } },
      },
      children: <ReviewRouteTest batchId={entryId} draft={draft} />,
    })
    await page.getByRole('button', { name: '测试审核链条', exact: true }).click()
    await page.getByRole('checkbox', { name: '周予安' }).click()
    await expect.element(page.getByText('李老师（T202001）', { exact: true })).toBeVisible()
    expect(preview).toHaveBeenCalledWith({
      params: { batchId: entryId },
      payload: {
        participantId: 'participant',
        policy: { normal: { stages: [] }, escalation: { stages: [] } },
      },
    })
  })
})
