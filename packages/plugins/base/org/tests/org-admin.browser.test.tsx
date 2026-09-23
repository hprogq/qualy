import OrgPage from '../src/client/OrgPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime

// The organization screen: a tree to find a unit, a panel to manage it, and
// a second face where the type grammar is edited per type. What is pinned
// here is the part the api cannot see - that the create control offers only
// the child types the rules allow, and that saving the grammar writes the
// pair diff rather than a wholesale replace.

const SCHOOL_TYPE = '11111111-1111-4111-8111-111111111101'
const COLLEGE_TYPE = '11111111-1111-4111-8111-111111111102'
const CLASS_TYPE = '11111111-1111-4111-8111-111111111103'
const ROOT = '22222222-2222-4222-8222-222222222201'
const COLLEGE = '22222222-2222-4222-8222-222222222202'
const KLASS = '22222222-2222-4222-8222-222222222203'

const node = (over: {
  id: string
  name: string
  parentId: string | null
  orgTypeId: string
  depth: number
  manageable?: boolean
  subtreeVisible?: boolean
}) => ({
  sortOrder: 0,
  manageable: true,
  subtreeManageable: true,
  subtreeVisible: true,
  ...over,
})

const world = () => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  org: {
    getTree: () =>
      Effect.succeed({
        roots: [ROOT],
        nodes: [
          node({ id: ROOT, name: '示例大学', parentId: null, orgTypeId: SCHOOL_TYPE, depth: 0 }),
          node({
            id: COLLEGE,
            name: '软件学院',
            parentId: ROOT,
            orgTypeId: COLLEGE_TYPE,
            depth: 1,
          }),
          node({
            id: KLASS,
            name: '软件2301班',
            parentId: COLLEGE,
            orgTypeId: CLASS_TYPE,
            depth: 2,
          }),
        ],
      }),
    listTypes: () =>
      Effect.succeed({
        types: [
          { id: SCHOOL_TYPE, name: '学校', sortOrder: 0 },
          { id: COLLEGE_TYPE, name: '学院', sortOrder: 1 },
          { id: CLASS_TYPE, name: '班级', sortOrder: 2 },
        ],
      }),
    listRules: () =>
      Effect.succeed({
        rules: [
          { parentTypeId: SCHOOL_TYPE, childTypeId: COLLEGE_TYPE },
          { parentTypeId: COLLEGE_TYPE, childTypeId: CLASS_TYPE },
        ],
      }),
    // what holds a unit in place, as the server counts it: the college has
    // the class under it, and nothing else points at anything
    listDeletedNodes: () => Effect.succeed({ nodes: [] }),
    getNodeUsage: ({ params }: { params: { nodeId: string } }) =>
      Effect.succeed({
        isRoot: params.nodeId === ROOT,
        children: params.nodeId === COLLEGE ? 1 : 0,
        usage: [] as {
          kind: string
          label: { kind: 'literal'; value: string }
          count: number
          examples: string[]
          target: null
        }[],
      }),
  },
  // headcounts come from whoever owns people; the screen reads them and
  // tolerates being refused, so the stub answers with a roster of nobody
  identity: {
    getUserOptions: () =>
      Effect.succeed({
        truncated: false,
        nodes: [],
        orgTypes: [],
        userTypes: [],
      }),
  },
})

