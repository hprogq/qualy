# 设计用户详情扩展

现在系统组织与权限内的用户详情页，只能显示与用户相关的部分基本信息。我想要让它开放能力，使得其他插件可以向这个页面注册导航并注册组件，将该页面改为左右双栏的导航，左侧是“基本资料 组织归属 登录方式 角色授权”之类的导航（且可以添加分类，比如测评、审计等），右侧是主要内容，顶部是用户信息的banner，这样比如综测就可以注册“**参评批次**”和“申报记录”两个页面这样。你考虑下该怎么做呢？
以及，现在用户权限这里会显示组织侧的权限，以及单个测评批次内的权限，是堆叠在一起显示的。我在考虑是否应该将永久权限和临时权限分开展示，且允许其他插件注册临时权限的渲染器（如果未注册就显示为缺省文字），可以渲染出一段文字和一个链接，这样对于assessment的临时权限就可以提示授予自XXX批次的文字，点击后可以跳转到批次内，你考虑下该怎么做呢？

[https://github.com/hprogq/qualy](https://github.com/hprogq/qualy) ，阅读源码后回答。

---

我把这块源码顺着看了一遍。结合你现在已经有的 `Ui.page / Ui.surfaces / collection / slot` 体系，我认为这个需求不应该做成“`UserDetailPage` 暴露一个 React 插件注册 API”，而应该把“用户详情”提升成一个真正的可组合页面域。

现在的问题其实已经比较明显：`packages/plugins/base/auth/src/client/iam/UserDetailPage.tsx` 自己包办了用户 Banner、登录身份、编辑资料，同时还直接 import `UserGrants`；而 `UserGrants.tsx` 又直接读取 RBAC 的授权接口。仓库之前的迁移文档甚至已经把这种 auth → rbac 的 UI 耦合列为已知问题。与此同时，你在 assessment 的 Batch 页面上已经建立了一套更好的模式：页面自己注册，导航通过 collection 注册，Shell 只负责组合。因此用户详情最好照这个方向走。

### 1. 我建议新增 `USER_DETAIL_SHELL`，而不是继续扩充 `UserDetailPage`

结构上可以变成：

```text
全局 TopBar
────────────────────────────────────────────

        ┌──────────────── 用户 Banner ────────────────┐
        │ 郭航旗  2023123456  学生  软件学院...       │
        │                              编辑 / 禁用 ... │
        └────────────────────────────────────────────┘

┌──────────────┐  ┌─────────────────────────────────┐
│ 基本资料      │  │                                 │
│ 组织归属      │  │          当前页面内容            │
│ 登录账号      │  │                                 │
│ 角色授权      │  │                                 │
│              │  │                                 │
│ 测评          │  │                                 │
│   参评批次    │  │                                 │
│   申报记录    │  │                                 │
│              │  │                                 │
│ 审计          │  │                                 │
│   操作记录    │  │                                 │
└──────────────┘  └─────────────────────────────────┘
```

这里最关键的一点是：**“参评批次”不是注册到 `UserDetailPage` 里的一个组件，而是 assessment 自己注册的一张真正的 `Ui.page`。**

例如路由可以是：

```text
/organization/users/:userId
/organization/users/:userId/organization
/organization/users/:userId/identities
/organization/users/:userId/role-grants

/organization/users/:userId/assessment/batches
/organization/users/:userId/assessment/entries

/organization/users/:userId/audit
```

这样每一项天然获得了刷新恢复、浏览器前进后退、直接复制链接、独立懒加载、独立权限控制、页面标题和插件卸载后的自然消失。相比 `?tab=assessment-batches` + 动态 React component registry，要干净得多。

我会在 `@qualy/ui-contract` 里增加三个东西，大概是这个概念：

```ts
export const USER_DETAIL_SHELL = 'user-detail-shell/v1'

export const userDetailNavigation = defineUiCollection<NavigationItem, ResolvedNavigationItem>({
  key: 'iam/user-detail-navigation',
  schema: navigationItemSchema,
})

export const userDetailHeader = defineUiSlot({
  key: 'iam/user-detail-header',
  cardinality: 'one',
})
```

然后把 `userDetailNavigation.key` 加进现在 `surfaces.ts` 的 `navigationCollections`。这一点非常重要，因为现有 manifest 已经会替 navigation collection 做：

```text
pageId
  ↓
检查这个用户能不能看到目标页面
  ↓
解析成真正 path
  ↓
目标页面不可见就连导航一起删除
```

你完全可以复用这个机制，不需要再实现一遍“插件页是否存在”“插件卸载怎么办”“权限不足怎么办”。

分类甚至都不用新发明。现有的 `navigationGroups` 已经够用。

auth 自己的四项可以不分组，作为顶部 loose items：

```text
基本资料
组织归属
登录账号
角色授权
```

assessment 再贡献：

```text
group: assessment/user-detail
label: 测评

参评批次 -> assessment/user-batches
申报记录 -> assessment/user-entries
```

audit 同理贡献一个“审计”组。当前 `WorkspaceShell` 本来就是这么对 `navigationGroups + workspaceNavigation` 做分组的，所以只是再增加一个 navigation surface。

### 2. Banner 应该归 auth，而不是让 Shell 理解“用户”

这一点也和你现在的 Batch 做法一致。

`UserDetailShell` 只知道：

> 我顶部有一个 `userDetailHeader` 位置。

auth 注册：

```text
slot iam/user-detail-header
    ↓
auth/user-detail-header
    ↓
UserDetailHeader.tsx
```

`UserDetailHeader` 自己读取 `:userId`，调用当前 `identity.getUser`，展示头像、姓名、业务编号、人员类型、组织路径、状态，以及编辑/迁移/启停等操作。

也就是说你现在 `UserDetailPage.tsx` 里的 `headBand` 那一大块基本可以整体搬出去。

而 assessment 的“参评批次”页面根本不需要知道 Banner 怎么实现，也不应该 import auth 的 `UserDetailHeader`。

这里我也不建议为了少一次请求，把整个 `getUser()` 数据通过 React Context 暴露给所有插件。TanStack Query 本身会去重/缓存；插件真正稳定的跨域契约只需要一个 `userId`。否则过两个月 assessment 开始读取 `user.userType.name`，audit 开始读取 `primaryOrgNode`，你又会产生一套隐性的 auth UI contract。

### 3. 各部分的所有权也正好可以借这个机会理清

我建议最终拆成：

- `auth`：基本资料、组织归属、登录账号、用户 Banner。
- `rbac`：角色授权。
- `assessment`：参评批次、申报记录。
- `audit`：用户审计记录。

特别是“角色授权”应该从 `auth/client/iam/UserGrants.tsx` 搬回 rbac。现在 `UserDetailPage` 直接 import `UserGrants`，而 `UserGrants` 再调用 `query.access.getUserRoleGrants`，这正是插件化以后不该继续存在的边界。

这样以后如果某个发行版没有 assessment：

```text
没有 assessment page
→ manifest 里没有对应页面
→ 对应 userDetailNavigation 自动消失
→ 用户详情仍正常工作
```

而不是 auth 到处写：

```tsx
{assessmentInstalled && ...}
```

这才和你现在的插件架构是一致的。

---

### 4. “永久权限 / 临时权限”我赞成拆，但我不建议用这两个词作为模型

这里源码给了一个非常明确的答案。

现在 `RoleGrant` 已经有：

```text
resourceNamespace
resourceType
resourceId

validFrom
validUntil
revokedAt
```

而且你当初对 Assessment 的设计本来就是：

```text
普通组织授权
resource = null

某个批次的工作人员授权
resource = {
  namespace: 'assessment',
  type: 'batch',
  id: batchId
}
```

所以真正稳定的划分标准应该是：

```text
resource == null
→ 组织授权

resource != null
→ 专项授权 / 场景授权
```

而**不要用 `validUntil != null` 判断“临时权限”**。

因为：

- 某个批次限定的角色即使没有写 `validUntil`，仍然只在这个批次有效；
- 将来完全可能有一个全组织有效、但只持续一周的角色；
- “时间范围”和“资源范围”在你现在的数据模型里本来就是两个正交维度。

产品 UI 我更倾向：

```text
角色授权

组织授权
  年级负责人
  软件学院 · 含下级组织

  辅导员
  软件学院 2023级 · 含下级组织


专项授权
  审核员
  软件学院 2023级
  来自「2025-2026 第二学期综合素质测评」   查看批次 →

  公示管理员
  软件学院
  来自「2026 届毕业测评」                 查看批次 →
  有效至 2026-09-30
```

如果你觉得“专项授权”过于正式，“临时授权”作为 UI 文案也可以，但代码和 API 层我仍然建议叫 `resourceScoped` / `scopedGrant`，不要把“临时”固化进领域模型。

### 5. 现在 RBAC API 还缺一块，必须先补

当前 `packages/plugins/base/rbac/src/api.ts` 的 `grantShape` 只有：

```text
id
user
role
target
manageable
```

并没有把：

```text
resourceNamespace
resourceType
resourceId
validFrom
validUntil
```

传给前端。

`server/grants.ts` 的 `grantRows()` 现在也没有 select 这些字段。

因此第一步应该把返回模型改成类似：

```ts
resource: null | {
  namespace: string
  type: string
  id: string
}

validFrom: string | null
validUntil: string | null
```

RBAC 只负责告诉浏览器：

> 这个角色分配受一个 `assessment / batch / UUID` 资源约束。

它依旧完全不知道 batch 是什么。

这很好，千万不要让 RBAC 去 join `assessment_batches` 查批次名称。

---

### 6. 你提出的“临时权限 Renderer”方向也是对的，但需要做成 keyed renderer

这一点不能简单写成：

```tsx
<UiSlot token={scopedGrantRenderer} context={grant} />
```

原因是你现在 `UiSlot` 的语义是“把这个 slot 的所有 contribution 都渲染出来”。

以后 assessment、course、workflow 都注册 renderer 时，一条 assessment grant 会把三个 renderer 都调用一遍。更麻烦的是，`UiSlot` 的 fallback 只在整个 slot 没有任何 contribution 时触发；有 assessment renderer，但碰到一个未知类型，它返回 `null`，你的默认文案也不会出现。

所以这里应该做成**资源类型 → renderer id 的映射**。

例如：

```ts
resourceGrantPresenters:

assessment/batch-grant:
  namespace: assessment
  type: batch
  renderer: assessment/batch-grant
```

再有一个：

```text
iam/resource-grant-renderer
```

slot。

RBAC 页面拿到：

```ts
resource = {
  namespace: 'assessment',
  type: 'batch',
  id: 'xxx',
}
```

先从 `resourceGrantPresenters` 找到：

```text
assessment/batch-grant
```

然后用现在已经存在的 `PluginSurface` 精确渲染：

```text
slot: iam/resource-grant-renderer
id:   assessment/batch-grant
```

而不是用 `UiSlot` 把所有 renderer 渲染一遍。

如果没找到 presenter，RBAC 自己显示安全的缺省内容：

```text
仅在特定业务对象内生效
assessment · batch
```

有 renderer 时 assessment 可以把它变成：

```text
授予自「2026 春季综合素质测评」   查看批次 →
```

如果有 `validUntil`：

```text
授予自「2026 春季综合素质测评」 · 有效至 9月30日   查看批次 →
```

链接不要让 renderer 自己拼：

```text
/assessment/batches/${batchId}
```

而应该继续用你现有的：

```tsx
<PageLink page="assessment/batch" params={{ batchId }}>
```

或者 `usePageHref()`。这样页面路径以后移动，renderer 不需要跟着改。

而且 assessment renderer 查询批次名称时依然必须走 assessment API。如果当前操作者无权读取这个批次，就退化成：

```text
来自一个测评批次
```

而不是为了做这行文案绕过权限把批次名泄露出来。

---

### 7. 这里还有一个比“怎么展示”更重要的问题：专项授权不能在 IAM 页直接删除

这是我看源码时觉得这次最好顺手解决的一点。

当前普通 `UserGrants` 的删除操作走：

```text
DELETE /iam/role-grants/:grantId
```

也就是通用 RBAC 删除。

但是 Assessment 添加临时工作人员实际走的是：

```text
assessment.addStaff
    ↓
rbac.createScopedAssignment(...)
    ↓
resource = assessment / batch / batchId
    ↓
同时写 batch_access_sources
```

删除则是：

```text
assessment.removeStaff
    ↓
rbac.revokeAssignment(...)
```

并且 `BatchAccessSource` 的源码注释明确说明，`roleAssignmentId` **刻意没有 FK**，因为授权撤销之后，Assessment 还需要保留“这个批次曾经接受过这项授权”的历史。

所以：

> 用户详情里的“专项授权”应该默认是查看和跳转，不应该直接出现通用“删除授权”按钮。

否则你会绕过 assessment 的 `removeStaff` 业务流程，直接从 IAM 把它底下的 RoleGrant 干掉。

我甚至建议服务端也把这个边界钉死，而不是仅靠前端：

```text
普通 /iam/role-grants/:id DELETE
只允许 resource == null 的 grant

resource != null
→ 通用 IAM API 拒绝
→ 由资源拥有插件自己的业务 API 撤销
```

这会让整个模型非常干净：

```text
RBAC：
“这项授权受 assessment/batch/xxx 限定。”

Assessment：
“xxx 是什么？”
“为什么授予？”
“去哪管理？”
“怎么正确撤销？”

IAM 用户详情：
“把双方的信息组合出来给管理员看。”
```

我认为这比仅仅把两组卡片视觉上分开重要得多。

---

### 8. Assessment 注册“参评批次 / 申报记录”时，也不要往 auth API 塞字段

例如不要把：

```ts
getUser() => {
  ...
  assessmentBatches: ...
  entries: ...
}
```

做进去。

应该由 assessment 自己新增 user-centric 查询，页面自己请求自己的领域数据。尤其你现在已经明确了**参评资格不属于 RBAC**：`PARTICIPANT_ACTION_CODES` 根本不进 permission catalog，是否参评来自 `BatchRoster`。

所以“参评批次”展示的其实是：

```text
这个 user 在哪些 batch roster 中
```

不是：

```text
这个 user 有哪些 assessment RoleGrant
```

这两个概念一定要继续分开。

“参评批次”里可以显示：

```text
2026 春季综测
参评人 · 软件2023级1班
进行中
查看批次 →
```

“申报记录”则是这个人在各个批次里的 entry 历史。

而“角色授权 → 专项授权”里的 assessment 内容是：

```text
他作为审核员/管理员在哪些 batch 有工作人员授权
```

二者不会混在一起。

---

如果让我按你现在 Qualy 的架构直接定案，我会定成：

1. 新增 `user-detail-shell/v1`，不要把现有 `UserDetailPage` 做成巨型动态 Tab 容器。
2. 用户详情的每个模块都是独立 `Ui.page`，插件注册页面 + `userDetailNavigation`。
3. 继续复用 `navigationGroups` 做“测评 / 审计”等分类。
4. auth 通过 `userDetailHeader` 单槽提供顶部用户 Banner。
5. 把“角色授权”页面从 auth 移交给 rbac。
6. RoleGrant 明确拆成“组织授权（resource=null）”和“专项授权（resource!=null）”；UI 可以叫“临时授权”，但领域层不要这么建模。
7. 新增 `(resource namespace, type) -> presenter` 的 keyed renderer 机制；assessment 注册 `assessment/batch` presenter。
8. 专项授权在用户页只负责解释来源 + 深链到来源，**不由通用 IAM 页面直接撤销**。
9. assessment 自己注册“参评批次 / 申报记录”页面并拥有对应 API，auth 不聚合业务插件的数据。
10. 实现 `UserDetailShell` 时最好先把 `AppShell` / `WorkspaceShell` 里重复的 TopBar 外框稍微抽一下，不要出现第三份完整壳代码。现在 `layout-default` 已经同时实现 `APP_SHELL / WORKSPACE_SHELL / BLANK_SHELL`，所以新的 layout contract 仍然应该由这里提供，而不是 auth 自己实现。

整体上，这个改法和你现有 Batch 的插件化导航是同一种架构，只是把“正在操作的对象”从 Batch 换成 User；不会再引入第二套插件系统。我认为这是最符合当前 Qualy 代码方向的方案。

---

现在系统内的用户没有批量导入功能，导致用户现在只能一个一个手动添加。你考虑一下怎么实现，是用和行政认定一样的导入方式吗，还是怎么做？如果做成可以手动选择Sheet和列的，是否行政认定也要同步使用？你阅读源码考虑下。

---

我看完现在这两块实现后，结论比较明确：

**用户批量导入不应该照搬“行政认定”的模板导入方式。用户导入更适合“任意 Excel → 选择 Sheet → 映射列 → 预检 → 导入”；行政认定则继续保留现在的“Qualy 模板驱动”。两者应该共用底层 Excel 读取能力，但不要强行统一成同一种交互。**

这不是单纯的产品偏好，和你现在代码里的领域约束直接相关。

### 为什么行政认定现在的模式不适合用户导入

现在行政认定其实不是一个普通 Excel importer。

`packages/plugins/assessment/core/src/administrative-import/workbook.ts` 里已经把它设计成一个相当严格的“受控文档协议”：

```ts
DATA_SHEET = '行政认定'
META_SHEET = '_qualy'
TEMPLATE_VERSION = 2
```

用户先从 Qualy 下载针对**当前题目 revision**生成的模板。模板的隐藏 `_qualy` Sheet 保存 batch、item、item revision 和字段位置。上传回来以后，`columns.ts` 的 `provenColumns()` 还会重新根据服务端当前冻结的题目定义验证：

```text
这个字段还存在吗？
这个字段应该在哪一列？
这一列的表头是不是系统当初生成的那个？
choice 的“国家级”到底对应哪个内部值？
```

它甚至明确采取：

> refuses rather than reconciles

也就是**不猜、不自动匹配、不让管理员手动告诉系统“这一列其实就是那个字段”**。

这很合理，因为行政认定导入的是有业务语义的测评事实，例如：

```text
认定：获奖级别
国家级
省级
市级
```

如果管理员手工映射错了一列，系统可能成功导入一批“合法但语义完全错误”的数据。

所以行政认定现在的模板不是 UI 选择，而是数据可信边界的一部分。

---

用户导入完全是另一类问题。

目前 `createUser` 的真正数据只有：

```ts
displayName
businessNo?
userTypeId
primaryOrgNodeId
```

见 `packages/plugins/base/auth/src/api.ts`。

而现实中学校真正拿到的一般本来就是：

```text
学号    姓名    学院    年级    班级
230101  张三    软件学院 2023级  软件2301
...
```

或者教务处、人事处自己的 Excel。

如果用户导入也要求：

> 先从 Qualy 下载模板 → 把原 Excel 的一千个人复制进去 → 再上传

那就没有真正解决批量导入的问题，只是把“一条条录入”换成了“一千条复制粘贴”。

所以这边应该接受**已有 Excel**。

---

## 我建议用户导入这样做

在现在 `UsersPage` 右上角：

```text
+ 新建用户       导入用户
```

“导入用户”最好进入独立页面：

```text
/organization/users/import
```

不要做成小 Dialog。因为后面有 Sheet、字段映射、预览、错误明细，空间肯定不够。

整个流程可以非常短：

```text
上传文件
   ↓
选择 Sheet / 表头行
   ↓
字段映射
   ↓
预览与校验
   ↓
确认导入
```

其中最值得做的是“字段既可以来自 Excel 列，也可以使用固定值”。

比如用户当前正在：

```text
组织与权限
→ 用户
→ 软件学院 / 2023级 / 软件2301
```

然后点导入。

他的 Excel 只有：

| 学号   | 姓名 |
| ------ | ---- |
| 230101 | 张三 |
| 230102 | 李四 |

映射界面就可以是：

| Qualy 字段 | 来源             |
| ---------- | ---------------- |
| 姓名       | `姓名`列         |
| 业务编号   | `学号`列         |
| 人员类型   | 固定值：学生     |
| 组织归属   | 固定值：软件2301 |

这样对于你最常见的场景，管理员实际上只需要：

> 上传 → 系统自动猜到学号和姓名 → 选择“学生” → 导入。

不需要 Excel 本身有“人员类型”和“组织”列。

但如果上传的是全学院甚至全校名单，也可以进入高级映射：

```text
人员类型 ← Excel「身份」列
组织归属 ← Excel「班级」列
```

这就是我建议的数据模型：

```ts
type UserImportMapping = {
  displayName: ColumnSource
  businessNo: ColumnSource

  userType: { kind: 'constant'; userTypeId: string } | { kind: 'column'; column: string }

  organization: { kind: 'constant'; orgNodeId: string } | { kind: 'column'; column: string }
}
```

不是所有字段都一定要从 Excel 里找。

---

## 但“组织归属列”第一版不要直接开放按名字随便匹配

这是源码里一个实际障碍。

现在 `OrgNode`：

`packages/plugins/base/org/src/db/entities.ts`

只有：

```text
id
parentId
orgTypeId
name
path
```

**没有外部组织编码 / 班级编码。**

而且名称只要求“同一个父节点下唯一”。

也就是说完全可以存在：

```text
软件学院 / 2023级 / 1班
英语学院 / 2023级 / 1班
```

如果 Excel 只有：

```text
班级 = 1班
```

系统不可能可靠判断是哪一个。

所以我会分两期。

第一版先支持：

```text
组织归属 = 当前组织 / 手工选择的固定组织
```

这已经解决绝大部分“某班一次导入几十人”“某部门一次导入员工”的需求。

第二版再支持跨组织文件，并且我建议那时给 `OrgNode` 增加一个可选的外部键，例如：

```ts
externalKey?: string
```

学校可以是：

```text
SOFTWARE-2023-01
20230101
```

外部系统同步时按这个匹配，而不是按显示名称猜。

如果不想增加 externalKey，也至少应该要求完整路径：

```text
大连外国语大学 / 软件学院 / 2023级 / 软件2301
```

而不能只拿“软件2301”做模糊匹配。

---

## businessNo 在批量导入里应该比手工创建更重要

当前数据库已经有：

```sql
unique (tenant_id, business_no)
where business_no is not null
```

这其实天然就是导入的稳定匹配键。

手工创建用户时 `businessNo` 可以为空，我觉得可以继续允许。

但**批量导入 v1 我反而建议要求业务编号**。

因为否则第一次导入：

```text
张三
```

第二次再上传：

```text
张三
```

系统根本不知道：

> 这是同一个张三，还是另一个张三？

有学号/工号以后就很好处理：

```text
230101 已存在
→ 不重复创建
```

而且之后才能进一步发展成“用户同步”。

我会把产品语义做成：

> 批量导入面向有稳定业务编号的机构用户；没有业务编号的零散用户仍可手工创建。

这个边界非常清楚。

---

## 第一版不要做“导入即更新已有用户”

这点我会比较坚持。

比如 Excel 有：

```text
230101 张三 软件2302
```

系统现在是：

```text
230101 张三 软件2301
```

不要因为导入文件里写了“软件2302”，就偷偷调用移动用户逻辑。

你当前 `users.ts` 对“移动用户”是专门建模的：

```ts
setPlacement(...)
```

而且注释明确指出：

> moving someone changes who administers them

移动组织会改变谁能够管理这个用户；修改人员类型甚至还要检查现有 RBAC grant 是否兼容。

所以第一版批量导入应该是：

```text
不存在
→ 待创建

已存在且信息一致
→ 已存在，跳过

已存在但姓名 / 类型 / 组织不一致
→ 冲突，提示管理员
```

而不是：

```text
businessNo 一样
→ update
```

以后真有需求，可以单独做：

**“同步用户”**

那是另一项功能，应该给管理员看 diff：

```text
张三
组织：软件2301 → 软件2302
人员类型：学生 → 教师

将影响 3 项角色授权
```

再确认。

不要把“首次导入”和“批量同步”混成一个按钮。

---

## 预检流程可以大量借鉴行政认定

这一块反而值得直接复用它的设计思想。

现在 `AdministrativeImportView` 是：

```text
上传文件
→ server preview
→ errors / warnings
→ confirmWarnings
→ commit
```

而且 API 设计里有一个非常好的原则：

> preview 只是给人看的，不是对 commit 的授权。

也就是说 commit **不能接收浏览器 preview 后加工出来的 rows**，而应该重新读取服务器保存的原始文件、重新校验。

用户导入也应该完全遵守。

例如：

```text
POST /iam/user-import-uploads
POST /iam/user-import-previews
POST /iam/user-imports
```

Preview 输入：

```ts
{
  attachmentId,
  sheet: '学生名单',
  headerRow: 2,
  mapping: {
    displayName: { column: 'B' },
    businessNo: { column: 'A' },
    userType: { constant: studentTypeId },
    organization: { constant: classId }
  }
}
```

服务器自己解析原文件，返回：

```text
共 83 行

可导入       78
已存在        3
警告          1
错误          1
```

具体行：

```text
第 17 行
230117 王五
错误：业务编号在当前租户中已属于另一用户

第 34 行
230134 赵六
警告：姓名与已有用户不同
现有：赵陆
文件：赵六
```

有 error 就不允许 commit。

我第一版仍然建议**整批通过才导入**，不要悄悄“成功 78 个，失败 5 个”。

用户基础数据缺 5 个人比整个操作失败更难排查。

---

## 服务端也不能简单循环调用 `createUser()`

这也是实现时要注意的。

现在：

```ts
users.create()
```

本身会：

```text
lockTenant
→ 开 transaction
→ 检查 manage 权限
→ 检查 UserType
→ 检查 placement
→ insert
→ audit
```

如果 2000 行：

```ts
for (const row of rows) {
  yield* users.create(...)
}
```

相当于把整套逻辑跑 2000 遍。

行政认定现在专门有 `administrative-import/db.ts`，注释里甚至已经在警告这个问题：

> A workbook of two thousand rows is two thousand chances to write a loop that asks the database once per row.

用户导入也应该沿用这个原则：

**一次 tenant lock + 一次事务 + 批量查询 + 批量校验 + 批量 INSERT。**

而不是 HTTP 层反复调用已有单用户 API。

单用户 create 和批量 import 可以共享内部验证函数，但不是共享“一次创建”的事务外壳。

---

# 那行政认定要不要也改成 Sheet + 列映射？

我的答案是：**不要。**

准确一点说：

> 用户导入和行政认定应该共享“Spreadsheet Engine”，但不共享“Import Policy”。

底层可以抽一个中立包，例如：

```text
@qualy/spreadsheet
```

把现在 assessment 里面真正通用的东西抽出来：

```text
.xlsx ZIP bomb / 解压大小检查
最大文件大小
最大 Sheet 数量
最大行列数
公式单元格拒绝
日期规范化
富文本 → plain text
列号 A/B/AA 转换
列出 Sheet
读取指定 Sheet
读取 header
读取 cell text
```

用户导入用它：

```text
任意 workbook
→ Sheet inventory
→ header row
→ mapping
→ User domain validation
```

行政认定也用它：

```text
workbook
→ 必须有 行政认定
→ 必须有 _qualy
→ metadata 校验
→ provenColumns()
→ Assessment domain validation
```

但是以下这些必须继续留在 assessment：

```text
DATA_SHEET = 行政认定
META_SHEET = _qualy
TEMPLATE_VERSION
TemplateSpec
buildAdministrativeWorkbook()
provenColumns()
itemRevisionId
evidence / recognition schema
```

不能为了“统一导入 UI”把这些丢掉。

换句话说：

```text
                 @qualy/spreadsheet
                 /               \
                /                 \
       用户任意表映射          行政认定模板协议
       auth/user-import        assessment/admin-import
```

这才是合适的复用层级。

---

我最终会把第一版范围定成这样：

| 能力                   | 用户导入           | 行政认定 |
| ---------------------- | ------------------ | -------- |
| 任意 `.xlsx`           | 是                 | 否       |
| 手选 Sheet             | 是                 | 否       |
| 手选表头行             | 是                 | 否       |
| 手动映射列             | 是                 | 否       |
| 系统模板               | 可以提供，但非必须 | 必须     |
| 固定值字段             | 是，人员类型/组织  | 不需要   |
| 服务端解析             | 是                 | 已经是   |
| Preview                | 是                 | 已经有   |
| Error 阻断             | 是                 | 已经有   |
| Warning 确认           | 是                 | 已经有   |
| Commit 再校验          | 是                 | 已经有   |
| 导入已有用户时自动更新 | 否                 | 不适用   |

因此我不会因为用户导入需要“选 Sheet/列”，就把行政认定也同步改掉。**统一的是 Excel 基础设施和 Preview/Commit 的交互范式，不统一各领域对文件含义的信任模型。**

另外我建议你这次做用户导入时，顺手把现在 `administrative-import/workbook.ts` 中的通用 Excel 安全解析部分抽出来。现在第二个 Excel 导入场景已经出现了，再复制一份 `ExcelJS + archive guard + textOf()` 就开始形成技术债了；但也只抽这一层，不要急着做一个“大一统 Import Framework”。memcite

---

主要是用户导入时可能组织节点尚未创建，所以导入用户时还需要同时创建对应的组织节点。本项目的组织架构要求是一个拓扑图，假设给定任何几个未排序的字段名（已知字段名绝不可能重复，因为拓扑图不可能成环），如果其符合本系统的组织架构要求（如学院、学校、班级、年级、专业、校区），则必然可以在拓扑图上找到一条通路，且顺序是固定的（比如学校->校区->学院->年级->专业->班级），如果不符合组织架构要求（如学校、班级、校区），则在拓扑图上无法找到从起点类型（学校）开始的通路。也就是，给定一组不重复的字段名（必须包含根节点类型），找到恰经过所有类型且终点为其中任一类型的通路即可。我不知道准不准确，你考虑下。而且系统需要要求，导入的同一批用户，所选择的类型列必须相同，尽可能不出现隐含关系。假设类型为学校、学院、专业下均可下挂班级，那么不能出现有的用户只提供了学校列和班级列，有的人出现了多列的情况（还是说这部分是可以允许的），你帮我考虑下。

---

你的思路基本是对的，但我会把规则再收紧一点。按现在源码的组织模型，应该区分两个东西：

`org_type_rules` 是“组织类型之间允许怎样连接”的有向无环图；真正的 `org_nodes` 则是单父节点树。当前代码在新增类型规则时会用 `ruleWouldCycle()` 阻止成环，创建节点时 `createNode()` 又要求“父节点类型 → 子节点类型”必须存在一条直接规则。

所以用户导入时，不应该做普通的“拓扑排序”，而应该验证：

> 本次选择的组织类型，在类型规则图中能否组成一条从租户根节点类型开始、逐条直接连接、恰好覆盖所有所选类型的链。

这个表述比“能不能在整个图里找到一条经过它们的通路”更准确。

比如系统规则是：

```text
学校 → 校区
学校 → 学院
校区 → 学院
学院 → 年级
学院 → 专业
年级 → 专业
专业 → 班级
学院 → 班级
```

管理员上传 Excel 后映射了：

```text
班级列
学校列
专业列
学院列
```

Excel 中的列顺序无所谓。系统自动得到：

```text
学校 → 学院 → 专业 → 班级
```

这是合法的。

但如果选择：

```text
学校
校区
班级
```

而规则里不存在：

```text
校区 → 班级
```

那就应该判为非法。

即使完整类型图里存在：

```text
校区 → 学院 → 专业 → 班级
```

也不能因此接受，因为这样等于系统偷偷补出了“学院、专业”两个没有出现在导入文件里的层级。这正是你说的“尽可能不要隐含关系”。

所以这里实际上要求的是：

```text
选中的类型：
{学校, 校区, 学院, 班级}

必须存在：
学校 → 校区
校区 → 学院
学院 → 班级
```

而不是只要求：

```text
学校 ~~经过若干未选择类型~~> 班级
```

---

还有一点需要纠正：

> “字段名绝不可能重复，因为拓扑图不可能成环”

这两个事情没有直接因果关系。

当前数据库确实保证一个租户里的 `OrgType.name` 唯一，这是 `uq_org_types_tenant_name` 做的；类型规则图又单独保证不能成环。

所以导入器仍然应该明确禁止：

```text
Excel A列 → 学院
Excel B列 → 学院
```

不是依赖 DAG 自动避免，而是规则直接规定：

> 一次导入中，一个组织类型最多映射一个来源。

这样更清楚。

---

### 我非常赞成“整批用户只允许一套组织类型链”

这里我甚至建议比你描述的再严格一点：

**组织结构映射是“导入级配置”，绝不是“行级配置”。**

假设本次导入确定：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

那么所有用户都必须按照这条链解释。

不能出现：

```text
张三：
学校 | 校区 | 学院 | 年级 | 专业 | 班级
 ✓      ✓      ✓      ✓      ✓      ✓

李四：
学校 | 校区 | 学院 | 年级 | 专业 | 班级
 ✓      空     空     空     空     ✓
```

然后系统看到李四只有“学校 + 班级”，就重新去类型图寻找：

```text
学校 → 班级
```

即便系统恰巧允许 `学校 → 班级`，我也不建议这么做。

因为这会产生一个很麻烦的语义：

> 同一个 Excel 的“班级”列，对张三来说是“专业下面的班级”，对李四来说却是“学校下面的班级”。

这就已经是隐含关系了。

所以一旦确定导入链：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

那么“班级”这一列的父节点永远只能来自“专业”这一列。

不能按行动态改父子关系。

---

### 那允许空值吗？

我建议第一版直接规定：

> 除根节点可以是固定值外，本次选中的所有组织类型列，每一行都必须有值。

也就是说，如果选择：

```text
学院 → 年级 → 专业 → 班级
```

那么这一批每个人都必须提供：

```text
学院
年级
专业
班级
```

缺任何一级都是这一行错误。

这样最简单，也最不容易产生“系统帮你猜组织关系”。

如果确实有这种业务：

```text
学生最终挂班级
教师最终挂学院
辅导员最终挂年级
```

我更建议：

**拆成三次导入。**

而不是在一次用户导入里让每一行终点都不同。

以后真发现有强需求，可以增加一个高级选项：

> 允许不同终点

但也只能允许**尾部为空**：

```text
学校 → 学院 → 专业 → 班级

A：学校 学院 专业 班级
B：学校 学院 专业 [空]
C：学校 学院 [空] [空]
```

这还能解释为：

```text
A 挂在班级
B 挂在专业
C 挂在学院
```

绝对不能允许中间空洞：

```text
学校 → [空] → 专业 → 班级
```

不过我甚至不会在 v1 做这个高级模式。当前目标是可靠批量建组织 + 建用户，**整批同一终点类型**更符合 Qualy 现在的设计风格。

---

### 根节点我反而不要求 Excel 必须真的有一列

你说“必须包含根节点类型”，从算法上没问题，但产品交互上可以更聪明。

Qualy 一个租户现在只有一个 root `OrgNode`，数据库也有：

```text
uq_org_nodes_tenant_single_root
```

所以如果当前租户就是：

```text
大连外国语大学
类型：学校
```

管理员不应该被迫让 Excel 每一行都写：

```text
学校
大连外国语大学
大连外国语大学
大连外国语大学
...
```

可以把根节点作为一个固定来源：

```text
组织结构

学校      大连外国语大学        固定
校区      Excel「校区」列
学院      Excel「学院」列
年级      Excel「年级」列
专业      Excel「专业名称」列
班级      Excel「行政班」列
```

逻辑上，选中的类型集合仍然包含“学校”。

只是：

```text
学校 → fixed(rootNode)
```

而不是来自 Excel column。

如果 Excel 本来就有“学校”列，也可以让管理员映射，然后把它当作校验字段：

```text
每一行必须等于 大连外国语大学
```

但没必要强制。

---

### 类型链的算法也可以做得很干净

假设：

```ts
selected = {
  school,
  campus,
  college,
  grade,
  major,
  class
}
```

先取本租户的所有：

```text
OrgType
OrgTypeRule
rootNode.orgTypeId
```

然后只保留本次选择的类型和它们之间的直接规则。

可以理解成得到一个“小图”。

然后要求：

1. 根类型必须在其中；
2. 一个类型只能出现一次；
3. 必须能从根类型开始；
4. 每一步都必须有唯一的下一个类型；
5. 最终恰好访问所有所选类型一次。

于是得到：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

或者失败。

由于原图本身是 DAG，只要真的存在这样一条覆盖全部所选类型的链，它的先后顺序实际上就是确定的，不需要管理员再拖拽排序。

这点体验会很好：

```text
映射组织字段

行政班        → 班级
学院名称      → 学院
校区          → 校区
专业          → 专业
入学年份      → 年级

系统识别组织层级：
学校 → 校区 → 学院 → 年级 → 专业 → 班级   ✓
```

管理员完全不需要关心 Excel 中列的顺序。

如果失败，比如：

```text
学校
校区
班级
```

UI 可以非常具体地提示：

> 无法组成连续的组织层级。当前规则中“校区”不能直接下挂“班级”。  
> 系统发现存在 `校区 → 学院 → 专业 → 班级` 的路径，请补充“学院”“专业”列，或调整组织层级规则。

这个提示比一句“组织结构不合法”强很多。

---

### 然后用户导入实际是在“物化一棵子树”

这部分我觉得是整个设计里最漂亮的一点。

假设本次链：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

Excel：

| 校区 | 学院     | 年级   | 专业 | 班级 | 学号 | 姓名 |
| ---- | -------- | ------ | ---- | ---- | ---- | ---- |
| 旅顺 | 软件学院 | 2023级 | 计科 | 1班  | 001  | 张三 |
| 旅顺 | 软件学院 | 2023级 | 计科 | 1班  | 002  | 李四 |
| 旅顺 | 软件学院 | 2023级 | 软工 | 2班  | 003  | 王五 |

不要逐行：

```text
创建校区
创建学院
创建年级
……
创建用户
```

而是先从整份文件构造一棵“期望组织树”：

```text
大连外国语大学
└── 旅顺
    └── 软件学院
        └── 2023级
            ├── 计科
            │   └── 1班
            │       ├── 张三
            │       └── 李四
            └── 软工
                └── 2班
                    └── 王五
```

然后一次跟现有 `OrgNode` 树做 diff：

```text
已存在
大连外国语大学
旅顺
软件学院

待创建
2023级
计科
软工
1班
2班

待创建用户
3 人
```

这样 Excel 行完全可以是乱序的，也完全不影响。

---

### 节点匹配也必须沿路径匹配，而不能全局按名字匹配

源码当前节点唯一约束是：

```text
tenant + parent + name
```

而不是：

```text
tenant + name
```

这是正确的，因为完全可能有：

```text
软件学院
└── 2023级
    └── 1班

英语学院
└── 2023级
    └── 1班
```

所以解析一行：

```text
软件学院 / 2023级 / 计科 / 1班
```

应该逐级：

```text
当前 parent = 大连外国语大学

找 parent 下 name=软件学院
→ 有，且 type=学院
→ reuse

找软件学院下 name=2023级
→ 无
→ create 年级

找2023级下 name=计科
→ create 专业

找计科下 name=1班
→ create 班级
```

如果遇到：

```text
软件学院下已有一个“2023级”
但它的类型居然不是“年级”
```

就应该直接报冲突：

> “软件学院 / 2023级”已存在，但其组织类型为“专业”，与本次导入要求的“年级”不一致。

不能静默复用，更不能另外创建同名节点——数据库本身也不会允许。

---

### Preview 最好同时展示“组织变更”和“用户变更”

我会把用户导入预检做成三个区域：

```text
文件
学生名单.xlsx · Sheet1 · 428 行

组织结构
学校 → 校区 → 学院 → 年级 → 专业 → 班级

组织变更
复用现有节点    16
将创建节点      23
冲突             0

用户
将创建          421
已存在并跳过      5
警告              2
错误              0
```

再允许展开：

```text
将创建的组织

旅顺校区 / 软件学院 / 2024级
旅顺校区 / 软件学院 / 2024级 / 计算机科学与技术
旅顺校区 / 软件学院 / 2024级 / 计算机科学与技术 / 软件2401
...
```

这样管理员在按“确认导入”之前，能明确知道：

> 这次不只是创建 428 个用户，还会往组织树里增加 23 个节点。

这很重要。

---

### Commit 必须是“组织节点 + 用户”一个原子操作

这一点我认为不能妥协。

不能出现：

```text
创建了 20 个班级
↓
第 300 个用户冲突
↓
导入失败
↓
组织架构里残留 20 个空班级
```

所以一次导入应当：

```text
tenant lock
↓
重新读取 type rules
↓
重新验证导入链
↓
重新解析 workbook
↓
重新 resolve 现有节点
↓
创建缺失 OrgNode
↓
创建 User
↓
写 audit
↓
COMMIT
```

任何一步失败：

```text
ROLLBACK
```

组织和用户一起回滚。

你当前 `org` 和 `auth` 本来都使用 tenant lock + transaction，而且两个包现在本身也已经存在相互依赖，所以这不是一个完全陌生的跨域场景。但实现时不要在批量 import 里循环调用公开的：

```text
Org.createNode()
users.create()
```

让每一个对象自己再开一套事务。

应该为批量 provisioning 抽出可以运行在同一 ambient transaction 下的内部 primitive，然后最外层 import service 只开一次事务。

---

所以如果让我给这一版定规则，我会直接冻结成：

> **一次用户导入 = 一份 Excel + 一个 Sheet + 一套用户字段映射 + 一条固定组织类型链。**

组织链：

- 根节点类型必须包含，但根节点通常由系统固定提供；
- 每个组织类型最多映射一次；
- Excel 列顺序无关；
- 所选类型必须在 `OrgTypeRule` 中组成一条从根开始的连续有向链；
- 不允许借助未选择的组织类型“补路径”；
- v1 每一行必须完整提供链上所有非固定类型；
- 同一批所有用户使用同一条链、同一个终点类型；
- 系统按父节点 + 名称逐级复用或创建节点；
- 节点创建和用户创建同一事务提交。

你担心的“有的人只有学校+班级，有的人又有学校+学院+专业+班级”我会在 **v1 明确禁止**。不是因为技术上不能支持，而是因为一旦支持，Excel 的“列”不再代表固定结构，导入器就开始替管理员推断关系了。对 Qualy 这种组织和权限紧密绑定的系统，这个便利性不值得。memcite

---

好的，你认真阅读Github上的项目源码，考虑细节如何实现。以及是否要做导入记录和批量撤销/删除导入的功能。

---

我把现在 GitHub 上这几块重新串了一遍：`auth/users.ts`、`auth/db/entities.ts`、`org/server/index.ts`、`org/db/entities.ts`、数据库事务实现，以及行政认定的 `administrative-import/*`。这次我会把设计稍微改得更完整一些。

结论先定下来：

**用户导入 v1 就应该有导入记录，也应该支持“撤销导入”；但不要提供“删除导入记录”。组织节点不要和用户一起强制回滚，而应在撤销后提供“清理本次导入创建的空组织节点”。**

而且这套功能最好不要继续塞进 `auth`，我更建议做一个很薄的上层 `directory-import` 插件，专门编排 `auth + org + storage`。

### 1. 为什么不应该直接写进 auth

当前 `packages/plugins/base/auth/src/server/index.ts` 有一句非常关键的设计说明：

> auth reads org tables directly and never holds the org service. Keeping it that way is what keeps the service graph acyclic.

现在 org 又通过 `@qualy/auth-contract` 的窄接口去询问 placement 约束。也就是说，auth 和 org 目前是刻意避免互相持有完整 Service 的。

而“用户导入”现在已经不只是：

> Excel → User

而是：

> Excel → 解析组织类型链 → 匹配已有 OrgNode → 创建缺失 OrgNode → 创建 User → 保存来源 → 支持整体撤销

这已经是一个明确的**跨领域编排流程**。

所以我建议增加：

```text
packages/plugins/base/directory-import/
```

它负责：

```text
文件上传
Excel 解析
Sheet / 表头 / 列映射
导入预检
导入事务编排
导入记录
撤销记录
清理导入创建的组织节点
```

但它不自己重新实现：

```text
组织规则是否合法       → org
节点能否创建           → org
用户类型是否合法       → auth
用户能否站在该节点     → auth
用户能否创建/删除       → auth
权限范围                → rbac
文件                    → storage
```

这样职责非常干净。

同时 UsersPage 可以增加一个很小的 UI 扩展位，比如：

```text
iam/users/actions
```

`directory-import` 向这里注册“导入用户”，而不是让 auth 硬依赖这个可选能力。

---

## 2. 组织列的模型，我建议正式冻结成“固定链”

上轮我们讨论的规则我认为是对的，但实现上可以表述得更严谨：

假设用户选择了这些组织类型：

```text
学校、校区、学院、年级、专业、班级
```

取当前租户 `OrgTypeRule`，在**所选类型诱导出的子图**中进行拓扑排序。

要求：

```text
1. 根节点类型必须存在
2. 拓扑序必须唯一
3. 唯一拓扑序的每两个相邻类型之间必须存在直接 OrgTypeRule
4. 恰好覆盖全部所选类型
```

于是自动得到：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

实际上在 DAG 中，“唯一拓扑序”的一个重要性质就是相邻节点必须存在有向边，所以实现可以很漂亮。

例如：

```text
学校 → 校区 → 学院 → 专业 → 班级
```

用户只选：

```text
学校、校区、班级
```

如果没有：

```text
校区 → 班级
```

直接拒绝。

即使完整图存在：

```text
校区 → 学院 → 专业 → 班级
```

也绝不偷偷补中间类型。

这就是我们之前说的“不能存在隐含组织关系”。

---

## 3. 每个组织层级不应该只有“Excel 列”一种来源

我建议映射结构直接设计成：

```ts
type OrgLevelSource =
  | {
      kind: 'fixed-node'
      nodeId: string
    }
  | {
      kind: 'column'
      column: string
    }
```

这样一次导入可以是：

```text
学校    大连外国语大学             固定节点
校区    旅顺校区                   固定节点
学院    软件学院                   固定节点
年级    Excel「年级」列
专业    Excel「专业名称」列
班级    Excel「行政班」列
```

对于学院管理员特别合理。

并且我建议加一个约束：

> **固定节点只能构成组织链的连续前缀。**

也就是允许：

```text
固定 → 固定 → 固定 → Excel → Excel → Excel
```

不允许：

```text
固定 → Excel → 固定 → Excel
```

否则一旦前面已经开始按行分叉，后面突然固定到同一个节点，语义会非常怪。

根节点永远直接由系统固定，不需要管理员拿 Excel 一列去映射“学校”。

---

## 4. v1 中所有行必须使用完全相同的组织链

这一点我仍然建议严格执行。

确定：

```text
学校 → 校区 → 学院 → 年级 → 专业 → 班级
```

以后，每一行的所有 `column` 层级必须非空。

不允许：

```text
张三：学校 / 校区 / 学院 / 年级 / 专业 / 班级
李四：学校 /      / 学院 /      /      / 班级
```

也不允许系统针对李四重新寻找：

```text
学校 → 学院 → 班级
```

哪怕这种边在组织规则中确实存在。

也就是说：

**类型链属于整个 Import，不属于 Row。**

这一条非常重要。

以后真出现教师只到学院、学生到班级这种混合文件，我宁可让管理员拆成：

```text
导入学生.xlsx
导入教师.xlsx
```

而不是把一个 Import 做成行级动态结构解释器。

---

# 5. Preview 不应该直接逐行创建节点，而应先构造“期望树”

假设 Excel：

| 学院     | 年级   | 专业 | 班级 | 学号 | 姓名 |
| -------- | ------ | ---- | ---- | ---- | ---- |
| 软件学院 | 2023级 | 计科 | 1班  | 001  | 张三 |
| 软件学院 | 2023级 | 计科 | 1班  | 002  | 李四 |
| 软件学院 | 2023级 | 软工 | 2班  | 003  | 王五 |

先在内存里折叠成：

```text
软件学院
└─ 2023级
   ├─ 计科
   │  └─ 1班
   └─ 软工
      └─ 2班
```

然后逐层和数据库比较。

节点身份一定是：

```text
(parentNodeId, name)
```

而不是：

```text
name
```

这正好和现有：

`uq_org_nodes_tenant_parent_name`

保持一致。

例如找到：

```text
软件学院 / 2023级
```

但现有节点类型不是“年级”，就报：

> 软件学院 / 2023级 已存在，但组织类型为“专业”，与本次导入要求的“年级”不一致。

不能复用，也不能另建同名节点。

---

# 6. 用户本身我建议 v1 再收紧一点

批量导入：

```text
businessNo 必填
displayName 必填
userType 固定为整批一个值
primaryOrgNode = 组织链终点
```

暂时不要支持：

```text
Excel 某列 → UserType
```

因为你现在已经允许组织树动态创建了，如果同时允许：

```text
学生
教师
辅导员
管理员
```

混在一次导入里，不同人员类型还有不同 placement policy，复杂度会立刻上升。

第一版直接：

```text
本次导入人员类型：学生
```

会干净很多。

而且当前 `User.businessNo` 本身就是 tenant 内唯一，并且**删除后的用户仍占着这个编号**，源码注释明确说这么做是为了：

> same person coming back is a Restore

所以处理规则应该是：

| 情况                               | 结果             |
| ---------------------------------- | ---------------- |
| businessNo 不存在                  | 创建             |
| 已存在，姓名/人员类型/组织完全一致 | 已存在，跳过     |
| 已存在但数据不同                   | 冲突             |
| 对应用户已删除                     | 冲突，提示先恢复 |
| 同一 Excel 内 businessNo 重复      | 错误             |

不要导入即更新，也不要导入即恢复。

---

# 7. Preview 和 Commit 我建议做成“双层计划”

这一点可以借鉴行政认定，但用户导入最好再加一个 fingerprint。

流程：

```text
上传
↓
inspect workbook
↓
选择 Sheet / 表头
↓
映射字段
↓
server preview
↓
确认
↓
server commit
```

Preview 返回：

```text
组织链
学校 → 校区 → 学院 → 年级 → 专业 → 班级

组织节点
复用       14
将创建      8
冲突        0

用户
将创建     396
已存在       4
警告         0
错误         0

planFingerprint = ...
```

Commit：

```ts
{
  ;(attachmentId, sheet, headerRow, mapping, userTypeId, expectedPlanFingerprint, confirmWarnings)
}
```

服务端**重新打开 storage 中的原文件并重新解析**。

但和行政认定现在一样：

> Excel 读取和大量计算放在事务外。

因为 `packages/plugins/infra/database/src/server/orm.ts` 的 transaction 明确是 `JOIN-EXISTING`，而 tenant 结构写又全部串行锁住同一个 Tenant row。没有必要拿着 tenant lock 解析几十万 Excel cell。

所以：

```text
事务外
读取文件
解析 Sheet
应用 mapping
构造 DesiredTree / DesiredUsers

事务内
lock tenant
重新读取 OrgTypeRule
重新解析当前节点状态
重新查询 businessNo
重新做权限/placement 判断
生成当前 write plan
```

然后和 `expectedPlanFingerprint` 比较。

如果 preview 后别人改了组织树，导致：

```text
原来要新建 8 个节点
现在只要新建 5 个
```

我甚至建议返回：

```text
IMPORT_PLAN_CHANGED
```

让管理员重新看一次 Preview。

不是因为少创建 3 个节点危险，而是用户确认的是一组明确的批量变更。

---

# 8. Commit 必须全事务

这里现有数据库基础设施已经非常适合。

`transaction()` 在已有事务里会直接 join，而不会另开 connection/savepoint；org/auth/rbac 又都锁同一条 Tenant row。

因此最终可以是：

```text
transaction
  lock Tenant

  validate type chain
  resolve existing nodes

  create missing nodes
  resolve final nodes

  validate auth.user.manage
  validate user type placement

  query all businessNo
  validate conflicts

  bulk insert users

  bind source attachment

  insert import record
  insert import row provenance
  insert import node provenance

commit
```

任何用户失败：

```text
全部 rollback
```

不会留下“班建出来了，人只导了一半”。

性能上也不要：

```ts
for (...) {
  Org.createNode(...)
  Iam.users.create(...)
}
```

正确性上 nested transaction 是可以 join 的，但会产生非常明显的 N+1 查询和 audit 写入。

应该分别给 org/auth 增加内部 bulk primitive。

---

# 9. 导入记录我认为是必须的

这里直接参考行政认定现在的做法是正确的。

行政认定已经有：

```text
AdministrativeEntryImport
AdministrativeEntryImportRow
AdministrativeEntryImportEvent
```

而且设计注释特别好：

> preview 不是 history；只有真正成功写入以后才有 import row。

用户导入也应该一样。

我建议三个实体：

```text
DirectoryImport
DirectoryImportRow
DirectoryImportNode
DirectoryImportEvent
```

核心字段大概如下。

`DirectoryImport`：

```text
id
tenantId

sourceAttachmentId
filenameSnapshot
sizeBytes
contentHashAlgorithm
contentHash

actorId
sheetName
headerRow

userTypeId

mappingSnapshot jsonb
orgTypeChainSnapshot jsonb

sourceRowCount
createdUserCount
existingUserCount
createdNodeCount
reusedNodeCount

createdAt
```

`mappingSnapshot` 是历史事实，不是以后重新执行导入的配置。

例如：

```json
{
  "displayName": "C",
  "businessNo": "A",
  "organization": [
    { "typeId": "...", "source": { "kind": "fixed-node", "nodeId": "..." } },
    { "typeId": "...", "source": { "kind": "column", "column": "F" } }
  ]
}
```

---

`DirectoryImportRow`：

```text
importId
sourceRowNo

userId

businessNoSnapshot
displayNameSnapshot

primaryOrgNodeIdSnapshot
primaryOrgPathSnapshot

disposition = created | existing

createdAt
```

为什么 existing 也应该记录？

因为以后管理员打开导入记录，应该能看到：

> 第 37 行为什么没创建？

而不是只看到 396 个成功创建的人，却不知道原文件其实有 400 行。

---

`DirectoryImportNode`：

```text
importId

orgNodeId nullable
parentNodeIdSnapshot
orgTypeIdSnapshot
nameSnapshot
depthInImport

disposition = created | reused
```

`orgNodeId` 最好允许后续置空。

因为 OrgNode 是可以物理删除的，而 Import 是历史，不能反过来因为 provenance 表 FK 把组织节点永远钉死。

---

`DirectoryImportEvent`：

```text
id
importId

kind
actorId
reason

affectedUserCount
deletedNodeCount
retainedNodeCount

createdAt
```

第一版 `kind` 甚至只有：

```text
reversed
nodes-cleaned
```

就够了。

---

# 10. 不要做“删除导入记录”

这个我比较确定。

行政认定现在对 Import 的语义已经做得很好：

> reversal is a thing that happens to an import, not the import going away

用户导入也应该完全一样。

导入：

```text
2026-09-19
郭航旗
学生名单.xlsx
创建 396 人
创建 8 个组织节点
```

哪怕后来全部撤销，这条历史仍然应该存在：

```text
2026-09-20
张老师
撤销导入
原因：名单使用了上一年度数据
影响 396 人
```

不能变成：

```text
什么都没发生过
```

特别是这个操作还可能曾经产生：

```text
登录
角色授权
测评参评记录
审核记录
审计事件
```

删除 Import 记录只会把来源链剪断。

所以 UI 上应该是：

```text
撤销导入
```

而不是：

```text
删除导入
```

---

# 11. 但“撤销用户”不能等于数据库 DELETE

你当前用户生命周期已经明确规定：

```text
Deleted is a state, not an absence.
```

`users.ts` 的删除实际上：

```text
disable
revoke grants
revoke identities
delete sessions
mark deletedAt
```

User row 自己一直保留。

这非常适合 Import reversal。

所以撤销一次导入应当只处理：

```text
DirectoryImportRow.disposition = created
```

绝不能碰：

```text
disposition = existing
```

例如：

```text
本次 400 行
396 创建
4 已存在
```

撤销以后：

```text
396 个本次创建的用户 → soft delete
4 个原来就存在的用户 → 完全不动
```

而且已经被管理员单独删除的用户直接跳过。

这个行为和行政认定现在：

```text
已经单独 voided 的 row 不再重复 reverse
```

是一致的。

---

# 12. 撤销应该允许后来已经被使用的用户吗？

我考虑以后，倾向于：

**允许，但必须明确告诉管理员副作用。**

因为 User 是软删除。

即便这个人后来：

```text
参加了测评
产生了申报
有审核记录
```

这些历史都不会因为 User soft-delete 而消失。

真正会消失的是“现在的访问权”：

```text
现有角色授权 → revoke
登录绑定 → revoke
session → 清除
```

这本来就是当前 `UserDeleted` 的正式语义。

如果因为“这个用户已经参加过测评”而永远不允许撤销一次错误导入，反而会让错误目录数据无法修复。

所以 Reversal Preview 最好明确告诉管理员：

```text
将删除本次创建且目前仍存在的用户：392

其中：
已有登录方式        21
持有角色授权         8
当前已禁用           3
已提前删除           4

删除用户会撤销其登录方式和角色授权；
历史业务记录不会被删除。
```

然后要求输入原因。

这里需要：

```text
auth.user.manage
+
auth.user.delete
```

两个权限。

因为普通删除当前就是高风险能力，不能让一个只有 manage 的管理员借 Import reversal 绕过 `auth.user.delete`。

如果 reversal 自动完成：

```text
active → disabled → deleted
```

还必须保留当前 `assertTenantKeepsAdministrator` 那套安全逻辑，不能因为是 bulk 操作绕过去。

---

# 13. 组织节点不要和 User reversal 强绑在一个原子回滚里

这是我这轮看完源码后最大的调整。

最开始很容易想到：

> 撤销导入 = 删除用户 + 删除当初新建的组织节点

但实际上这样做很危险。

比如 import A 创建：

```text
软件学院
└─ 2024级
   └─ 计科
      └─ 1班
```

后来别人：

```text
手动向 1班 添加用户
```

或者 Assessment：

```text
某个批次引用了 1班
```

或者：

```text
下面又手工创建了其他子节点
```

这时候撤销 import A，绝对不能删 `1班`。

而 org 当前的删除语义又很严格：

```text
有 child → NodeHasChildren
有任何插件 FK 引用 → NodeInUse
```

这正是正确行为。

另外，PostgreSQL 一个 DELETE 如果因为未知插件 FK 失败，当前 transaction 就已经进入 failed 状态；你的数据库层又明确说 `transaction()` 不提供 savepoint。

所以不能在一次 reversal transaction 里：

```text
for node:
  try delete
  catch NodeInUse:
     continue
```

这在当前事务模型下并不安全。

---

# 14. 因此我建议拆成两个动作

Import detail：

```text
学生名单.xlsx

创建用户        396
复用用户          4
创建组织节点       8
复用组织节点      13

[撤销本次用户导入]
```

撤销以后：

```text
已撤销
删除用户 392
此前已删除 4

本次导入创建的 8 个组织节点仍保留。

[清理未使用的组织节点]
```

“清理组织节点”单独做。

按 `depth DESC`：

```text
班级
专业
年级
学院
...
```

逐个调用 org 的正式 delete 语义。

每一个节点都是独立事务。

结果可能是：

```text
已清理 6 个节点
保留 2 个节点

软件学院 / 2024级 / 计科 / 1班
仍被其他数据使用

软件学院 / 2024级
仍有其他子节点
```

这个**允许部分成功**。

因为这是垃圾回收，不是业务撤销的原子部分。

而且它天然支持重试：

```text
以后依赖消失
→ 再点一次“清理未使用节点”
```

这比试图设计一个神奇的“全部恢复到导入前数据库状态”可靠得多。

---

# 15. Import 本身不要存一个简单 status

行政认定现在有一个设计我很赞同：

> import 自己不是 active/reversed 状态；真正的当前效果来自它创建的对象。

用户导入也类似。

不要：

```text
status = active | reversed
```

作为唯一真相。

因为可能：

```text
396 个创建用户
50 个后来单独删除
再整体撤销剩余 346
其中 2 个后来又手工恢复
```

一个 `status` 根本讲不清。

可以列表实时聚合：

```text
创建 396

当前：
在用       2
已删除   394
```

然后 Event 显示：

```text
2026-09-20
整体撤销
影响 346 人
```

这样“发生过什么”和“现在是什么”不会混在一起。

---

# 16. 原始 Excel 也建议保留来源，但权限要比普通 Import History 严

这份文件里面可能是：

```text
全学院/全学校姓名
学号
班级
专业
```

本质上是一份人员目录。

所以：

```text
Import 摘要
```

和：

```text
下载原始文件 / 查看每行
```

应该是不同的读取权限判断。

可以直接借鉴行政认定现在的思路：

> 能知道“发生过一次导入”，不一定意味着还能读取文件里所有人的姓名。

如果管理员现在只管理软件学院，就不能因为他历史上参与过一次全校导入，就永远下载那份全校名单。

因此原文件和 row detail 应要求当前 reader 对导入涉及的所有用户/组织仍有足够 reach；否则只显示脱敏摘要，甚至直接把该 Import 从列表中隐藏。

---

## 最终我会这样划分实现

| 模块                 | 负责                                                    |
| -------------------- | ------------------------------------------------------- |
| `@qualy/spreadsheet` | XLSX 安全读取、Sheet、Cell、公式拒绝、限额              |
| `org`                | OrgType DAG、节点规则、批量 resolve/create、delete      |
| `auth`               | UserType、placement、批量 create、bulk soft-delete      |
| `storage`            | 原始 Excel                                              |
| `directory-import`   | 映射、DesiredTree、Preview、Commit、Provenance、Reverse |
| `audit`              | 管理动作审计                                            |

API 我会基本照行政认定的风格做：

```text
POST /iam/user-import-uploads
POST /iam/user-import-uploads/:id/complete

GET  /iam/user-import-uploads/:id/workbook
POST /iam/user-import-previews

POST /iam/user-imports
GET  /iam/user-imports
GET  /iam/user-imports/:importId
GET  /iam/user-imports/:importId/rows

GET  /iam/user-imports/:importId/source
GET  /iam/user-imports/:importId/source/content

POST /iam/user-imports/:importId/reversal-previews
POST /iam/user-imports/:importId/reversals

POST /iam/user-imports/:importId/node-cleanups
```

最后我会把产品语义概括成一句：

> **Import 是一次不可抹去的批量操作记录；Reverse 是对它创建的用户执行正式删除语义；Node cleanup 是对它曾创建、但现在已经没有任何用途的组织节点做可重试垃圾回收。**

这套比“导入完以后提供一个批量删除按钮”稳很多，也和你现在行政认定 Import、User soft-delete、OrgNode restrict-delete、tenant lock/ambient transaction 这几套已经存在的设计是一致的。

---

插入一个小问题。现在系统里对于学工号的文案命名一直很乱套。我觉得这个东西应该允许用户自定义，比如用户想叫“工号”、“用户名”、“学工号”、“教师编号”、“员工识别码”、“统一编号”等都可以，现在是直接在文案里写死了。考虑如何做呢，是做一个通用的术语配置中心吗，一个专门的环境变量吗，那怎么做i18n，你帮忙思考下。

---

这个问题我建议解决，但不是“环境变量”，也不是“允许管理员随便覆盖任何 i18n 文案”。更合适的是做一个**受约束的“术语系统”**：

> 插件声明哪些业务术语允许租户自定义；租户只覆盖这些术语的显示名称；普通文案继续由现有 i18n 管理。

你现在源码里 `businessNo` 已经明显出现漂移了。同一个字段在 `auth/src/client/i18n.ts` 和中文 catalog 里分别出现了：

- `Business number`
- `Student or staff ID`
- `Name or ID`
- 中文的“学工号”
- “姓名或学工号”
- “未绑定学工号”
- “该学工号已被占用”

所以现在的问题其实不是一个 label，而是**“businessNo 这个业务概念没有统一的展示术语来源”**。

我会这么做。

### 1. `businessNo` 永远还是 `businessNo`

首先把内部语义和展示文案彻底分开。

数据库：

```ts
businessNo
```

API：

```ts
businessNo
```

代码：

```ts
user.businessNo
```

都不要动。

租户把它显示成：

```text
学工号
工号
用户名
教师编号
员工识别码
统一编号
```

都只是 presentation。

尤其“用户名”这个名称虽然可以允许，但设置页最好提示：

> 仅修改界面显示名称，不影响登录名、账号绑定或唯一性规则。

因为你现在还有独立的 `identifier` / “登录名”，不能让管理员误以为改成“用户名”以后 businessNo 就成登录凭据了。

---

### 2. 不推荐环境变量

例如：

```env
QUALY_BUSINESS_NO_LABEL=学工号
```

我不推荐。

因为它天然有几个问题：

- 是部署级，不是 tenant 级；
- 修改后通常需要重新部署；
- 多租户不能分别设置；
- 中文英文无法分别配置；
- 前端还需要额外注入；
- 最后每增加一个术语就增加一个 env。

环境变量应该控制部署行为，不应该控制这种租户业务词汇。

---

### 3. 也不要做“任意 i18n 文案覆盖中心”

比如允许管理员输入：

```text
auth/users/title = 学生管理
auth/error/user-conflict = 编号重复啦
assessment/xxx = ...
```

这个方向我会明确避免。

因为你的 i18n message 不只是 label，还有：

- ICU plural；
- 参数；
- 错误消息；
- 无障碍文案；
- 状态提示；
- 插件自己的领域词汇。

任意覆盖之后，类型检查、placeholder 完整性、翻译质量都会失去意义。

所以应该区分：

```text
i18n message
≠
business terminology
```

---

## 4. 我建议做“插件注册式术语中心”

可以新增一个很小的基础能力，例如：

```text
@qualy/terminology-contract
@qualy/plugin-terminology
```

它不是一个“字典管理器”，而是一个**有限的、插件声明的术语 registry**。

例如 auth 插件声明：

```ts
defineTerm({
  id: 'auth/business-number',

  name: message('auth/term/business-number/name', 'Business number'),

  defaultLabel: message('auth/term/business-number/default', 'Student or staff ID'),

  description: message(
    'auth/term/business-number/description',
    'The tenant-wide identifier assigned to a person.',
  ),
})
```

中文 catalog：

```ts
'auth/term/business-number/name': '人员编号',
'auth/term/business-number/default': '学工号',
'auth/term/business-number/description':
  '用于在当前租户内识别人员的唯一业务编号。',
```

于是默认情况下：

```text
zh-CN → 学工号
en-US → Student or staff ID
```

完全走你现在已经存在的 i18n 系统。

---

### 5. 租户只存 override，不存默认值

数据库我更建议单独一张表，而不是往 `Tenant` 里堆 JSON：

```text
terminology_overrides

tenant_id
term_id
locale
value
updated_at
updated_by
```

唯一约束：

```text
(tenant_id, term_id, locale)
```

例如：

| tenant         | term                 | locale | value       |
| -------------- | -------------------- | ------ | ----------- |
| 大连外国语大学 | auth/business-number | zh-CN  | 学工号      |
| 某企业         | auth/business-number | zh-CN  | 员工编号    |
| 某企业         | auth/business-number | en-US  | Employee ID |

如果没设置：

```text
override
  ↓ 没有
插件 defaultLabel
  ↓
当前 locale 的 i18n catalog
```

所以 resolver 是：

```ts
resolveTerm('auth/business-number', 'zh-CN')
```

逻辑：

```text
租户 zh-CN override
    ↓ 不存在
插件 zh-CN 默认翻译
    ↓ 不存在
defaultMessage
```

这和你现有 i18n fallback 思路是兼容的。

---

## 6. Override 应该按语言存，而不是一个全局字符串

这一点我建议从一开始就做好。

不要只有：

```text
businessNumber = "学工号"
```

否则用户切换到 English UI：

```text
Name
学工号
User type
Organization
```

会很别扭。

设置页可以显示：

```text
人员编号

简体中文
[ 学工号              ]

English
[ Student/staff ID    ]

[恢复默认]
```

没有填写某种语言，就使用系统默认翻译。

对于只用中文的学校，管理员只改中文即可。

---

# 7. 普通句子不要自己拼字符串

这是 i18n 最需要注意的一点。

例如现在：

```text
姓名或学工号
```

不要改成组件里：

```ts
;`${format(m.nameLabel)}或${term('auth/business-number')}`
```

这样中文可能没问题，英语、其他语言的语序就开始失控。

应该继续定义完整的 i18n message：

```ts
const pickerSearch = defineMessage<{
  businessNo: string
}>()({
  id: 'auth/picker/search',
  defaultMessage: 'Name or {businessNo}',
})
```

中文：

```ts
'auth/picker/search': '姓名或{businessNo}'
```

调用：

```ts
format(m.pickerSearch, {
  businessNo: term('auth/business-number'),
})
```

同理：

```text
未绑定{businessNo}
该{businessNo}已被占用
输入{businessNo}
按姓名或{businessNo}搜索
```

全部由当前语言的完整句子决定结构。

而单独的表头：

```text
学工号
```

就直接：

```tsx
{
  term('auth/business-number')
}
```

---

## 8. 所以你现在 auth 里的这些 message 可以收敛掉

目前存在：

```ts
businessNoLabel
personBusinessNo
columnBusinessNo
```

这种实际上是同一个概念的 label，不应该有三套翻译。

最后应该变成一个：

```text
auth/business-number
```

例如：

```tsx
<FieldLabel>{terms.get('auth/business-number')}</FieldLabel>
```

```tsx
<TableHead>{terms.get('auth/business-number')}</TableHead>
```

用户详情：

```tsx
<DescriptionTerm>{terms.get('auth/business-number')}</DescriptionTerm>
```

只有上下文句子保留为 i18n message：

```text
未绑定{businessNo}
姓名或{businessNo}
{businessNo}已被占用
```

这样一改，“学工号”不会再散落几十份。

---

# 9. “术语中心”我赞成，但只能管理插件显式开放的术语

设置页我甚至觉得可以就叫：

```text
系统设置
  ├─ 基本信息
  ├─ 品牌
  ├─ 术语
  └─ ...
```

术语页可能是：

```text
术语

用户与登录
────────────────────────

人员编号
用于标识人员的租户内唯一编号。

系统默认    学工号
当前名称    [ 统一编号             ]
            [恢复默认]


综合素质测评
────────────────────────

……
```

以后 assessment 插件也可以注册：

```text
assessment/batch
assessment/entry
assessment/item
```

如果真的有学校称：

```text
批次 → 考核周期
申报 → 加分申请
测评项目 → 加分项
```

也可以开放。

但这里有一个重要原则：

> **不是所有名词都应该可配置。**

例如：

```text
用户
角色
权限
登录方式
```

这些如果随便改，文档、客服、管理员培训都会越来越难。

只把确实存在强机构差异的业务术语注册进去。

所以它不是：

> “全站文字自定义系统”

而是：

> “产品定义好的可定制业务术语列表”。

---

# 10. 插件化层面也很适合 Qualy

因为你现在本来就是 open-world plugin architecture。

我会考虑定义类似：

```ts
export const terms = defineTerms([
  {
    id: 'auth/business-number',
    ...
  },
])
```

插件 descriptor：

```ts
contributions: {
  terminology: {
    terms,
  },
}
```

运行时聚合所有安装插件的 TermDefinition。

因此术语设置页不需要知道 assessment/auth 将来有哪些术语。

安装：

```text
auth
org
assessment
some-third-party-plugin
```

术语页自动出现它们声明的可配置项。

卸载插件以后，对应 override 即使还留在数据库里也没有任何作用；以后重新安装仍然可以恢复。这和开放插件体系比做数据库 FK 更自然。

---

## 11. 前端最好提供一个非常薄的 API

我不会让页面自己碰 override：

```ts
const terms = useTerminology()

terms.text('auth/business-number')
```

或者有类型安全定义后：

```ts
const businessNo = useTerm(authTerms.businessNumber)
```

我更偏第二种，因为可以避免：

```ts
useTerm('auth/bussiness-nubmer')
```

这种运行时 typo。

可以做到：

```ts
export const authTerms = defineTerms({
  businessNumber: {
    id: 'auth/business-number',
    ...
  },
})
```

然后：

```tsx
const businessNo = useTerm(authTerms.businessNumber)
```

---

# 12. 服务端有时也需要 resolve term

不要把这个能力限定为 React。

以后可能：

- Excel 模板表头；
- CSV 导出；
- PDF；
- 邮件；
- 服务端生成错误报告；

都需要显示“学工号 / 工号”。

所以 contract 最好最终有：

```ts
Terminology.resolve({
  tenantId,
  locale,
  term: authTerms.businessNumber,
})
```

客户端 `useTerm()` 只是它的浏览器侧读取形式。

尤其你刚才正在设计“用户导入”，这里很快就会碰到：

```text
Excel 列映射：
学工号 → 人员编号
```

甚至导出模板表头也需要当前租户的术语。

---

# 13. 术语数据怎么送到浏览器

因为量非常小，我不会让每一个 `useTerm()` 发请求。

例如当前租户一共就十几个术语 override：

```json
{
  "auth/business-number": "学工号",
  "assessment/batch": "测评批次"
}
```

登录后 bootstrap/session context 一次带下来，或者：

```text
GET /terminology
```

TanStack Query 长缓存。

修改设置后 invalidate 一次。

如果以后登录页面也需要某个自定义术语，再把**公开可见的 terminology projection** 和 tenant name/logo 一起放到 anonymous tenant bootstrap；不用因此把整个设置系统公开。

---

# 14. 权限上最好单独一个 tenant 级权限

例如：

```text
terminology.read
terminology.manage
```

或者 read 甚至所有登录用户默认允许，因为它只是 UI presentation。

真正的管理：

```text
terminology.manage
target: tenant
```

不要复用：

```text
org.tree.manage
```

因为“把学工号改成统一编号”和编辑组织架构毫无关系。

修改也应该写 audit：

```text
TerminologyOverrideUpdated

termId: auth/business-number
locale: zh-CN
```

我仍然不建议 audit details 里记录旧/新字符串，保持你现在 Audit 那种“记录改了什么，当前值由业务表负责”的原则即可；如果以后确实要求审计历史文字，再单独考虑 snapshot。

---

## 最终结构

我认为这是比较适合 Qualy 的方案：

```text
                    i18n
                      │
          默认术语按 locale 翻译
                      │
                      ▼
Plugin ──注册──► TermDefinition
                      │
                      ▼
              Terminology Registry
                      │
             tenant + locale override
                      │
                      ▼
              effective term
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
       React UI              server export
```

对于当前这个字段：

```text
内部稳定名称：
businessNo

术语 ID：
auth/business-number

系统默认：
zh-CN = 学工号
en-US = Student or staff ID

租户可覆盖：
工号
教师编号
员工识别码
统一编号
用户名
……
```

我认为这是一个值得做成**通用基础能力**的地方，但关键是“通用”只体现在 infrastructure 和配置 UI 上，**哪些词允许改仍然由各插件显式声明**。这样既解决你现在 `businessNo` 文案四处漂移的问题，又不会最终造出一个失控的“管理员可以重写 Qualy 全站翻译”的系统。memcite

---

这两个先做哪个。以及希望术语可以增加分类便于展示。以及术语表这里要不要拓展一下，各种字段类型都做一下，比如支持文件字段，可以自定义租户左上角的Logo等，你觉得如何呢。现在可以不做这个功能，但是可以预留支持相应的功能方便未来拓展。

---

如果这两个是“用户批量导入”和“术语自定义”，我建议顺序是：

1. **先做一个最小版的租户配置基础设施 + 术语能力**
2. 把 `businessNo` 全部迁移到统一术语
3. **马上做用户批量导入**
4. Logo、品牌色之类以后再扩展

但这里我会调整上一条的设计：**不要把它最终做成一个单独的“术语表”然后不断往里面塞字段类型。** “学工号”与“Logo”虽然都属于租户自定义，但语义完全不同。比较合适的是下面这层关系：

```text
租户设置 / Tenant Settings
│
├─ 术语
│   ├─ 人员编号（学工号 / 工号 / 统一编号）
│   └─ ...
│
├─ 品牌
│   ├─ Logo
│   ├─ 深色模式 Logo
│   └─ ...
│
└─ 其他插件设置
```

也就是说，**现在真正值得预留的是一个通用的 Tenant Settings Registry；Terminology 是建立在它上面的一种设置类型。**

### 分类应该现在就做

这个成本非常低，而且之后改会比较烦。我建议定义方式和你现在权限里的 `groupKey/group` 思路类似，但正式叫 `category`：

```ts
defineTerm({
  id: 'auth/business-number',

  category: {
    id: 'identity',
    label: message('auth/settings/category/identity', 'People and sign-in'),
    order: 20,
  },

  label: message('auth/settings/business-number', 'Person identifier'),

  description: message(
    'auth/settings/business-number-description',
    'The tenant-wide business identifier assigned to a person.',
  ),

  defaultValue: message('auth/term/business-number', 'Student or staff ID'),

  order: 10,
})
```

设置页自然就变成：

```text
术语

用户与登录
────────────────────
人员编号
当前：学工号

组织
────────────────────
……

综合素质测评
────────────────────
……
```

这里 `category.id` 是稳定标识，显示名称继续走 i18n。

如果第三方插件也注册设置，不要求它知道你的 UI，只要给 `category + order` 即可。

---

## 底层我会做成“Setting Definition + Setting Kind”

不要设计成：

```sql
terminology_overrides
```

然后以后发现 Logo 也要配置，又硬加：

```text
type
string_value
file_value
number_value
...
```

我更倾向于一开始就是：

```text
tenant_setting_values

tenant_id
setting_id
value jsonb
version
updated_at
updated_by
```

唯一：

```text
(tenant_id, setting_id)
```

**字段是什么类型，不存在数据库里，而由插件注册的 SettingDefinition 决定。**

例如：

```ts
defineTenantSetting({
  id: 'auth/business-number',
  kind: 'localized-text',
  ...
})
```

未来：

```ts
defineTenantSetting({
  id: 'brand/logo',
  kind: 'image',
  ...
})
```

数据库仍然不用迁移。

这和 Qualy 的插件架构很匹配：**schema 存值，代码定义它是什么。**

插件卸载以后，这个 setting value 可以继续留着；重新安装以后恢复，不需要给所有插件设置做 FK。

---

## 但不要现在把所有字段类型都实现掉

这里很容易掉进一个坑：为了一个“学工号”，最后做了一个完整低代码表单引擎。

没必要。

我现在只实现：

```text
localized-text
```

最多顺手支持：

```text
text
```

就停。

但是底层接口不要写死：

```ts
if (setting.kind === 'localized-text') ...
```

而是预留一个 driver：

```ts
interface TenantSettingKind<Value> {
  kind: string

  schema: Schema<Value>

  // 设置页怎么编辑
  editor: ...

  // 怎么显示摘要
  display: ...

  // 保存前额外校验
  validate?: ...

  // 将来资产类型可能需要
  prepareWrite?: ...
  afterWrite?: ...
}
```

第一版只有：

```text
localized-text driver
```

以后再注册：

```text
boolean
number
select
color
image
```

而不是现在全写一遍。

---

# Logo 不应该是“file”字段

这个我会再收紧一点。

你举的 Logo 是很好的未来需求，但我不会定义一个泛化的：

```text
kind: file
```

因为“Logo”实际上有很多额外规则：

```text
只能是图片
允许 SVG / PNG / WebP
大小限制
是否需要深色版
可能要显示预览
更换以后旧文件怎么释放
匿名登录页是否可以读取
缓存策略
```

这些都不是普通“文件”。

所以未来更适合：

```ts
kind: 'image'
```

甚至进一步是：

```ts
defineTenantSetting({
  id: 'brand/logo',
  kind: 'image',

  constraints: {
    mime: ['image/svg+xml', 'image/png', 'image/webp'],
    maxBytes: ...,
  },

  exposure: 'public',
})
```

值可能是：

```json
{
  "attachmentId": "...",
  "alt": null
}
```

而不是把二进制塞进 `tenant_setting_values`。

图片仍然由现有 Storage 管理。

以后如果真有：

```text
上传 Excel 模板
上传证书背景
上传自定义字体
```

再考虑 `asset/file` kind。

不要因为 Logo 顺手制造一个任意文件上传配置项。

---

## “公开还是仅登录后可见”也值得现在预留

Logo 会带出一个术语当前不明显的问题。

有些配置：

```text
Logo
租户显示名称
登录页品牌
```

匿名登录页也要读取。

有些配置：

```text
某些后台术语
插件内部业务选项
```

只给登录用户。

所以 SettingDefinition 里我会现在就留：

```ts
exposure: 'public' | 'authenticated'
```

甚至暂时默认：

```text
authenticated
```

`auth/business-number` 如果登录页完全用不到，就不公开。

Logo：

```text
public
```

以后 anonymous tenant bootstrap 可以只投影：

```text
public settings
```

而不是把整个租户设置表公开出去。

这是一个现在几乎零成本、以后很重要的边界。

---

# Terminology 则做成这个基础设施上的一层语义糖

例如底层：

```ts
defineTenantSetting(...)
```

上层：

```ts
defineTerm(...)
```

`defineTerm()` 本质自动生成：

```text
kind = localized-text
category = terminology 的某个分类
```

但业务代码不要写：

```ts
settings.get('auth/business-number')
```

而是：

```ts
useTerm(authTerms.businessNumber)
```

服务端也是：

```ts
terminology.resolve(authTerms.businessNumber, locale)
```

这样业务代码表达的是：

> “我要一个术语”

而不是：

> “我要读取一个 JSON 配置”。

这个抽象还是有价值的。

---

# 分类我甚至建议分成两层

通用设置系统：

```text
section
category
setting
```

例如：

```text
个性化
└─ 品牌
   ├─ Logo
   └─ ...

术语
├─ 用户与登录
│  └─ 人员编号
├─ 组织
└─ 综合素质测评
```

但**第一版不一定需要 section 数据结构**。

可以先：

```ts
category: {
  ;(id, label, order)
}
```

而术语页面本身已经隐含了 section = `terminology`。

未来真正出现品牌配置页时，再让 generic settings registry 增加：

```ts
surface: 'terminology' | 'branding' | ...
```

甚至由插件注册设置页面。

我不会现在把这个 UI taxonomy 做太重。

---

# 数据结构我会倾向于这样

```ts
type TenantSettingDefinition<Value> = {
  id: string

  category: {
    id: string
    label: UiText
    order: number
  }

  label: UiText
  description?: UiText

  kind: SettingKind<Value>

  defaultValue: ...
  exposure: 'public' | 'authenticated'

  order: number
}
```

对于术语：

```ts
defineTerm({
  id: 'auth/business-number',

  category: authTerminologyCategories.identity,

  label: message(...),

  defaultValue: message(
    'auth/term/business-number',
    'Student or staff ID',
  ),
})
```

数据库 override：

```json
{
  "zh-CN": "学工号",
  "en-US": "Student/staff ID"
}
```

这里我会把一个 localized value 放在**一行 JSONB**里，而不是：

```text
tenant + setting + locale
```

一语言一行。

因为以后 Setting 本身很可能就是：

```json
{
  "light": "...",
  "dark": "..."
}
```

或者其他结构化值。Generic Settings Store 只应该知道：

> 这是一个经过当前 setting driver 验证的 JSON value。

不应该认识“locale”。

---

## Logo 以后可以直接接进来

比如未来 brand 插件注册：

```ts
brandLogo = defineTenantSetting({
  id: 'brand/logo',
  category: brandCategory,
  kind: imageSetting({
    maxBytes: 512 * 1024,
    mimeTypes: ['image/svg+xml', 'image/png', 'image/webp'],
  }),
  exposure: 'public',
})
```

甚至：

```ts
brandLogoDark
```

或者更好：

```ts
kind: brandImage
value: {
  light: attachmentId,
  dark?: attachmentId
}
```

到那时候再根据真实设计决定。

**现在不要提前决定 Logo 必须一张还是两张，也不要提前实现图片上传。**

只要 Setting Kind 是开放的，就已经完成了最重要的未来兼容。

---

# 所以我建议这次实际做到哪里

在开始用户导入之前，我只做这一小段：

```text
Tenant Settings Registry
        ↓
localized-text setting kind
        ↓
defineTerm / useTerm / server resolveTerm
        ↓
category + order
        ↓
租户 override 持久化
        ↓
一个简单的“术语”设置页面
        ↓
auth/business-number
        ↓
清掉所有“学工号”硬编码
```

然后**立刻回用户批量导入**。

不要顺手实现：

```text
Logo
颜色
boolean
select
number
文件上传
品牌设置页
```

但把底层接口设计到将来可以注册这些 kind。

这样这次新增的基础设施不会成为“为了以后可能有需求造了一套大框架”，同时你以后想做：

> 租户左上角 Logo、自定义术语、品牌图标、甚至某些插件自己的设置

都不需要再推翻数据模型。

一句话概括：**先做“小而开放的 Tenant Settings 内核”，术语是第一个消费者；不要把术语系统硬扩成万能配置表，也不要现在把万能配置系统实现完整。** 然后再做用户导入。

---

现在行政认定在日志里显示的是“由机构登记”这个文案太不好了你帮我想一下。以及“行政认定”这个名会不会有点英文直译啊，要不要换一个

---

我建议换。“行政认定”在中文高校场景里确实有一点像从 `administrative recognition` 直译过来的，而且“行政”容易让人联想到行政机关、行政审批，不太贴合你这里真正的业务语义。

你这个功能本质上是：

> 不是学生自己申报，而是学校/学院一侧根据已有事实或名单，直接确认某项结果并计入。

所以我最推荐把整个概念改成 **「统一认定」**。

这样和“学生申报”能形成很自然的对照：

- 学生申报
- 统一认定

而且既能覆盖 Excel 批量导入，也不限制未来增加管理员单条录入。它强调的是“由管理侧统一确认”，而不是具体通过什么技术手段录进去。

至于现在日志里的 **“由机构登记”**，我会直接废掉。“登记”太像纯粹录数据，弱化了“这条结果已经被正式认可”的含义；“机构”也很生硬。

我建议按不同场景这样写：

| 场景              | 推荐文案                    |
| ----------------- | --------------------------- |
| 来源标签          | **统一认定**                |
| 日志/记录简短描述 | **通过统一认定计入**        |
| 强调操作主体      | **由管理员统一认定**        |
| 导入历史动作      | **批量认定**                |
| 撤销动作          | **撤销认定**                |
| 页面标题          | **统一认定** / **批量认定** |

例如一个得分记录可以显示：

> CET-6　+1 分  
> **通过统一认定计入**

或者详情里：

> 认定方式：统一认定  
> 认定时间：2026-09-19  
> 操作人：张老师

这个比：

> 由机构登记

清楚很多。

我不太推荐几个候选词：

“后台认定”太像开发人员术语；“组织认定”容易和 Qualy 的组织树概念混淆；“管理员认定”把业务概念和权限角色绑定死了，以后可能是自动任务或插件执行；“官方认定”又显得太重；“集中认定”强调批量处理，但以后单条录入时就不准确。

所以我会整体统一成：

> **业务概念：统一认定**  
> **记录来源：通过统一认定计入**  
> **批量导入页面：批量认定**  
> **历史记录：认定记录**  
> **撤销：撤销认定**

甚至代码内部仍然可以继续叫 `administrative-import` / `administrativeEntry`，暂时没必要为了 UI 名称迁代码。等以后领域模型稳定了再考虑是否把内部名称一起换成 `recognition` / `institutionalRecognition`。memcite

---

```
Tenant Settings Registry
        ↓
localized-text setting kind
        ↓
defineTerm / useTerm / server resolveTerm
        ↓
category + order
        ↓
租户 override 持久化
        ↓
一个简单的“术语”设置页面
        ↓
auth/business-number
        ↓
清掉所有“学工号”硬编码
```

你结合Github上的源码，认真思考一下这部分在本项目怎么实现，然后给我一个详细的设计开发方案。

---

我按现在 GitHub 上的源码重新过了一遍，基于当前 commit `d6e279650a9804f0de02054a9895a5a3376787e6`，我会把这一块做成一个**很小的基础能力**，但边界一次定对。

核心结论先说：

> 新增 `@qualy/settings-contract` + `@qualy/plugin-settings`。  
> Settings 提供“声明 → 汇总 → 租户覆盖 → 解析”的基础设施；第一版只实现 `localized-text`，并提供 `defineTerm()` 这一层语义糖。  
> `businessNo` 作为第一个术语接入。  
> 不修改现有 i18n 的基本架构，不把动态设置塞进 `/app/manifest`，也不做万能低代码配置中心。

而且我会对我们前面讨论过的一点做一个修正：**`server resolveTerm()` 不应该去加载前端 i18n catalog。** 你现在项目的 i18n 边界已经非常明确，服务器发送语义、浏览器选语言，当前也没有通用的 server-side i18n runtime。术语应该作为“localized business data”自己携带各 locale 的默认值和租户覆盖值。

---

# 一、它在 Qualy 现有架构里应该放在哪里

现在已经有非常成熟的模式：

```text
插件声明 Permission
        ↓
PermissionDeclarations ExtensionPoint
        ↓
RBAC provider 汇总
        ↓
PermissionCatalog
```

Audit 也是一样：

```text
插件声明 AuditAction
        ↓
AuditActionDeclarations
        ↓
Audit provider
        ↓
AuditActionCatalog
```

`plugin-kit` 本身已经把这套模型抽象成：

```ts
ExtensionPoint.make(...)
Plugin.contribute(...)
Plugin.provideExtension(...)
```

所以 Settings 不应该自己再发明一个运行时注册器，而应该完全照这个模式走。

我建议新增：

```text
packages/contracts/settings/
packages/plugins/base/settings/
```

分别发布：

```text
@qualy/settings-contract
@qualy/plugin-settings
```

职责是：

```text
@qualy/settings-contract
────────────────────────
SettingDefinition 类型
TermDefinition 类型
defineTerm()
SettingDeclarations ExtensionPoint
SettingCatalog Effect Service
TenantSettings Effect Service 接口


@qualy/plugin-settings
────────────────────────
SettingDeclarations provider
tenant_setting_values 持久化
TenantSettings 实现
API
权限
审计
“术语”设置页
useTerm()
```

这和当前 `rbac-contract + plugin-rbac`、`audit-contract + plugin-audit` 是同一种分层。

源码依据主要是当前 `Plugin.provideExtension()` / `ExtensionPoint` 模型，以及 RBAC 已经采用的 declaration → catalog 方案。urlplugin-kit 当前实现https://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/core/plugin-kit/src/index.ts urlRBAC declaration/provider 模式https://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/contracts/rbac/src/plugin.ts

---

# 二、先把“设置”和“术语”分成两层

底层应该认识的是：

```ts
TenantSettingDefinition
```

而不是：

```ts
TerminologyDefinition
```

但第一版支持的 kind 只有：

```ts
kind: 'localized-text'
```

然后：

```ts
defineTerm()
```

只是创建这种 SettingDefinition 的一个受约束入口。

也就是说：

```text
Tenant Settings
    │
    ├── localized-text
    │       │
    │       └── defineTerm()
    │
    └── future:
            image
            boolean
            select
            ...
```

但现在**不实现** image/boolean/select 的 renderer、API 或校验器。

只把数据库和 definition 结构设计成以后不需要推翻。

---

# 三、SettingDefinition 建议这样设计

我会定义大概这种结构：

```ts
export interface SettingCategoryDefinition {
  readonly id: string
  readonly label: UiText
  readonly order: number
}

export interface LocalizedTextSettingDefinition {
  readonly kind: 'localized-text'

  readonly id: string
  readonly label: UiText
  readonly description?: UiText

  readonly categoryId: string
  readonly order: number

  readonly defaults: LocalizedText
  readonly maxLength: number

  readonly exposure: 'authenticated' | 'public'

  readonly purpose: 'term'
}
```

其中：

```ts
type LocalizedText = {
  'zh-CN': string
  'en-US': string
}

type LocalizedTextOverride = Partial<LocalizedText>
```

以后 `SupportedLocale` 增加语言以后，这个类型应该跟着自动要求新增默认值，而不是某个术语悄悄没有日文默认名称。

`defineTerm()`：

```ts
export const defineTerm = (definition: Omit<LocalizedTextSettingDefinition, 'kind' | 'purpose'>) =>
  ({
    ...definition,
    kind: 'localized-text',
    purpose: 'term',
  }) as const
```

这里 `purpose: 'term'` 很重要。

因为：

```text
localized-text
```

只是数据类型。

以后完全可能出现：

```text
机构简称
邮件签名
版权文字
```

它们也是 localized text，但不应该出现在“术语”页面。

所以不要写：

> 所有 localized-text 都是术语。

而是：

```text
kind       = 怎么存、怎么校验
purpose    = 它是什么业务设置
```

第一版只有：

```text
kind = localized-text
purpose = term
```

就够了。

---

# 四、分类是 Definition，不是管理员自由创建的数据

用户需要“术语分类”，我建议现在就实现，但它应该是**插件声明的分类**。

例如 auth：

```ts
export const authTermCategories = {
  identity: defineSettingCategory({
    id: 'auth/identity',
    label: message('auth/settings/category/identity', 'People and sign-in'),
    order: 20,
  }),
}
```

然后：

```ts
export const authTerms = {
  businessNumber: defineTerm({
    id: 'auth/business-number',

    categoryId: authTermCategories.identity.id,

    label: message('auth/settings/term/business-number', 'Person identifier'),

    description: message(
      'auth/settings/term/business-number-description',
      'The business identifier assigned to a person in this tenant.',
    ),

    defaults: {
      'zh-CN': '学工号',
      'en-US': 'Student or staff ID',
    },

    maxLength: 64,
    order: 10,
    exposure: 'authenticated',
  }),
}
```

设置页就是：

```text
术语

用户与登录
──────────────────────────────

人员编号

租户内用于识别人员的业务编号。

简体中文
[ 学工号                         ]

English
[ Student or staff ID            ]

                          恢复默认
```

以后 assessment 可以自己贡献：

```text
综合素质测评
────────────────────────
测评批次
申报
统一认定
……
```

分类不是用户自己创建的，原因很简单：

> 分类是产品信息架构，不是租户业务数据。

否则某个管理员创建“其他”“其他2”“临时”“杂项”，这个页面很快就失控。

---

# 五、Contribution 应该怎么接现有插件体系

我会把 categories 和 settings 放在一个 ExtensionPoint 里：

```ts
export interface SettingDeclaration {
  readonly categories?: readonly SettingCategoryDefinition[]
  readonly settings?: readonly TenantSettingDefinition[]
}

export const SettingDeclarations = ExtensionPoint.make<SettingDeclaration>(
  '@qualy/settings-contract/settings',
  { phase: 'prepare' },
)
```

然后提供：

```ts
export const Settings = {
  definitions: (declaration: SettingDeclaration): PluginFeature =>
    Plugin.contribute(SettingDeclarations, declaration),

  provider: Plugin.provideExtension(SettingDeclarations, {
    compile: (contributions) => Layer.succeed(SettingCatalog, compileSettingCatalog(contributions)),
  }),
}
```

auth 中：

```ts
Settings.definitions({
  categories: Object.values(authTermCategories),
  settings: Object.values(authTerms),
}),
```

assessment 以后同样：

```ts
Settings.definitions({
  categories: [...],
  settings: [...],
}),
```

这样 settings 插件完全不知道：

```text
auth
assessment
未来其他插件
```

有什么设置。

---

# 六、`compileSettingCatalog()` 必须做严格校验

这一步不能只是 `flatMap()`。

我会在 assembly 时直接拒绝：

```text
重复 setting id
重复 category id
setting 引用了不存在的 category
非法 id
unsupported kind
缺少某个 SupportedLocale 的默认值
默认值为空
默认值超过 maxLength
order < 0
```

例如两个插件都声明：

```text
auth/business-number
```

应该直接 boot/assembly fail：

```text
setting auth/business-number is declared by both
@qualy/plugin-auth and @qualy/plugin-foo
```

而不是：

> 后注册的覆盖前注册的。

这里跟 RBAC permission code 冲突的处理保持完全一致。

另外建议规定 setting id 第一版就是：

```text
<namespace>/<name>
```

例如：

```text
auth/business-number
assessment/batch
brand/logo
```

不要无限多段。

这样未来 API 也很好做。

---

# 七、数据库不要建“术语表”，建通用 Setting Value 表

当前 `Tenant` 是 `org` 插件持有的，而且已经有一个 `logoUrl` 字段。settings 不应该把字段继续塞进 `Tenant`。url当前 Tenant 实体https://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/plugins/base/org/src/db/entities.ts

新增：

```text
tenant_setting_values
```

我建议结构：

```text
tenant_id      uuid          PK/FK
setting_id     varchar(191)  PK
value          jsonb         NOT NULL
version        integer       NOT NULL DEFAULT 1
created_at     timestamptz   NOT NULL
updated_at     timestamptz   NOT NULL
```

例如：

```json
{
  "zh-CN": "统一编号"
}
```

意味着：

```text
zh-CN → 统一编号
en-US → 没有覆盖，使用 Student or staff ID
```

不要存：

```json
{
  "zh-CN": "统一编号",
  "en-US": "Student or staff ID"
}
```

因为 en-US 并没有覆盖。

即数据库只保存：

> delta / override

默认值永远属于代码中的 Definition。

---

# 八、为什么一定用 JSONB，而不是 locale 一行

我前面曾考虑：

```text
tenant + setting + locale
```

现在结合你未来 Logo 等需求，我会明确改成**一个 setting 一行，value 是 JSONB**。

因为今天：

```json
{
  "zh-CN": "学工号",
  "en-US": "Student ID"
}
```

以后图片可能是：

```json
{
  "attachmentId": "...",
  "alt": {
    "zh-CN": "某某大学",
    "en-US": "Some University"
  }
}
```

或者：

```json
{
  "light": "...",
  "dark": "..."
}
```

数据库不应该认识 locale，也不应该认识 image。

它只认识：

> 某租户对某 SettingDefinition 存了一份经过该 definition 校验的 JSON value。

---

# 九、不要存 `kind`

我也不建议：

```text
setting_id
kind
value
```

因为 `kind` 的真正来源应该是代码里的：

```ts
SettingDefinition
```

否则迟早出现：

```text
代码说 image
数据库说 localized-text
```

然后不知道谁说了算。

因此数据库：

```text
setting_id + value
```

就够。

如果未来某个 setting 从：

```text
localized-text
```

变成：

```text
image
```

这属于 schema 破坏性变更：

> 要么新 setting id，要么显式 migration。

不能运行时猜。

---

# 十、version 我建议保留，而且“恢复默认”不要 DELETE

这里我建议比上一轮更严格一点。

如果没有 override：

```text
version = 0
```

表示数据库不存在这一行。

第一次保存：

```text
expectedVersion = 0
→ INSERT
→ version = 1
```

之后：

```text
expectedVersion = 1
→ UPDATE
→ version = 2
```

但是如果已经存在一行，然后管理员点击“恢复默认”，我**不建议 DELETE**。

而是：

```json
{}
```

继续保留行：

```text
version = 3
```

这样可以避免典型 ABA 问题：

```text
管理员 A 读 version=2
管理员 B 恢复默认，删除行
管理员 C 又创建 override
管理员 A 还拿着 version=2……
```

保留空 override 行以后版本永远单调：

```text
1 → 2 → 3 → 4
```

并且 `{}` 的语义非常清楚：

> 当前没有租户覆盖，完全跟随代码默认值。

如果从来没改过，数据库则完全没有记录。

---

# 十一、不要把默认值存进数据库

非常重要。

假设未来你认为默认中文应该从：

```text
学工号
```

改成：

```text
人员编号
```

没有自定义过的租户应该自动得到新默认值。

如果初始化时给每个租户写入：

```json
{ "zh-CN": "学工号" }
```

那新版本改默认值以后，所有老租户永远停留在旧值。

所以：

```text
代码 defaults
    +
数据库 override
    =
effective value
```

严格区分。

---

# 十二、TenantSettingValue 实体应该归 settings 插件

大概：

```ts
export const TenantSettingValue = defineEntity({
  name: 'TenantSettingValue',
  tableName: 'tenant_setting_values',
  properties: {
    tenantId: () =>
      p
        .manyToOne(Tenant)
        .primary()
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .deleteRule('cascade'),

    settingId: p.string().length(191).primary(),

    value: p.json<Record<string, unknown>>().defaultRaw(`'{}'`),

    version: p.integer().default(1),

    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
})
```

然后：

```ts
Db.entities(entities, {
  dependsOn: ['@qualy/plugin-org'],
})
```

这和当前 auth 实体引用 `Tenant` 的方式一致。

我不会加：

```text
updated_by FK users
```

因为：

1. 会制造 settings → auth database dependency；
2. 用户删除/生命周期会复杂；
3. Audit 已经记录 actor。

需要知道谁改的，查 Audit。

---

# 十三、设置写入不需要锁整个 Tenant

这里也不用你前面用户导入那个：

```text
lock tenant
```

因为这是一个非常局部的单资源更新。

直接：

```text
tenant_id + setting_id + version
```

做 optimistic concurrency 就行。

逻辑：

```ts
if (expectedVersion === 0) {
  INSERT
} else {
  UPDATE
  WHERE
    tenant_id = ?
    AND setting_id = ?
    AND version = expectedVersion
}
```

update count = 0：

```text
SETTING_VERSION_CONFLICT
```

第一次 insert 遇 unique collision：

```text
SETTING_VERSION_CONFLICT
```

而不是 DB 500。

---

# 十四、写之前必须通过 Definition 校验和 normalization

例如 localized-text：

```ts
normalize({
  'zh-CN': '  工号 ',
  'en-US': 'Student or staff ID',
})
```

得到：

```json
{
  "zh-CN": "工号"
}
```

因为：

```text
trim
zh-CN ≠ 默认 → 保存
en-US = 默认 → 去掉
```

我建议：

```text
空字符串 = 没有 override
```

所以 UI 可以让输入框为空表示：

> 使用默认值。

例如：

```text
简体中文
[                         ]
默认：学工号
```

管理员输入：

```text
统一编号
```

才是真正 override。

这样比：

```text
必须填一个文本 + 单独恢复按钮
```

自然一点。

可以仍然保留“恢复默认”按钮，作用就是清空这一项。

---

# 十五、Server `resolveTerm()` 怎么做

这是这一套里面很关键的一层。

不要：

```ts
server.formatMessage(...)
```

也不要让服务器加载：

```text
auth/src/client/locales/zh-CN.ts
```

你当前 `@qualy/web-i18n` 是浏览器 runtime，`useI18n()` 管当前 locale，catalog 是客户端懒加载的。url当前 web i18n runtimehttps://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/web/i18n/src/index.tsx

Term 本身则是：

```ts
defaults: {
  'zh-CN': '学工号',
  'en-US': 'Student or staff ID',
}
```

所以服务器：

```ts
yield * tenantSettings.resolveTerm(tenantId, authTerms.businessNumber, 'zh-CN')
```

只需要：

```ts
override[locale] ?? definition.defaults[locale]
```

不涉及 i18n catalog。

这实际上很好地区分了两类东西：

```text
“保存” / “搜索” / “该编号已被占用”
= 产品文案
= i18n


“这个学校把 businessNo 叫什么”
= 租户业务数据
= terminology
```

---

# 十六、Context sentence 仍然必须走 i18n

这点不能因为有术语以后退化。

例如现在：

```text
姓名或学工号
```

不能改成：

```ts
;`${format(m.name)}或${businessNo}`
```

应该：

```ts
const pickerSearch = defineMessage<{
  businessNo: string
}>()({
  id: 'auth/picker/search',
  defaultMessage: 'Name or {businessNo}',
})
```

中文：

```ts
'auth/picker/search': '姓名或{businessNo}'
```

然后：

```tsx
const businessNo = useTerm(authTerms.businessNumber)

placeholder={format(m.pickerSearch, {
  businessNo,
})}
```

这样英文、中文语序仍然归 i18n。

这是：

```text
i18n sentence
        ↑
插入 effective terminology
```

而不是两套系统互相取代。

---

# 十七、客户端 `useTerm()` 怎么实现

我不建议改 `I18nProvider`。

也不建议把 term override 塞进 `/app/manifest`。

现在 manifest 的职责很纯：

```text
当前 viewer 可以发现哪些 page
哪些 layout
哪些 collection
哪些 slot
```

它是 UI topology/authorized projection，不应该因为管理员把“学工号”改成“工号”就让整个 application manifest 变成一份配置快照。

所以 Settings 自己提供 API。

第一版可以：

```http
GET /tenant/terminology
```

所有已登录用户都能访问。

返回：

```ts
{
  categories: [
    {
      id: 'auth/identity',
      label: UiText,
      order: 20,
    },
  ],

  terms: [
    {
      id: 'auth/business-number',
      categoryId: 'auth/identity',

      label: UiText,
      description: UiText | null,

      order: 10,

      defaults: {
        'zh-CN': '学工号',
        'en-US': 'Student or staff ID',
      },

      override: {
        'zh-CN': '统一编号',
      },

      version: 3,
    },
  ],
}
```

普通业务页面和设置页都读这一份。

---

# 十八、为什么 GET 不需要 `settings.terminology.read`

我会修正之前的建议：

**第一版只加 manage 权限，不加 read。**

即：

```text
settings.terminology.manage
target: tenant
```

因为每个普通用户都必须看到：

```text
学工号 / 工号 / 统一编号
```

如果“读取术语”还需要权限，那一个无权限学生怎么办？

最终还是得给他读。

因此：

```text
GET terminology
→ Authenticated

PUT terminology
→ settings.terminology.manage
```

最合理。

设置页面自身：

```ts
visibility: permissionOf('settings.terminology.manage')
```

所以没管理权限的人虽然技术上能读取术语，却不会看到术语设置页面。

这和“读取品牌 Logo 不需要管理品牌权限”是一个道理。

---

# 十九、PUT 我建议是资源替换，不做 save/reset action

遵循你现在项目的 API 规范，不要：

```text
POST /tenant/terms/save
POST /tenant/terms/reset
```

可以：

```http
PUT /tenant/terminology/:namespace/:name
```

例如：

```text
PUT /tenant/terminology/auth/business-number
```

payload：

```json
{
  "version": 3,
  "override": {
    "zh-CN": "统一编号"
  }
}
```

完全恢复默认：

```json
{
  "version": 3,
  "override": {}
}
```

返回：

```json
{
  "version": 4,
  "override": {}
}
```

一个资源，一个 PUT。

---

# 二十、`useTerm()` 不要一处一个请求

`@qualy/plugin-settings/client`：

```ts
export function useTerminology() {
  return useQuery(
    settingsQuery.tenant.getTerminology.queryOptions(...)
  )
}
```

然后：

```ts
export function useTerm(term: TermDefinition): string {
  const { locale } = useI18n()
  const query = useTerminology()

  const override = query.data?.termsById.get(term.id)?.override[locale]

  return override ?? term.defaults[locale]
}
```

所有：

```ts
useTerm(...)
```

实际上共享同一个 TanStack Query cache。

所以一个页面用了二十次：

```text
useTerm()
```

也只有一次网络请求。

---

# 二十一、locale 切换不应该重新请求服务器

因为 GET 已经把：

```json
{
  "zh-CN": "...",
  "en-US": "..."
}
```

一起拿回来了。

所以切换：

```text
zh-CN → en-US
```

只是：

```ts
override[locale] ?? defaults[locale]
```

重新 render。

不需要 refetch。

这和你现在 `useI18n()` locale 切换模型也一致。

---

# 二十二、术语加载失败，不应该让整个 UsersPage 崩掉

这是我不建议让 `useTerm()` 走 Suspense hard dependency 的原因。

术语是 presentation。

如果：

```text
GET /tenant/terminology
```

临时失败：

UsersPage 不应该因此打不开。

所以：

```ts
return serverOverride ?? definition.defaults[locale]
```

请求 Pending/Error 时直接使用默认值。

最多会发生：

```text
学工号
↓ 请求回来
统一编号
```

的很短一次更新。

如果以后你觉得这个视觉切换不可接受，再把 terminology snapshot 提升进 authenticated bootstrap。

第一版没必要为了一个 label 让所有页面的首屏都依赖一个额外网络请求。

---

# 二十三、保存后立即刷新全站术语

设置页 PUT 成功后：

```ts
queryClient.invalidateQueries(terminologyQueryKey)
```

当前页面重新取值。

于是：

```text
学工号 → 统一编号
```

保存成功以后：

UsersPage、用户详情、PeoplePicker 等下一次渲染都会统一。

而且你当前 `useSessionTransition()` 本身会 reset query cache，所以用户切换 Session 后，也不会把 A 租户术语泄漏到 B 租户。

这一点现有 web runtime 已经帮你处理好了。

---

# 二十四、Settings plugin 的 descriptor 大致应该是这样

概念上：

```ts
const plugin = Plugin.define(
  '@qualy/plugin-settings',
  {
    dependsOn: [
      '@qualy/plugin-audit',
      '@qualy/plugin-database',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },

  Db.entities(entities, {
    dependsOn: ['@qualy/plugin-org'],
  }),

  Settings.provider,

  Access.permissions('settings', permissions),

  Audit.actions('settings', settingsActions),

  Ui.i18n('./client/i18n'),

  Ui.page({
    id: 'settings/terminology',
    path: '/settings/terminology',
    component: Ui.react('./client/TerminologyPage'),
    layout: APP_SHELL,
    visibility: permissionOf('settings.terminology.manage'),
    navigation: {
      label: message('settings/navigation/terminology', 'Terminology'),
      order: 10,
      group: 'settings/system',
    },
  }),

  Ui.surfaces({
    collections: [
      {
        collection: navigationGroups,
        id: 'settings/system',
        value: {
          id: 'settings/system',
          label: message('settings/nav-group/system', 'System settings'),
          order: 90,
          icon: 'settings',
        },
        visibility: permissionOf('settings.terminology.manage'),
      },
    ],
  }),

  Api.group(settingsApiGroup, settingsApiHandlers),

  Plugin.layer(serviceLayer),
)
```

这样普通学生不会得到一个空的“系统设置”导航，因为你现在 manifest 对空 navigation group 本身已经会剔除。

---

# 二十五、Audit 怎么记

新增：

```ts
TermOverrideUpdated
```

例如：

```ts
export const TermOverrideUpdated = AuditAction.define({
  code: 'settings.term.update',
  target: 'settings.term',
  version: 1,
  name: message('settings/audit/term-update', 'Change terminology'),

  details: Schema.Struct({
    locales: Schema.Array(Schema.Literals(['zh-CN', 'en-US'])),
  }),
})
```

我还是不建议 audit details 存：

```text
before = 学工号
after = 员工编号
```

当前项目 Audit 的风格本来就是：

> 记录改了什么，不复制整份业务数据。

auth 的 `UserUpdated` 也是记录：

```ts
fields: ['businessNo']
```

而不是保存新旧值。url当前 Auth audit actionshttps://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/plugins/base/auth/src/actions.ts

所以这里也保持一致。

---

# 二十六、`auth/business-number` 最好定义在 auth contract，而不是 UI 文件

因为这个术语已经不是 auth UI 私有概念了。

现在 assessment 也大量使用：

```text
businessNo
```

甚至行政认定 Excel 都依赖。

所以我建议：

```text
packages/contracts/auth/src/terms.ts
```

定义：

```ts
export const authTerms = {
  businessNumber: ...
}
```

这样：

```text
auth client
assessment client
assessment server
未来 user import
```

都引用同一个 token：

```ts
authTerms.businessNumber
```

而不是 assessment 再自己声明一个：

```text
assessment/business-number
```

否则租户改一次“学工号”，还得改两处设置，这就失去意义了。

---

# 二十七、当前 auth 里具体需要迁哪些地方

源码里目前至少已经有：

```text
NewUserForm
UserDetailPage
PersonCard
UsersPage
PeoplePickerView
UserMenu
DrawerIdentity
```

在分别引用：

```text
businessNoLabel
personBusinessNo
columnBusinessNo
pickerSearch
noBusinessNo
```

这些应该收敛。

例如：

```tsx
const businessNoLabel = useTerm(authTerms.businessNumber)
```

然后：

```tsx
<Field label={businessNoLabel}>
```

```tsx
<span>{businessNoLabel}</span>
```

```tsx
<Row label={businessNoLabel} ... />
```

于是以下 i18n message 可以删除：

```text
auth/person/business-no
auth/field/business-no
auth/users/column-business-no
```

因为它们本质上都是同一个词。

当前 auth i18n 确实已经同时存在 `Business number` 和 `Student or staff ID` 两种默认英文表达。url当前 auth i18n 定义https://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/plugins/base/auth/src/client/i18n.ts

---

# 二十八、这些 message 不能删除，而应该参数化

例如：

```text
姓名或学工号
未绑定学工号
```

分别改成：

```ts
defaultMessage: 'Name or {businessNo}'
```

和：

```ts
defaultMessage: 'No {businessNo}'
```

中文：

```text
姓名或{businessNo}
未绑定{businessNo}
```

然后传：

```ts
{
  businessNo: useTerm(authTerms.businessNumber)
}
```

---

# 二十九、`USER_CONFLICT` 我反而建议改成中性文案

现在中文：

```text
该学工号已被占用。
```

英文：

```text
That business number is already taken.
```

理论上可以让 error formatter 也注入术语。

但为了这一句话去改：

```text
defineErrorTranslations
formatApiError
I18nRuntime
```

完全不值。

直接改成：

```text
该编号已被使用。
```

英文：

```text
This identifier is already in use.
```

即可。

错误码仍然是：

```text
USER_CONFLICT
```

内部字段仍然是：

```text
businessNo
```

不需要所有文案都强行出现自定义术语。

---

# 三十、Assessment 也必须跟着迁

这次不能只清 auth。

我搜了当前源码，assessment 里也有：

```text
姓名或学工号
学工号
学工号为空
没有你可认定的该学工号人员
```

主要在：

```text
assessment/core/src/client/locales/zh-CN.ts
record import
record search
```

因此这次 migration 的完成标准应该是：

> 生产代码中，除 `authTerms.businessNumber.defaults['zh-CN']` 外，不再出现用户可见的硬编码“学工号”。

可以加 repository gate 固定住：

```text
grep / AST test
```

允许位置只有：

```text
packages/contracts/auth/src/terms.ts
```

测试 fixture 可以另行豁免。

这样以后开发 assessment/user-import 的人再写：

```ts
'姓名或学工号'
```

CI 直接拒绝。

这个 gate 我认为很值得。

---

# 三十一、行政认定 Excel 也可以接 `server resolveTerm`

目前 `administrative-import/workbook.ts` 明确写死：

```ts
const BUSINESS_NO_HEADER = '业务编号 *'
```

然后：

```ts
const headers = [BUSINESS_NO_HEADER, NAME_HEADER]
```

url当前行政认定 workbook 实现https://github.com/hprogq/qualy/blob/d6e279650a9804f0de02054a9895a5a3376787e6/packages/plugins/assessment/core/src/administrative-import/workbook.ts

以后 service：

```ts
const businessNoLabel = yield * settings.resolveTerm(tenantId, authTerms.businessNumber, locale)
```

然后：

```ts
buildAdministrativeWorkbook({
  ...businessNoLabel,
})
```

Workbook：

```ts
const headers = [`${spec.businessNoLabel} *`, NAME_HEADER]
```

于是某租户下载就是：

```text
统一编号 *
```

另一家企业：

```text
员工编号 *
```

---

# 三十二、这里有一个我专门检查过的兼容性细节

好消息是：

**改术语不会导致以前下载的行政认定模板失效。**

当前 parser：

```text
A 列直接作为 businessNo
B 列直接作为 displayName
```

而 `provenColumns()` 校验的只是：

```text
evidence.*
recognition.*
```

这些由 item revision 决定的动态列。

它不会拿：

```text
A1 = “业务编号 *”
```

去和当前代码重新比较。

所以：

```text
9 月 1 日下载：
学工号 *

9 月 3 日管理员改：
学工号 → 统一编号

9 月 5 日上传旧模板：
学工号 *
```

仍然应该正常导入。

这正是合理行为。

我会专门增加一个测试：

```text
template downloaded under term A
→ terminology changes to B
→ old workbook still parses and imports
```

防止以后有人“加强 header 校验”时误伤这个特性。

---

# 三十三、但是不要借这个机会解决所有服务端文案

Workbook 现在还有：

```text
姓名
认定依据
认定：xxx
```

等服务端生成文案。

这是现存的另一个 server-side localization 问题。

不要这次因为改一个 businessNo 就顺手发明完整：

```text
@qualy/server-i18n
```

本次：

```text
businessNo header
→ term，是 business data，所以 resolveTerm
```

其他产品文案保持现状。

以后真正要做英文 Excel/PDF/邮件时，再建设 server-side i18n。

边界要守住。

---

# 三十四、设置页 UI 我建议非常简单

不要做“配置中心后台表格”。

更适合：

```text
术语

自定义当前租户在界面中使用的业务称谓。
未设置的语言使用系统默认名称。


用户与登录
─────────────────────────────────

人员编号
用于在当前租户中识别人员的业务编号。

简体中文
[ 统一编号                         ]
默认：学工号

English
[                                  ]
默认：Student or staff ID

                        [恢复默认]
```

一项一个轻量 section。

只有十几个术语时，比：

```text
名称 | Key | 中文 | 英文 | 类型 | 操作
```

这种后台管理表格自然得多。

Key：

```text
auth/business-number
```

默认不要给普通管理员看。

可以在开发/debug affordance 里看，不是业务概念。

---

# 三十五、第一版不要做“万能 Setting Editor”

这一点我会写进 implementation scope。

不要现在写：

```ts
switch (setting.kind) {
  case 'localized-text':
  case 'text':
  case 'number':
  case 'boolean':
  case 'image':
  case 'file':
  case 'select':
  ...
}
```

第一版唯一合法值：

```text
localized-text
```

但数据模型是：

```text
setting_id + JSONB
```

Definition 有：

```text
kind
```

所以以后加：

```ts
type TenantSettingDefinition = LocalizedTextSettingDefinition | ImageSettingDefinition
```

即可。

这已经叫“预留好了”。

没有必要提前写不存在的 renderer。

---

# 三十六、Logo 将来怎么接

当前 `Tenant` 已经有：

```text
logoUrl
```

所以以后做品牌配置时，要先决定：

> `Tenant.logoUrl` 是 canonical tenant metadata，还是应该迁到 settings？

但一定不要两个同时作为 source of truth。

未来如果决定 Settings 接管：

```ts
defineImageSetting({
  id: 'brand/logo',
  exposure: 'public',
  ...
})
```

数据库：

```json
{
  "attachmentId": "..."
}
```

实际文件仍归 Storage。

Settings 不存：

```text
base64
URL
binary
```

而只存引用。

这次完全不用实现。

不过 `SettingDefinition.exposure` 我建议现在就放进去：

```text
authenticated
public
```

当前：

```text
auth/business-number
→ authenticated
```

未来：

```text
brand/logo
→ public
```

然后 anonymous tenant bootstrap 只投影 public settings。

不是：

> public API 返回整个 settings 表。

---

# 三十七、推荐依赖关系

最后会形成大致这样的结构：

```text
                  plugin-kit
                      │
              settings-contract
             /        │         \
            /         │          \
   auth-contract      │      assessment
       │              │
       │          plugin-settings
       │          /    |     \
       │        DB     API     UI
       │
   plugin-auth
       │
       └── contributes
           auth/business-number


assessment
   │
   ├── client:
   │    useTerm(authTerms.businessNumber)
   │
   └── server:
        TenantSettings.resolveTerm(...)
```

settings plugin 不需要依赖 auth plugin implementation。

它只用：

```text
auth-contract/session
```

里的 `Authenticated` / `CurrentUser` 这类协议，和现在 UI registry 用 Viewer 的方式一样。

这样不会形成：

```text
auth ↔ settings
```

服务循环。

---

# 三十八、我建议按 7 个开发阶段做

| 阶段 | 内容                       | 完成标准                                                                    |
| ---- | -------------------------- | --------------------------------------------------------------------------- |
| A    | `settings-contract`        | Definition、category、defineTerm、ExtensionPoint、Catalog 编译与测试        |
| B    | `plugin-settings` 持久化   | `tenant_setting_values`、migration、repository/service、version concurrency |
| C    | API/权限/Audit             | GET terminology、PUT term override、`settings.terminology.manage`、audit    |
| D    | 客户端                     | `useTerminology()`、`useTerm()`、query invalidate、fallback                 |
| E    | 设置页                     | `/settings/terminology`、分类展示、各 locale override                       |
| F    | businessNo migration       | auth + assessment 全量替换、context message 参数化                          |
| G    | server integration + gates | 行政认定模板接术语、旧模板兼容测试、禁止新增“学工号”硬编码                  |

我不会把 Logo 放在这七步里。

做到 G 就停。

然后马上回去做你的**用户批量导入**。

---

# 三十九、测试我会重点卡这些，不只是 happy path

最值得写的测试包括：

```text
Registry
────────────────
重复 setting id → assembly fail
重复 category id → fail
不存在 category → fail
缺 zh-CN/en-US 默认值 → fail


Tenant isolation
────────────────
tenant A 改“工号”
tenant B 仍然“学工号”


Fallback
────────────────
A 只覆盖 zh-CN
zh-CN → 工号
en-US → Student or staff ID


Optimistic concurrency
────────────────
A/B 同时读 version 2
A 保存 → 3
B 保存 version 2 → SETTING_VERSION_CONFLICT


Normalization
────────────────
"  工号  " → "工号"
与默认完全相同 → override 删除
空字符串 → 使用默认


Authorization
────────────────
普通学生 GET → 成功
普通学生 PUT → 403
tenant admin PUT → 成功


Audit
────────────────
更新值与 audit 同一 transaction
audit 失败 → setting 不提交


Client
────────────────
多个 useTerm → 一次 query
locale switch → 不 refetch
request fail → default


businessNo
────────────────
自定义“统一编号”
UsersPage / Detail / Picker /
Assessment record 全部显示一致


Workbook
────────────────
新模板 → “统一编号 *”
旧“学工号 *”模板在术语修改后仍可导入
```

最后这一组尤其重要。

---

## 最后我会把实现边界冻结成这句话

**Settings Registry 管“租户允许覆盖哪些产品定义的设置”；SettingDefinition 决定类型和默认值；数据库只保存 tenant override；Terminology 是 Settings 的第一个受约束消费者，而不是另一套 i18n。**

这样做完以后，`businessNo` 的链路会真正变成：

```text
authTerms.businessNumber
           │
           ├── 默认：
           │   zh-CN 学工号
           │   en-US Student or staff ID
           │
           ├── tenant override
           │
           ▼
     effective term
        /       \
       /         \
 useTerm()   resolveTerm()
 browser        server
   │              │
   ▼              ▼
UsersPage       Excel
Assessment      future export
Picker          user import
```

我认为这套非常贴合 Qualy 现在已经成型的 `ExtensionPoint → provider → catalog` 架构，而且实现规模控制得住：**基础设施是通用的，但本轮只有一种 setting kind、一个设置页和一个真实术语。** 不会为了“学工号”顺手造出一套低代码平台。
