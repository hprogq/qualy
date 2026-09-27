import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { NodeDialogs, type NodeTask } from '../src/client/structure/NodeDialogs.tsx'
import { shapeOf } from '../src/client/shape.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A task on a unit that has nothing it could do. Creating under a kind that
// holds no other kind drew one grey sentence over an empty name field and a
// create button that could never be pressed; a move with nowhere to land drew
// a screen-sized blank inside the dialog.

const SCHOOL_TYPE = '11111111-1111-4111-8111-111111111101'
const CLASS_TYPE = '11111111-1111-4111-8111-111111111103'
const ROOT = '22222222-2222-4222-8222-222222222201'
const KLASS = '22222222-2222-4222-8222-222222222203'

const shape = shapeOf({
  rootIds: [ROOT],
  nodes: [
    {
      id: ROOT,
      name: '示例大学',
      parentId: null,
      orgTypeId: SCHOOL_TYPE,
      depth: 0,
      sortOrder: 0,
      manageable: true,
      subtreeManageable: true,
      subtreeVisible: true,
    },
    {
      id: KLASS,
      name: '软件2301班',
      parentId: ROOT,
      orgTypeId: CLASS_TYPE,
      depth: 1,
      sortOrder: 0,
      manageable: true,
      subtreeManageable: true,
      subtreeVisible: true,
    },
  ] as never,
  types: [
    { id: SCHOOL_TYPE, name: '学校', sortOrder: 0 },
    { id: CLASS_TYPE, name: '班级', sortOrder: 1 },
  ] as never,
  // a class holds nothing, and only a school holds a class
  rules: [{ parentTypeId: SCHOOL_TYPE, childTypeId: CLASS_TYPE }],
})

const open = (task: NodeTask, onOpenRules = vi.fn()) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
    children: (
      <NodeDialogs
        task={task}
        shape={shape}
        api={{}}
        run={() => Promise.resolve()}
        onDone={() => {}}
        onOpenRules={onOpenRules}
      />
    ),
  })

describe('a unit task with nothing to do', () => {
  it('answers creating under a kind that holds nothing, with the way to its rules', async () => {
    const onOpenRules = vi.fn()
    await open({ kind: 'create', nodeId: KLASS }, onOpenRules)
    const dialog = page.getByRole('dialog')
    const answer = dialog.getByTestId('create-nowhere')
    await expect.element(answer).toBeVisible()
    expect(answer.element().querySelector('[data-slot="empty"]')?.getAttribute('data-size')).toBe(
      'compact',
    )
    // the unit is named once, by the dialog's title, not again by the answer
    expect(dialog.element().textContent?.split('软件2301班')).toHaveLength(2)
    expect(answer.element().textContent).not.toContain('软件2301班')
    // nothing to type, nothing to press but the way out
    expect(dialog.getByRole('textbox').elements()).toHaveLength(0)
    expect(dialog.getByRole('button', { name: '创建' }).elements()).toHaveLength(0)
    await answer.getByRole('button').click()
    expect(onOpenRules).toHaveBeenCalledWith(CLASS_TYPE)
  })

  it('answers a move with nowhere to land in the dialog’s own measure', async () => {
    await open({ kind: 'move', nodeId: ROOT })
    const answer = page.getByTestId('move-nowhere')
    await expect.element(answer).toBeVisible()
    expect(answer.element().querySelector('[data-slot="empty"]')?.getAttribute('data-size')).toBe(
      'compact',
    )
  })
})
