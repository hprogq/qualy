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
})

describe('the organization screen', () => {
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
    const typePick = page.getByRole('combobox', { name: '选择类型' })
    expect(
      (await typePick.element().querySelectorAll('option')).length,
      'one placeholder and one legal type',
    ).toBe(2)
    await page.getByRole('textbox', { name: '名称' }).nth(1).fill('软件2302班')
    await typePick.selectOptions('班级')
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