describe('the organization screen', () => {
  // Moving a unit re-anchors real authority, so what the picker offers is
  // the contract: never itself or its descendants, never its current
  // parent, and only units whose type the grammar allows above it.
  it('moves a unit to a legal new parent only, and sends that parent', async () => {
    const move = vi.fn(() => Effect.succeed({ ok: true }))
    const client = world()
    const COLLEGE2 = '22222222-2222-4222-8222-222222222204'
    client.org.getTree = () =>
      Effect.succeed({
        roots: [ROOT],
        nodes: [
          node({ id: ROOT, name: '示例大学', parentId: null, orgTypeId: SCHOOL_TYPE, depth: 0 }),
          node({
            id: COLLEGE,
            name: '软件学院',
            parentId: ROOT,
            orgTypeId: COLLEGE_TYPE,
            depth: 1,
          }),
          node({
            id: COLLEGE2,
            name: '外国语学院',
            parentId: ROOT,
            orgTypeId: COLLEGE_TYPE,
            depth: 1,
          }),
          node({
            id: KLASS,
            name: '软件2301班',
            parentId: COLLEGE,
            orgTypeId: CLASS_TYPE,
            depth: 2,
          }),
        ],
      })
    renderScreen({
      client: fakeClient({
        ...client,
        org: { ...client.org, setNodePlacement: move },
      }),
      route: `/admin/org?node=${KLASS}`,
      children: <OrgPage />,
    })

    await page.getByRole('button', { name: '移动至' }).click()
    // no unit picker is installed in this harness, so the dialog falls back
    // to the legal places by name - the same set the picker would leave live
    await expect.element(page.getByTestId('node-task')).toHaveAttribute('data-task', 'move')
    await page.getByRole('combobox', { name: '移动至' }).click()
    const listbox = page.getByRole('listbox')
    await expect.element(listbox).toBeVisible()
    // the one legal destination, and none of the illegal ones
    await expect.element(listbox.getByRole('option', { name: '外国语学院' })).toBeVisible()
    expect(await listbox.getByRole('option', { name: '软件2301班' }).elements()).toHaveLength(0)
    expect(
      await listbox.getByRole('option', { name: '软件学院', exact: false }).elements(),
    ).toHaveLength(0)
    expect(await listbox.getByRole('option', { name: '示例大学' }).elements()).toHaveLength(0)

    await listbox.getByRole('option', { name: '外国语学院' }).click()
    await page.getByRole('button', { name: '移动', exact: true }).click()
    await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(1))
    expect(move).toHaveBeenCalledWith({
      params: { nodeId: KLASS },
      payload: { parentId: COLLEGE2 },
    })
  })

  // Deleting asks first and is only offered where the two counts allow it;
  // a unit with children keeps the button struck through and inert.
  it('deletes an empty leaf through the confirmation, and bars a parent', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true }))
    const client = world()
    renderScreen({
      client: fakeClient({ ...client, org: { ...client.org, deleteNode: remove } }),
      route: `/admin/org?node=${KLASS}`,
      children: <OrgPage />,
    })

    const del = page.getByRole('button', { name: '删除组织' })
    await expect.element(del).toBeEnabled()
    await del.click()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    await page.getByRole('button', { name: '取消' }).click()
    expect(remove).not.toHaveBeenCalled()

    await del.click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除组织' }).click()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove).toHaveBeenCalledWith({ params: { nodeId: KLASS } })
  })

  it('keeps deletion barred while a unit still holds children', async () => {
    const client = world()
    renderScreen({
      client: fakeClient(client),
      route: `/admin/org?node=${COLLEGE}`,
      children: <OrgPage />,
    })
    const del = page.getByRole('button', { name: '删除组织' })
    await expect.element(del).toBeDisabled()
    // the bar names its reason as data, beside the struck action
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  })

  // A tree is what this reader may SEE, not what is there. A reader whose
  // reach ends at a unit is sent that unit alone, which on the wire is
  // indistinguishable from a leaf - so what is under a unit is counted by
  // the server, whoever is asking, and the screen believes that count.
  it('keeps deletion barred where the server counts units the tree does not show', async () => {
    const client = world()
    client.org.getTree = () =>
      Effect.succeed({
        roots: [COLLEGE],
        nodes: [
          node({
            id: COLLEGE,
            name: '软件学院',
            parentId: ROOT,
            orgTypeId: COLLEGE_TYPE,
            depth: 1,
            subtreeVisible: false,
          }),
        ],
      })
    client.org.getNodeUsage = () => Effect.succeed({ isRoot: false, children: 3, usage: [] })
    renderScreen({
      client: fakeClient(client),
      route: `/admin/org?node=${COLLEGE}`,
      children: <OrgPage />,
    })
    await expect.element(page.getByRole('button', { name: '删除组织' })).toBeDisabled()
    await expect
      .element(page.getByTestId('node-delete'))
      .toHaveAttribute('data-removable', 'false')
  })

  // Everything else that points at a unit lives in plugins org cannot see.
  // They say so before the delete is offered - how many, a few by name - so
  // a refusal is never the first the reader hears of it, and never says
  // only "something".
  it('lists what else holds a unit in place, and bars the delete while anything does', async () => {
    const client = world()
    client.org.getNodeUsage = () =>
      Effect.succeed({
        isRoot: false,
        children: 0,
        usage: [
          {
            kind: 'people',
            label: { kind: 'literal' as const, value: '在该组织的用户' },
            count: 12,
            clearable: true,
            examples: ['张明远', '李文静'],
            target: null,
          },
        ],
      }) as never
    renderScreen({
      client: fakeClient(client),
      route: `/admin/org?node=${KLASS}`,
      children: <OrgPage />,
    })
    await expect.element(page.getByRole('button', { name: '删除组织' })).toBeDisabled()
    // the button is barred while the usage is still on its way, so the hold
    // is waited for rather than read the moment the button says no
    await expect
      .poll(() =>
        document
          .querySelector('[data-testid="node-delete"] [data-hold="people"]')
          ?.getAttribute('data-count'),
      )
      .toBe('12')
    // by name, because a count alone is still a search
    await expect.element(page.getByText('张明远', { exact: false })).toBeVisible()
  })

  it('does not let what merely remembers a unit bar its delete', async () => {
    const client = world()
    client.org.getNodeUsage = () =>
      Effect.succeed({
        isRoot: false,
        children: 0,
        usage: [
          {
            kind: 'archived-rounds',
            label: { kind: 'literal' as const, value: '已归档批次' },
            count: 2,
            clearable: false,
            examples: [],
            target: null,
          },
        ],
      }) as never
    renderScreen({
      client: fakeClient(client),
      route: `/admin/org?node=${KLASS}`,
      children: <OrgPage />,
    })
    await expect
      .element(page.getByTestId('node-delete'))
      .toHaveAttribute('data-removable', 'true')
    expect(document.querySelector('[data-hold="archived-rounds"]')).toBeNull()
  })

  it('lists what was deleted and puts one back, holding a unit whose parent is gone too', async () => {
    const restore = vi.fn(() => Effect.succeed({ ok: true as const }))
    const client = world()
    renderScreen({
      client: fakeClient({
        ...client,
        org: {
          ...client.org,
          restoreNode: restore,
          listDeletedNodes: () =>
            Effect.succeed({
              nodes: [
                {
                  id: 'gone-1',
                  name: '软件工程 2201 班',
                  orgTypeId: 'none',
                  parentName: '软件学院',
                  restorable: true,
                  deletedAt: '2026-09-20T08:00:00.000Z',
                },
                {
                  id: 'gone-2',
                  name: '旧实验班',
                  orgTypeId: 'none',
                  parentName: '旧学院',
                  restorable: false,
                  deletedAt: '2026-09-19T08:00:00.000Z',
                },
              ],
            }),
        },
      }),
      route: '/admin/org',
      children: <OrgPage />,
    })
    await page.getByTestId('org-bin-open').click()
    const rows = page.getByTestId('bin-row')
    await expect.element(rows.first()).toBeVisible()
    expect(rows.elements().map((row) => row.getAttribute('data-restorable'))).toEqual([
      'true',
      'false',
    ])
    await expect.element(rows.nth(1).getByRole('button')).toBeDisabled()
    await rows.first().getByRole('button').click()
    await expect.poll(() => restore.mock.calls.length).toBe(1)
    expect((restore.mock.calls[0] as unknown[])[0]).toMatchObject({ params: { nodeId: 'gone-1' } })
  })

  it('opens a unit from the tree and creates a child of a legal type only', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created' }))
    const client = world()
    renderScreen({
      client: fakeClient({ ...client, org: { ...client.org, createNode: create } }),
      route: `/admin/org?node=${COLLEGE}`,
      children: <OrgPage />,
    })

    // the unit, its place, and its children as rows
    await expect.element(page.getByRole('heading', { name: /软件学院/ })).toBeInTheDocument()
    const crumbs = page.getByRole('navigation', { name: '位置' })
    // each step above is a way back to it; the unit itself is where you are
    await expect.element(crumbs.getByRole('button', { name: '示例大学' })).toBeVisible()
    expect(crumbs.element().querySelector('[aria-current="page"]')?.textContent).toBe('软件学院')
    // and what stands under it, as a row of the table
    await expect
      .element(page.getByTestId('child-row'))
      .toHaveAttribute('data-node-name', '软件2301班')

    // a college may hold classes and nothing else, so the dialog offers
    // exactly that - already chosen, since there is nothing to choose between -
    // and the rule never gets a chance to become an error
    await page.getByRole('button', { name: '新建下级组织' }).click()
    const task = page.getByTestId('node-task')
    await expect.element(task).toHaveAttribute('data-task', 'create')
    await task.getByRole('combobox').click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await vi.waitFor(() =>
      expect(page.getByRole('option').elements(), 'exactly the one legal child type').toHaveLength(
        1,
      ),
    )
    await page.getByRole('option', { name: '班级' }).click()
    await task.getByRole('textbox', { name: '名称' }).fill('软件2302班')
    await page.getByRole('button', { name: '创建', exact: true }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { parentId: COLLEGE, orgTypeId: CLASS_TYPE, name: '软件2302班' },
    })
  })

  // Reading a unit and folding its branch are different errands, and the
  // rail used to do both on one press: choosing a college to look at it
  // folded the college away, taking the classes under it off the screen.
  // What is done to a unit is offered on its own row, so adding a class to a
  // college does not start with opening the college.
  it('starts a task from the unit\'s own row, without opening the unit', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created' }))
    const client = world()
    renderScreen({
      client: fakeClient({ ...client, org: { ...client.org, createNode: create } }),
      route: '/admin/org',
      children: <OrgPage />,
    })
    await page.getByRole('button', { name: '在软件学院下新建组织' }).click()
    const task = page.getByTestId('node-task')
    await expect.element(task).toHaveAttribute('data-task', 'create')
    // the unit itself stayed shut
    expect(document.querySelector('[data-testid="node-sheet"]')).toBeNull()
    await task.getByRole('textbox', { name: '名称' }).fill('软件2302班')
    await page.getByRole('button', { name: '创建', exact: true }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { parentId: COLLEGE, orgTypeId: CLASS_TYPE, name: '软件2302班' },
    })
    // a class may hold nothing: the way to add under it is there and barred,
    // so the column reads the same down the tree and says why
    await expect
      .element(page.getByRole('button', { name: '在软件2301班下新建组织' }))
      .toHaveAttribute('data-barred', 'true')
  })

  it('opens a branch without folding it, and folds only from the twistie', async () => {
    renderScreen({ client: fakeClient(world()), route: '/admin/org', children: <OrgPage /> })

    const rowOf = (name: string) =>
      document.querySelector<HTMLElement>(`[data-testid="tree-row"][data-node-name="${name}"]`)
    await vi.waitFor(() => expect(rowOf('软件学院')).not.toBeNull())
    // pressing a unit opens it beside the tree and leaves what is under it where it was
    rowOf('软件学院')!.click()
    await expect.element(page.getByTestId('node-sheet')).toBeVisible()
    expect(rowOf('软件2301班')).not.toBeNull()
    // and the unit it opened is the one the sheet is showing
    await expect.element(page.getByRole('heading', { name: /软件学院/ })).toBeInTheDocument()

    // the twistie is what folds, and it leaves the open unit open
    await page.getByRole('button', { name: '关闭' }).click()
    await page.getByRole('button', { name: '展开或收起 软件学院' }).click()
    await vi.waitFor(() => expect(rowOf('软件2301班')).toBeNull())
    expect(rowOf('软件学院')?.getAttribute('data-people')).toBe('0')
  })

  it('edits the grammar per type and saves the pair diff', async () => {
    const put = vi.fn(() => Effect.succeed({}))
    const drop = vi.fn(() => Effect.succeed({}))
    const client = world()
    renderScreen({
      client: fakeClient({
        ...client,
        org: { ...client.org, putRule: put, deleteRule: drop },
      }),
      route: `/admin/org?view=types&type=${COLLEGE_TYPE}`,
      children: <OrgPage />,
    })

    const sheet = page.getByTestId('type-sheet')
    await expect.element(sheet).toBeVisible()
    // the stored grammar, offered for editing: a college holds classes
    const classBox = sheet.getByRole('checkbox', { name: /班级/ })
    await expect.element(classBox).toBeChecked()
    await expect.element(sheet.getByTestId('type-save')).toBeDisabled()

    // allow colleges to also hold colleges, stop them holding classes
    await classBox.click()
    await sheet.getByRole('checkbox', { name: /学院/ }).click()
    await expect.element(sheet.getByTestId('unsaved-mark')).toBeVisible()
    await sheet.getByTestId('type-save').click()

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      params: { parentTypeId: COLLEGE_TYPE, childTypeId: COLLEGE_TYPE },
    })
    await vi.waitFor(() => expect(drop).toHaveBeenCalledTimes(1))
    expect(drop).toHaveBeenCalledWith({
      params: { parentTypeId: COLLEGE_TYPE, childTypeId: CLASS_TYPE },
    })
  })

  // The grammar is a graph, not a tree: a kind may stand under several
  // others, and a rule may skip a level. The picture draws each kind once and
  // takes a skipping rule round the outside; the table says the same in words.
  it('draws the rules as one picture and one table, and opens a kind beside them', async () => {
    const INSTITUTE_TYPE = '33333333-3333-4333-8333-333333333309'
    const client = world()
    client.org.listTypes = () =>
      Effect.succeed({
        types: [
          { id: SCHOOL_TYPE, name: '学校', sortOrder: 0 },
          { id: COLLEGE_TYPE, name: '学院', sortOrder: 1 },
          { id: INSTITUTE_TYPE, name: '研究所', sortOrder: 2 },
          { id: CLASS_TYPE, name: '班级', sortOrder: 3 },
        ],
      })
    client.org.listRules = () =>
      Effect.succeed({
        rules: [
          { parentTypeId: SCHOOL_TYPE, childTypeId: COLLEGE_TYPE },
          { parentTypeId: COLLEGE_TYPE, childTypeId: INSTITUTE_TYPE },
          { parentTypeId: INSTITUTE_TYPE, childTypeId: CLASS_TYPE },
          // a college may hold classes directly: two levels down, so it goes round
          { parentTypeId: COLLEGE_TYPE, childTypeId: CLASS_TYPE },
        ],
      })
    renderScreen({
      client: fakeClient(client),
      route: '/admin/org?view=types',
      children: <OrgPage />,
    })

    const graph = page.getByTestId('rules-graph')
    await expect.element(graph).toHaveAttribute('data-rules', '4')
    const lines = () => [...document.querySelectorAll('[data-rule]')]
    expect(lines().filter((line) => line.getAttribute('data-cross') === 'true')).toHaveLength(1)
    // every kind once, however many stand over it
    expect(document.querySelectorAll('[data-type-node]')).toHaveLength(4)

    // nothing is open until something is picked: the page is whole without it
    expect(document.querySelector('[data-testid="type-sheet"]')).toBeNull()
    const rows = () => page.getByTestId('type-row').elements()
    expect(rows().map((row) => row.getAttribute('data-type-name'))).toEqual(['学校', '学院', '研究所', '班级'])
    // a class may stand under a college and under an institute
    expect(rows()[3]?.getAttribute('data-under')).toBe('2')

    await page.getByTestId('type-row').nth(1).click()
    await expect.element(page.getByTestId('type-sheet')).toBeVisible()
    await expect.element(page.getByTestId('type-row').nth(1)).toHaveAttribute('data-selected', 'true')
    expect(document.querySelector(`[data-type-node="${COLLEGE_TYPE}"]`)?.getAttribute('data-open')).toBe('true')
  })

  it('shows a unit it may not manage without offering a single control', async () => {
    const client = world()
    const readOnly = {
      ...client,
      org: {
        ...client.org,
        getTree: () =>
          Effect.succeed({
            roots: [ROOT],
            nodes: [
              node({
                id: ROOT,
                name: '示例大学',
                parentId: null,
                orgTypeId: SCHOOL_TYPE,
                depth: 0,
                manageable: false,
              }),
            ],
          }),
      },
    }
    renderScreen({
      client: fakeClient(readOnly),
      route: `/admin/org?node=${ROOT}`,
      children: <OrgPage />,
    })

    await expect.element(page.getByRole('heading', { name: /示例大学/ })).toBeInTheDocument()
    await expect.element(page.getByTestId('node-note')).toHaveAttribute('data-manageable', 'false')
    expect(await page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '创建' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '删除组织' }).elements()).toHaveLength(0)
  })
})
