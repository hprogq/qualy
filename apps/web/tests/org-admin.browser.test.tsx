import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const OrgPage = (await components['org/OrgPage']!()).default

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
}) => ({
  sortOrder: 0,
  manageable: true,
  subtreeManageable: true,
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

    await page.getByRole('button', { name: '移动' }).click()
    await page.getByRole('combobox', { name: '移动到' }).click()
    const listbox = page.getByRole('listbox')
    await expect.element(listbox).toBeVisible()
    // the one legal destination, and none of the illegal ones
    await expect.element(listbox.getByRole('option', { name: '外国语学院' })).toBeVisible()
    expect(await listbox.getByRole('option', { name: '软件2301班' }).elements()).toHaveLength(0)
    expect(await listbox.getByRole('option', { name: '软件学院' }).elements()).toHaveLength(0)
    expect(await listbox.getByRole('option', { name: '示例大学' }).elements()).toHaveLength(0)

    await listbox.getByRole('option', { name: '外国语学院' }).click()
    await page.getByRole('button', { name: '移动' }).last().click()
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

    const del = page.getByRole('button', { name: '删除节点' })
    await expect.element(del).toBeEnabled()
    await del.click()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    await page.getByRole('button', { name: '取消' }).click()
    expect(remove).not.toHaveBeenCalled()

    await del.click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除节点' }).click()
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
    const del = page.getByRole('button', { name: '删除节点' })
    await expect.element(del).toBeDisabled()
    // the bar names its reason as data, beside the struck action
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
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
    await expect.element(page.getByText('示例大学 / 软件学院')).toBeInTheDocument()
    await expect.element(page.getByText('软件2301班').nth(1)).toBeInTheDocument()

    // a college may hold classes and nothing else, so the create control
    // offers exactly that - the rule never gets a chance to become an error
    await page.getByRole('combobox', { name: '选择类型' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await vi.waitFor(() =>
      expect(page.getByRole('option').elements(), 'exactly the one legal child type').toHaveLength(
        1,
      ),
    )
    await page.getByRole('option', { name: '班级' }).click()
    await page.getByRole('textbox', { name: '名称' }).fill('软件2302班')
    await page.getByRole('button', { name: '创建' }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { parentId: COLLEGE, orgTypeId: CLASS_TYPE, name: '软件2302班' },
    })
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

    await expect.element(page.getByRole('heading', { name: /学院/ }).first()).toBeInTheDocument()
    // the stored grammar, offered for editing: a college holds classes
    const classBox = page.getByRole('checkbox', { name: /班级/ })
    await expect.element(classBox).toBeChecked()

    // allow colleges to also hold colleges, stop them holding classes
    await classBox.click()
    await page.getByRole('checkbox', { name: /学院/ }).click()
    await page.getByRole('button', { name: '保存' }).click()

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      params: { parentTypeId: COLLEGE_TYPE, childTypeId: COLLEGE_TYPE },
    })
    await vi.waitFor(() => expect(drop).toHaveBeenCalledTimes(1))
    expect(drop).toHaveBeenCalledWith({
      params: { parentTypeId: COLLEGE_TYPE, childTypeId: CLASS_TYPE },
    })
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
    await expect.element(page.getByText('你对该节点只有查看权限。')).toBeInTheDocument()
    expect(await page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '创建' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '删除组织' }).elements()).toHaveLength(0)
  })
})
