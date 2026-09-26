import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { NewBatchDialog } from '../src/client/NewBatchForm.tsx'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A batch is made of people, chosen by unit and by kind. With a unit to
// choose from but no kind of person enabled, the dialog took a name and two
// dates and then offered a grey line where the kinds would be, under a
// create button that could never be pressed.

const NODE_ID = '55555555-5555-4555-8555-555555555555'

describe('creating a batch with no kind of person to take', () => {
  it('says so before anything is typed, and offers only the way out', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: {
          listScopeOptions: () =>
            Effect.succeed({
              nodes: [
                { id: NODE_ID, name: '软件学院', path: 'r.se', depth: 1, orgTypeId: NODE_ID },
              ],
            }),
          listUserTypeOptions: () => Effect.succeed({ userTypes: [] }),
        },
      }),
      children: <NewBatchDialog open onClose={() => {}} onCreated={() => {}} />,
    })
    const dialog = page.getByRole('dialog')
    await expect
      .element(dialog.getByTestId('new-batch-stuck'))
      .toHaveAttribute('data-kind', 'no-types')
    expect(dialog.getByRole('textbox').elements()).toHaveLength(0)
    expect(dialog.getByRole('button', { name: '下一步' }).elements()).toHaveLength(0)
    await expect.element(dialog.getByRole('button', { name: '关闭' }).first()).toBeVisible()
  })
})
