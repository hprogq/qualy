# P1 施工手册

## 0. 总览

**P1 目标一句话**：在 P0 插件装配骨架上迁入最小可用的身份与权限基座，完成「本地登录 → 组织树 → 节点作用域 RBAC → 服务端鉴权 → manifest 菜单过滤」闭环，并提供最小数据字典能力。

P1 不是旧 Qualy 的整体搬迁，也不是重新设计一套企业 IAM。判断标准：

> 能直接支撑 P2–P4 主业务的迁移；只服务“未来可能需要”的能力不迁移。

PLAN 的既定验收保持不变：

- 本地账号可以登录、获取当前用户并退出；
- 组织树可以查询和管理；
- 角色和权限可以分配；
- 无权限用户直接调用 API 返回 403；
- 不同角色获得不同的导航和页面 manifest；
- P1 控制在 1–2 周，超过范围即视为镀金。

---

## 0.1 核心裁决

### 裁决一：保留租户边界，不实现完整多租户产品

P1 采用“数据库多租户、产品单租户”的折中模式。

保留：

- `tenants` 表；
- 所有租户业务表的 `tenant_id`；
- 复合外键和租户范围唯一约束；
- session 中可信的 `tenantId`；
- repository 所有查询显式带 `tenantId`；
- 测试中创建第二租户验证隔离。

不实现：

- `x-tenant-slug` 请求头；
- 用户自由选择或切换租户；
- 租户 CRUD 页面；
- 平台级超级管理员；
- 子域名、Host、路径租户解析；
- schema-per-tenant；
- PostgreSQL RLS；
- 跨租户数据统计；
- 租户套餐、配额和计费。

正常 API 不允许接收客户端提交的 `tenantId`。租户来源只有两个：

1. 未登录阶段：`@qualy/plugin-auth` 配置的 `defaultTenantSlug`；
2. 登录阶段：已经验证的 session。

这保留了未来部署多个学校、学院或 ACM 社团空间的可能，但不会让 P1 变成 SaaS 平台建设。

### 裁决二：组织树搬迁，认证适配，RBAC 重构

迁移策略分三类。

#### 直接迁移并适配

- `tenants`、`org_types`、`org_type_rules`、`org_nodes`；
- `ltree` 自定义类型和子树查询；
- 组织类型规则验证；
- 节点创建、修改、移动、删除；
- 根节点保护；
- errors / repo / service 分层；
- 组织领域测试；
- 本地密码 Argon2 哈希；
- 用户身份与认证提供者的基本模型。

#### 保留概念但重写实现

- oRPC contract 和 router：旧项目是 oRPC v1，必须按当前 v2 beta API 重写；
- session：改为 Cookie + token hash；
- tenant middleware：改为配置和 session 派生；
- RBAC 权限存储：数组改规范化表；
- 路由鉴权：改为 oRPC middleware/helper；
- 导航过滤：接入当前 `ui-registry`；
- 数据访问：全部使用 `ctx.db.drizzle`，禁止旧项目全局 `db`；
- 插件注册和清理：全部遵守 Cordis effect 纪律。

#### 不迁移

- NestJS/Hono/Bun 宿主代码；
- Kysely 时代代码和生成类型；
- 旧前端 dashboard；
- 完整 CAS 登录；
- 注册、找回密码、邮件验证；
- MFA 和设备管理；
- `user_types`、`capabilities`、`isSuperAdmin`；
- 用户类型与组织类型的允许关系；
- 角色与用户类型、组织类型的允许关系；
- CASL；
- deny 权限和条件表达式；
- 角色拖拽排序；
- 角色数量上限；
- 全表软删除；
- 审计日志中心；
- Redis 权限缓存；
- 在线租户切换；
- 数据迁移兼容旧库。

`user_types` 暂不迁移。综测中的“学生、审核员、管理员”本质上是权限身份，使用角色表达即可。以后确实出现与权限无关的用户分类需求，再增加稳定的 `kind` 或成员类型，不提前恢复旧模型。

---

## 0.2 会话地图

| 会话 | 主题                              |     预计 | 风险                | 建议人工在场 |
| ---- | --------------------------------- | -------: | ------------------- | ------------ |
| 1    | 迁移清单、插件骨架与请求上下文    |   0.5 天 | 中                  | 建议         |
| 2    | 租户与组织树 schema、迁移、种子   |     1 天 | 高：复合外键、ltree | 是           |
| 3    | 本地认证、session 与 principal    | 1–1.5 天 | 高：Cookie、安全    | 是           |
| 4    | RBAC schema、权限注册与作用域算法 | 1–1.5 天 | 高：授权语义        | 是           |
| 5    | 组织树 service/API/UI 搬迁        | 1–1.5 天 | 中                  | 建议         |
| 6    | 用户、身份、角色管理最小闭环      |     1 天 | 中                  | 建议         |
| 7    | manifest 权限过滤与 dict 插件     |     1 天 | 中                  | 建议         |
| 8    | 集成验收、隔离测试和文档收口      | 0.5–1 天 | 低                  | 否           |

时间达到 8–9 个有效开发日仍未完成时，按以下顺序砍单：

1. 砍角色管理 UI，只保留 API 和 seed；
2. 砍数据字典管理 UI，只保留读 API；
3. 砍组织类型规则管理 UI，使用 seed 固定规则；
4. 砍用户创建 UI，保留 seed 用户；
5. 不得砍 API 鉴权、manifest 过滤和租户隔离测试。

---

## 0.3 目标插件与依赖关系

新增四个基础插件：

```text
packages/plugins/base/
  org/
  auth/
  rbac/
  dict/
```

包名：

```text
@qualy/plugin-org
@qualy/plugin-auth
@qualy/plugin-rbac
@qualy/plugin-dict
```

数据库 schema 所有权：

```text
org
  tenants
  org_types
  org_type_rules
  org_nodes

auth
  users
  auth_providers
  user_identities
  sessions

rbac
  permissions
  roles
  role_permissions
  user_role_assignments

dict
  dicts
  dict_items
```

运行时依赖建议：

```text
database ─┬─ rbac
          ├─ auth ───────┐
server ───┤              │
ui ───────┤              │
          └──────────────┤
                         ├─ org
                         └─ dict
```

具体规则：

- `rbac` inject `database/server/ui`；
- `auth` inject `database/server/ui/rbac`；
- `org` inject `database/server/ui/rbac`；
- `dict` inject `database/server/ui/rbac`；
- `rbac` 不运行时调用 `ctx.auth` 或 `ctx.org`，避免循环依赖；
- `rbac` 需要用户和组织信息时，直接通过 Drizzle 查询对应插件导出的表；
- schema 的跨插件 import 不等于 Cordis 运行时 inject。

`qualy.yml` 顺序：

```yaml
- name: '@qualy/plugin-database'
- name: '@qualy/plugin-server'
- name: '@qualy/plugin-ui-registry'
- name: '@qualy/plugin-rbac'
- name: '@qualy/plugin-auth'
- name: '@qualy/plugin-org'
- name: '@qualy/plugin-dict'
```

每新增插件仍需：

1. 根 `package.json` 加 workspace dependency；
2. `qualy.yml` 加条目；
3. package.json 声明当前主线使用的 `qualy.database.schemaEntry`；
4. 导出 `./schema`、`./contract`，有前端组件时导出 `./client`。

不要恢复已回退的 assembly lock、behavior lock 或 schema 生成文件。沿用当前主线的 schema entry 解析、命名迁移、drop-guard 和 custom migration 通道。

---

## 0.4 目标目录模板

每个基础插件保持同一形态：

```text
packages/plugins/base/org/
  package.json
  src/
    index.ts
    contract.ts
    errors.ts
    repo.ts
    service.ts
    router.ts
    db/
      schema.ts
    client/
      index.ts
      OrgPage.tsx
  tests/
    service.test.ts
    integration.test.ts
```

职责：

- `db/schema.ts`：Drizzle 表、索引、约束和导出类型；
- `contract.ts`：Zod + oRPC contract，不引用数据库 row 类型作为公开 DTO；
- `errors.ts`：领域错误；
- `repo.ts`：纯数据访问，必须接收 `db` 或 transaction；
- `service.ts`：领域规则和事务边界；
- `router.ts`：contract implementation、错误翻译和权限检查；
- `index.ts`：Cordis 插件装配、服务暴露、路由和 UI effect 注册；
- `client/`：只放本插件的页面组件和 thunk 表；
- `tests/`：领域测试与 PG18 集成测试。

禁止旧代码中的：

```ts
import { db } from '../../db'
```

改为：

```ts
service.operation(ctx.db.drizzle, input)
```

或者插件 Service 持有 `ctx.db`，但 repo 函数仍显式接收 `db`/`tx`，便于事务和测试。

---

## 0.5 数据模型定案

### 0.5.1 租户和组织树

```text
tenants
  id uuidv7 PK
  slug varchar UNIQUE
  name varchar
  logo_url nullable
  created_at
  updated_at

org_types
  id uuidv7 PK
  tenant_id
  code
  name
  sort_order
  created_at
  updated_at
  UNIQUE (tenant_id, id)
  UNIQUE (tenant_id, code)

org_type_rules
  tenant_id
  parent_type_id
  child_type_id
  PK (tenant_id, parent_type_id, child_type_id)

org_nodes
  id uuidv7 PK
  tenant_id
  parent_id nullable
  org_type_id
  code nullable
  name
  path ltree
  depth smallint
  sort_order
  created_at
  updated_at
  UNIQUE (tenant_id, id)
```

组织节点的父节点和组织类型均使用复合外键：

```text
(tenant_id, parent_id)
  → org_nodes(tenant_id, id)

(tenant_id, org_type_id)
  → org_types(tenant_id, id)
```

这条约束必须在数据库层阻止“租户 A 节点引用租户 B 父节点”。

P1 默认 seed：

```text
tenant: default / Qualy
org types:
  university
  college
  major
  class

type rules:
  university → college
  college → major
  major → class

nodes:
  Qualy University
    Software College
      Computer Science
        Class 1
```

实际学校层级可以更简化，但必须至少有三层，用于验证 subtree 授权。

### 0.5.2 用户和认证

```text
users
  id uuidv7 PK
  tenant_id
  employee_no nullable
  display_name
  primary_org_node_id
  enabled boolean
  is_system boolean
  created_at
  updated_at
  UNIQUE (tenant_id, id)
  UNIQUE (tenant_id, employee_no) WHERE employee_no IS NOT NULL

auth_providers
  id uuidv7 PK
  tenant_id
  code
  type             # P1 只允许 local
  config jsonb
  enabled
  created_at
  updated_at
  UNIQUE (tenant_id, code)
  UNIQUE (tenant_id, id)

user_identities
  id uuidv7 PK
  tenant_id
  user_id
  auth_provider_id
  identifier
  credential_hash nullable
  bound_at
  last_used_at nullable
  UNIQUE (tenant_id, auth_provider_id, identifier)
  UNIQUE (tenant_id, user_id, auth_provider_id)

sessions
  id uuidv7 PK
  tenant_id
  user_id
  token_hash char(64)
  expires_at
  last_used_at nullable
  login_ip inet nullable
  user_agent text nullable
  created_at
  UNIQUE (token_hash)
```

重要安全规则：

- 密码使用 Argon2id；
- session 原始 token 使用 32 字节随机数；
- 数据库只存 `sha256(rawToken)`；
- Cookie 名称固定，例如 `qualy_session`；
- Cookie 设置 `HttpOnly`、`SameSite=Lax`、`Path=/`；
- production 下设置 `Secure`；
- 登录响应不返回 token；
- 禁止在日志中打印 Cookie、密码和原始 token；
- logout 删除数据库 session 并清 Cookie；
- 用户被禁用后，已有 session 校验失败；
- session TTL 从插件 Config 读取，默认 7 天；
- `last_used_at` 不必每次请求写入，可超过 15 分钟再更新。

P1 只实现本地密码提供者。保留 `auth_providers` 是为了以后增加 CAS，但本阶段不实现：

- CAS ticket 校验；
- SLO；
- PGT；
- provider 管理 UI；
- 同一用户多提供者绑定 UI。

### 0.5.3 RBAC

```text
permissions
  id uuidv7 PK
  code varchar UNIQUE
  plugin varchar
  name varchar
  description nullable
  group_key nullable
  enabled
  created_at
  updated_at

roles
  id uuidv7 PK
  tenant_id
  code
  name
  description nullable
  is_system
  assignable
  enabled
  created_at
  updated_at
  UNIQUE (tenant_id, id)
  UNIQUE (tenant_id, code)
  UNIQUE (tenant_id, name)

role_permissions
  role_id
  permission_id
  created_at
  PK (role_id, permission_id)

user_role_assignments
  id uuidv7 PK
  tenant_id
  user_id
  role_id
  org_node_id
  scope                # self | subtree
  created_at
  created_by nullable
  UNIQUE (tenant_id, user_id, role_id, org_node_id, scope)
```

`user_role_assignments` 对用户、角色和组织节点使用带 `tenant_id` 的复合外键。

权限以稳定 code 为唯一判断依据：

```text
auth.user.read
auth.user.manage
org.tree.read
org.tree.manage
rbac.role.read
rbac.role.manage
rbac.assignment.manage
dict.read
dict.manage
```

不要把 `action` 和 `subject` 作为授权引擎的核心。插件可以提供这些展示元数据，但运行期只比较 permission code。

RBAC 采用纯 allow 模型：

- 多角色权限取并集；
- 没有显式 deny；
- 禁用角色不参与计算；
- 禁用权限不参与计算；
- `TENANT_ADMIN` 系统角色可采用明确的管理员 bypass；
- bypass 只能在一个集中函数中出现；
- 普通业务代码禁止自行判断角色名。

作用域语义：

```text
self
  仅目标节点 id 等于授权节点 id 时生效

subtree
  目标节点 path 等于或位于授权节点 path 之下时生效
```

提供两个不同接口：

```ts
hasPermission(principal, code)
```

用于菜单和页面可见性，只判断用户是否在任意有效 assignment 中拥有该 code。

```ts
canAt(principal, code, targetOrgNodeId)
```

用于业务 API，必须同时满足 permission code 和节点作用域。

禁止用菜单隐藏代替 API 鉴权。

### 0.5.4 数据字典

```text
dicts
  id uuidv7 PK
  tenant_id
  code
  name
  description nullable
  enabled
  created_at
  updated_at
  UNIQUE (tenant_id, code)
  UNIQUE (tenant_id, id)

dict_items
  id uuidv7 PK
  tenant_id
  dict_id
  code
  label
  value jsonb nullable
  sort_order
  enabled
  created_at
  updated_at
  UNIQUE (tenant_id, dict_id, code)
```

P1 字典只支持：

- 按 code 获取；
- 列出字典；
- 管理员 CRUD；
- 排序和启停。

不支持：

- 多语言；
- 层级字典；
- 生效日期；
- 版本历史；
- 导入导出；
- 字典项表达式。

---

## 0.6 请求上下文与鉴权流程

当前 server 的 `ApiContext` 只有 Cordis context。P1 增加最小请求上下文：

```ts
export interface ApiContext {
  cordis: Context
  request: IncomingMessage
  response: ServerResponse
  principal?: AuthPrincipal
}
```

认证插件通过 server 的 effect-managed context enricher 注入 principal：

```ts
interface AuthPrincipal {
  tenantId: string
  userId: string
  sessionId: string
}
```

server 增加的扩展点应满足：

- 支持多个 context enricher；
- 注册和撤销均走 `ctx.effect`；
- 每次请求串行执行；
- enricher 只能扩展当前请求 context；
- 某个 enricher 卸载后立即停止生效；
- 不实现通用 HTTP middleware 框架。

请求流程：

```text
node:http 收到请求
  → server 构造基础 ApiContext
  → auth enricher 解析 Cookie
  → 若 session 有效，写入 principal
  → oRPC handler
  → procedure 调用 rbac.require / canAt
```

未携带 Cookie 不直接报错。公开 procedure 和匿名 manifest 仍需工作。只有 protected procedure 才抛 `AUTH_REQUIRED`。

oRPC beta 期不要假设 middleware 中新增的 errors 会自动进入 contract 类型。所有客户端可见错误必须声明在 contract/base builder 中：

```text
AUTH_REQUIRED
FORBIDDEN
SESSION_EXPIRED
```

具体 API 先按 P0 纪律做导出探针，并写入 `docs/notes/orpc-v2.md`。

---

## 0.7 ui-registry 接入规则

`ui-registry` 保持基础设施插件，不得反向 inject `rbac`。

增加单槽、effect-managed authorizer：

```ts
type PageAuthorizer = (
  principal: AuthPrincipal | undefined,
  permission: string | undefined,
  isPublic: boolean,
) => boolean | Promise<boolean>
```

建议接口：

```ts
ctx.ui.setAuthorizer(authorizer)
```

第二次注册直接抛错：

```text
ui authorizer already registered
```

RBAC 插件负责注册 authorizer。

manifest 过滤规则：

```text
匿名用户：
  只返回 public === true 的页面

已登录用户：
  public 页面始终返回
  permission 为空的非公开页面返回
  permission 有值时调用 rbac.hasPermission

无 authorizer：
  public 页面可见
  所有 permission 页面 fail closed
```

页面声明示例：

```ts
ctx.ui.addPage({
  path: '/admin/org',
  component: 'OrgPage',
  layout: 'admin',
  permission: 'org.tree.read',
  nav: {
    label: '组织架构',
    order: 20,
  },
})
```

登录和退出后，前端必须重新请求 manifest，不允许继续使用旧导航缓存。

---

## 0.8 迁移来源清单

建立 `docs/notes/p1-migration-audit.md`，逐项记录：

| 旧路径                       | 新插件 | 处理       | 备注                  |
| ---------------------------- | ------ | ---------- | --------------------- |
| `db/schema/tenant.ts`        | org    | 迁移并简化 | 不迁租户 CRUD         |
| `db/schema/org-*`            | org    | 迁移       | 改复合 FK             |
| `modules/org/errors.ts`      | org    | 直接适配   | 保留错误语义          |
| `modules/org/repo.ts`        | org    | 迁移       | 去掉全局 db           |
| `modules/org/service.ts`     | org    | 迁移       | 保留移动与规则验证    |
| `db/schema/user.ts`          | auth   | 简化迁移   | 删除 userType         |
| `db/schema/user-identity.ts` | auth   | 迁移并加固 | credential 改 hash    |
| `db/schema/auth-provider.ts` | auth   | 迁移       | P1 只 local           |
| `db/schema/session.ts`       | auth   | 重写       | 只存 token hash       |
| `modules/auth/*`             | auth   | 选择性迁移 | contract/router 重写  |
| `modules/iam/user/*`         | auth   | 部分迁移   | 不迁 user type        |
| `db/schema/role.ts`          | rbac   | 重构       | 删除 permissions 数组 |
| `modules/iam/role/*`         | rbac   | 部分迁移   | 保留节点 scope        |
| Algryth `permissions`        | rbac   | 提炼       | 规范化权限目录        |
| Algryth `role_permissions`   | rbac   | 提炼       | 简化为硬删除          |
| Algryth CASL/Guard           | —      | 不迁       | 直接 permission code  |
| 旧 Web dashboard             | —      | 不迁       | 当前 manifest 壳重做  |

迁移代码时禁止整目录复制后再修。按以下顺序：

1. 搬测试和领域错误；
2. 搬 schema；
3. 搬 repo；
4. 搬 service；
5. 在当前项目重新写 contract/router/index；
6. 通过验收后标记 audit 行为完成。

---

# 会话 1 · 迁移边界、插件骨架与请求上下文

## 目标

四个 P1 插件进入 workspace 和装配清单，server 具备认证所需的最小请求上下文扩展能力，但不实现业务。

## 步骤

1. 创建 `docs/notes/p1-migration-audit.md`，填入 §0.8 表格。
2. 创建四个插件包骨架：
   - `@qualy/plugin-org`
   - `@qualy/plugin-auth`
   - `@qualy/plugin-rbac`
   - `@qualy/plugin-dict`
3. 按当前 ping 插件约定配置：
   - 具名插件导出；
   - `cordis` 放 peerDependencies；
   - `qualy.database.schemaEntry` 指向 `src/db/schema.ts`；
   - `./schema` 与 schemaEntry 指向同一文件；
   - contract 导出名遵守 `<ns>Contract`。
4. 根 `package.json` 加 workspace dependencies。
5. `qualy.yml` 加插件条目；此时插件可以只输出加载日志。
6. server 的 `ApiContext` 增加 request/response。
7. server 增加 context enricher 注册表：
   - `Map` 保存；
   - effect 管理；
   - 重复 key 抛错；
   - 每请求串行执行；
   - HMR 撤销后不残留。
8. 为 context enricher 写一个测试插件：
   - 注入测试字段；
   - 请求可读取；
   - 卸载后字段消失。
9. 新增依赖统一进入 pnpm catalog：
   - `argon2`
   - `cookie`
10. 更新 CLAUDE.md：

- 当前阶段改为 P1；
- 提交格式改为 `p1-s<N>`；
- 增加“租户 ID 不得来自普通 API input”纪律。

## 验收

```bash
pnpm install
pnpm gen
pnpm typecheck
pnpm test
```

额外验证：

- 四插件被 loader 发现；
- schema entry 解析成功；
- 重跑 `pnpm gen` 无非确定性 diff；
- server HMR 后无重复 context enricher；
- 当前 ping API 仍然正常。

## 停止条件

context enricher 超过半天仍无法稳定处理 HMR 时，不建设通用 enricher。退回到 server 直接调用 auth 提供的单槽 principal resolver。

提交：

```text
p1-s1: 建立基座插件骨架与请求上下文
```

---

# 会话 2 · 租户与组织树 Schema

## 目标

建立可信的租户隔离和 `ltree` 组织树数据库模型，并生成第一组 P1 迁移。

## 步骤

1. 从旧项目迁移并适配：
   - tenant；
   - org type；
   - org type rule；
   - org node；
   - ltree custom type。
2. 删除旧 schema 中简单的跨租户 FK，改成复合 FK。
3. 增加所有必要的：
   - `(tenant_id, id)` unique；
   - tenant scoped unique；
   - parent/type 查询索引；
   - `path` GiST 索引。
4. 使用普通 schema migration 创建表。
5. 使用 custom migration：
   - `CREATE EXTENSION ltree`；
   - GiST index；
   - 仅迁移绕过应用写入时必须成立的数据库 invariant。
6. 不迁移通用 `updated_at` trigger，repo 显式更新 `updatedAt`。
7. 对旧项目 trigger 逐条分类：
   - 根节点不可移动或删除：保留候选；
   - 路径和 depth 一致性：由 repo 明确维护，并用测试兜底；
   - 与 service 重复的友好校验：不迁。
8. 创建显式 seed 脚本 `scripts/seed-p1.ts`：
   - upsert default tenant；
   - 创建组织类型和规则；
   - 创建根节点和示例层级。
9. seed 密码尚未加入，本会话只建租户和组织。
10. 所有 seed 数据使用稳定 code 查找，不依赖固定 UUID。

迁移命令以当前 package.json 为准，示例：

```bash
pnpm db:generate --name p1-org-base
pnpm db:generate:custom --name p1-org-ltree
pnpm db:migrate
```

custom migration 必须经过 drop-guard 和人工审查。

## 测试

至少建立两个租户 A/B，并验证：

- A 的节点不能引用 B 的父节点；
- A 的节点不能使用 B 的组织类型；
- 同租户同父节点名称冲突；
- 不同租户可以有相同节点名；
- `path` GiST 索引存在；
- UUID 由 PG18 `uuidv7()` 生成。

## 验收

```bash
pnpm db:reset
pnpm db:migrate
pnpm seed:p1
pnpm typecheck
pnpm test
```

数据库检查：

```sql
SELECT id, slug, name FROM tenants;
SELECT id, tenant_id, name, path, depth FROM org_nodes ORDER BY path;
```

提交：

```text
p1-s2: 迁入租户边界与 ltree 组织模型
```

---

# 会话 3 · 本地认证与 Session

## 目标

完成本地账号登录、Cookie session、当前用户查询和退出，并让每个请求获得可信 principal。

## 步骤

1. 建立 auth schema：
   - users；
   - auth_providers；
   - user_identities；
   - sessions。
2. 所有 user → org node 关系使用租户复合 FK。
3. 建立 local provider seed。
4. 从旧 user service 提炼：
   - Argon2 哈希；
   - identity identifier 校验；
   - 唯一冲突翻译；
   - system user 保护。
5. 不迁 `user_types` 和 capability。
6. 实现：
   - `loginLocal`
   - `validateSession`
   - `logout`
   - `getCurrentUser`
7. session 实现：
   - 生成 raw token；
   - 写入 SHA-256 hash；
   - Cookie 返回 raw token；
   - 查询时 hash Cookie 后查库；
   - session 必须同时验证用户 enabled。
8. auth 插件注册 server principal resolver。
9. contract：
   - `POST /auth/local/login`
   - `POST /auth/logout`
   - `GET /auth/me`
10. `GET /auth/me` 匿名时返回 `AUTH_REQUIRED`。
11. seed 脚本增加管理员：

- 用户名从 `QUALY_ADMIN_USERNAME`；
- 密码从 `QUALY_ADMIN_PASSWORD`；
- 缺少变量时开发环境给清晰错误；
- 密码不得写入 migration、仓库和 STATUS。

12. API client 确保同源 Cookie 正常发送。
13. 增加 public `LoginPage`：

- `layout: blank`
- `public: true`
- 登录成功后重取 `/auth/me` 和 manifest。

## 安全测试

- 密码错误返回统一错误，不泄露用户名是否存在；
- Cookie 无 `HttpOnly` 时测试失败；
- 数据库 token 字段不得等于 Cookie token；
- 过期 session 返回 401；
- 禁用用户后原 session 失效；
- logout 后原 Cookie 不可用；
- 用户不能通过 input 修改 tenant；
- 日志中不出现密码或 Cookie。

## 验收

```bash
curl -i \
  -c /tmp/qualy-cookie \
  -H 'content-type: application/json' \
  -d '{"identifier":"admin","password":"<开发密码>"}' \
  http://localhost:3000/api/auth/local/login

curl -i \
  -b /tmp/qualy-cookie \
  http://localhost:3000/api/auth/me

curl -i \
  -b /tmp/qualy-cookie \
  -X POST \
  http://localhost:3000/api/auth/logout
```

验收结果：

- login 响应含 `Set-Cookie`；
- `/auth/me` 返回用户和 tenant 基本信息；
- logout 后 `/auth/me` 返回 401；
- sessions 表中只有 hash。

提交：

```text
p1-s3: 完成本地认证与哈希会话
```

---

# 会话 4 · RBAC 数据模型与授权服务

## 目标

完成插件化权限目录、租户角色、节点作用域分配和统一授权判断。

## 步骤

1. 建立四张 RBAC 表。
2. 将旧角色中的 `permissions text[]` 删除。
3. 不建立：
   - role-user-type；
   - role-org-type；
   - CASL ability；
   - deny rule。
4. 实现 `Rbac` Cordis Service：

```ts
interface PermissionDefinition {
  code: string;
  name: string;
  description?: string;
  groupKey?: string;
}

definePermissions(plugin: string, definitions: PermissionDefinition[]): Disposable;

getProfile(principal: AuthPrincipal): Promise<AccessProfile>;

hasPermission(
  principal: AuthPrincipal,
  code: string,
): Promise<boolean>;

canAt(
  principal: AuthPrincipal,
  code: string,
  targetOrgNodeId: string,
): Promise<boolean>;

require(
  principal: AuthPrincipal | undefined,
  code: string,
): Promise<void>;

requireAt(
  principal: AuthPrincipal | undefined,
  code: string,
  targetOrgNodeId: string,
): Promise<void>;
```

5. `definePermissions` 必须：
   - effect-managed；
   - code 冲突且定义不一致时抛错；
   - 幂等 upsert DB reference data；
   - 插件卸载时移除内存定义；
   - 不删除数据库权限行；
   - permission code 改名视为新权限。
6. RBAC 插件先声明自身权限：
   - `rbac.role.read`
   - `rbac.role.manage`
   - `rbac.assignment.manage`
7. auth 插件声明：
   - `auth.user.read`
   - `auth.user.manage`
8. org 插件声明：
   - `org.tree.read`
   - `org.tree.manage`
9. dict 插件声明：
   - `dict.read`
   - `dict.manage`
10. seed 角色：
    - `TENANT_ADMIN`
    - `ORG_MANAGER`
    - `STUDENT`
11. `TENANT_ADMIN`：
    - `isSystem=true`
    - `assignable=false`
    - 管理员 bypass；
    - 只允许 seed/bootstrap 创建。
12. 管理员 assignment 挂载在租户根节点，scope=`subtree`。
13. 实现作用域 SQL：
    - 查 assignment node path；
    - `self` 比较 id；
    - `subtree` 使用 ltree descendant 运算；
    - 所有关系同时过滤 tenant。
14. 不做跨请求权限缓存。单请求内允许缓存 profile，避免一个 handler 重复查询。

## 权限矩阵测试

创建以下用户：

```text
admin
  TENANT_ADMIN @ root/subtree

manager
  ORG_MANAGER @ Software College/subtree

student
  STUDENT @ Class 1/self
```

验证：

| 操作                       | admin | manager | student          |
| -------------------------- | ----- | ------- | ---------------- |
| 读全组织树                 | 允许  | 允许    | 按设计允许基础读 |
| 修改 Software College 子树 | 允许  | 允许    | 拒绝             |
| 修改其他 College           | 允许  | 拒绝    | 拒绝             |
| 管理角色                   | 允许  | 拒绝    | 拒绝             |
| 查看自己的 profile         | 允许  | 允许    | 允许             |

还需验证：

- 多角色权限取并集；
- disabled role 不生效；
- disabled permission 不生效；
- self 不扩散到子节点；
- subtree 包含自身；
- 租户 A assignment 不影响租户 B；
- 无 principal 返回 401；
- 有 principal 无权限返回 403。

提交：

```text
p1-s4: 建立节点作用域 RBAC
```

---

# 会话 5 · 组织树领域搬迁

## 目标

把旧 Qualy 中成熟的组织树 errors/repo/service 搬入 `@qualy/plugin-org`，并接入当前 oRPC、Cordis 和 RBAC。

## 步骤

1. 迁移旧组织 errors，保留以下语义：
   - type not found/conflict/in use；
   - rule conflict/invalid/in use；
   - node not found/conflict；
   - root protected；
   - has children；
   - invalid move；
   - rule violation。
2. 迁移 repo：
   - 全部接受 `db`/`tx`；
   - 每个查询必须 tenant scoped；
   - 公开查询只返回 DTO 所需字段；
   - 子树移动必须事务化；
   - 不把 Drizzle row 直接作为 contract。
3. 迁移 service：
   - type CRUD；
   - rule CRUD；
   - root 查询；
   - tree/list/query；
   - node CRUD；
   - move subtree。
4. 保留旧实现中：
   - 自移动检查；
   - 移入自身后代检查；
   - parent/child type rule；
   - 修改类型时校验现有子节点；
   - 根节点不可移动和删除；
   - 非叶子不可删除。
5. router 按当前 oRPC v2 重写。
6. 每条 route 添加权限：
   - 查询：`org.tree.read`
   - mutation：`org.tree.manage`
7. mutation 的 target node：
   - create 使用 parent node；
   - update/delete/move 使用目标 node；
   - type/rule 管理以租户 root 为 target。
8. 添加 `OrgPage`：
   - 展示树；
   - 支持选中和基础编辑；
   - 不做拖拽；
   - 移动操作用简单 parent selector；
   - 不投入设计系统打磨。
9. 页面声明：

```text
path: /admin/org
permission: org.tree.read
```

## 测试

优先复用旧 service 测试场景，不复用旧测试框架代码。

必须覆盖：

- 创建合法节点；
- 非法类型层级；
- 同父同名冲突；
- 根节点保护；
- 移入自身；
- 移入后代；
- 移动后整棵子树 path/depth 更新；
- 修改类型导致子节点不兼容；
- 删除非叶子失败；
- 越权节点修改返回 403；
- 绕过 API 的跨租户 FK 写入失败。

## 验收

使用 manager 用户：

- 可以修改授权子树；
- 修改其他学院返回 403；
- 组织树页面可见；
- student 看不到管理按钮；
- 直接调用 mutation 同样被拒绝。

提交：

```text
p1-s5: 迁入组织树领域与管理页面
```

---

# 会话 6 · 用户、身份和角色管理最小闭环

## 目标

管理员能够创建用户、设置本地身份并分配角色；不追求完整 IAM 后台。

## 步骤

1. 从旧 user service 迁移：
   - 用户查询；
   - 用户创建；
   - 用户更新；
   - 用户启停；
   - identity 创建；
   - 本地密码更新；
   - system user 保护。
2. 删除：
   - user type CRUD；
   - placement compatibility 表；
   - capability；
   - CAS identity 特殊管理。
3. 用户创建必须：
   - tenant 来自 principal；
   - org node 属于同 tenant；
   - employeeNo 在 tenant 内唯一；
   - 初始密码经过 Argon2id。
4. 受保护 API：
   - list/get：`auth.user.read`
   - create/update/password/reset-enable：`auth.user.manage`
5. RBAC 管理 API：
   - list roles；
   - create/update role；
   - set role permissions；
   - list user assignments；
   - sync assignments。
6. 采用“同步最终集合”接口，不要求前端逐条 add/remove：

```text
syncRolePermissions(roleId, permissionIds)
syncUserAssignments(userId, assignments)
```

7. sync 必须在事务内计算差集。
8. 系统角色：
   - code 不可修改；
   - 不可删除；
   - `TENANT_ADMIN` 不可通过普通接口授予；
   - 防止删除最后一个管理员 assignment。
9. 角色删除采用硬删除 + RESTRICT：
   - 有 assignment 时拒绝；
   - 不引入软删除查询条件。
10. 最小页面：
    - `/admin/users`
    - `/admin/roles`
11. 页面只需要：
    - 用户列表和创建表单；
    - 角色列表；
    - 权限 checkbox；
    - 用户 assignment 编辑；
    - 不做拖拽排序、批量导入和高级搜索。

## 验收

管理员通过 UI 或 API：

1. 创建 manager；
2. 创建 student；
3. 给 manager 分配学院 subtree 角色；
4. 给 student 分配 class self 角色；
5. 两个用户分别登录；
6. 权限矩阵与 seed 预期一致。

必须验证：

- 普通管理员无法授予 `TENANT_ADMIN`；
- 最后一个 tenant admin 不可移除；
- 用户禁用后 session 失效；
- 删除有 assignment 的角色失败；
- sync 重复执行结果不变。

提交：

```text
p1-s6: 完成用户与角色管理闭环
```

---

# 会话 7 · Manifest 权限过滤与数据字典

## 目标

前端路由真正由登录状态和 RBAC 决定；增加一个最小 dict 插件验证“业务插件贡献权限”的模式。

## 步骤

1. `ui-registry` 增加 authorizer 单槽。
2. RBAC 插件注册 authorizer。
3. `getManifest` 读取当前请求 principal。
4. 匿名返回：
   - `/login`
   - 其他 public 页面。
5. 管理员返回：
   - org；
   - users；
   - roles；
   - dict。
6. manager 根据权限返回有限菜单。
7. student 不返回后台管理菜单。
8. 登录成功和退出时：
   - 清空旧 manifest；
   - 重新请求；
   - react-router 刷新可访问路由。
9. 实现 dict schema、service、contract/router。
10. dict 插件通过 `ctx.rbac.definePermissions` 声明自己的两个权限。
11. seed 一个示例字典：

```text
code: gender
items:
  male / 男
  female / 女
  unknown / 未知
```

示例只用于证明能力，不作为论文核心数据。12. `DictPage` 做最小列表和编辑。13. 停用 dict 插件后：

- `/api/dict/*` 404；
- manifest 中 dict 页面消失；
- 前端 chunk 不再由开发装配生成；
- permissions 数据库行保留，不执行运行时删除。

## Manifest 验收

匿名：

```bash
curl http://localhost:3000/api/ui/manifest
```

只包含 public 页面。

管理员 Cookie：

```bash
curl -b /tmp/admin-cookie http://localhost:3000/api/ui/manifest
```

包含全部 P1 管理页面。

学生 Cookie：

```bash
curl -b /tmp/student-cookie http://localhost:3000/api/ui/manifest
```

不包含 org/users/roles/dict 管理页面。

再直接调用管理员 API，student 必须得到 403，而不是依赖菜单隐藏。

提交：

```text
p1-s7: 接通权限导航并加入数据字典
```

---

# 会话 8 · 集成验收与收口

## 目标

证明 P1 不只是四个独立 CRUD 插件，而是完整可信的身份与权限基座。

## 8.1 自动化测试层次

### 类型门禁

```bash
pnpm typecheck
```

覆盖：

- contract；
- implementation；
- API client；
- 各插件 client；
- context module augmentation。

### 单元测试

覆盖：

- session token hash；
- Cookie 配置；
- domain error translation；
- permission union；
- self/subtree 作用域；
- last-admin protection。

### PG18 集成测试

必须使用真实 PostgreSQL 18 的场景：

- ltree；
- GiST；
- 复合外键；
- 子树移动；
- custom SQL invariant；
- tenant isolation。

PGlite 只用于其明确支持的普通 repository 测试，不用它替代 PG18 扩展测试。

### HTTP 集成测试

覆盖：

- login/me/logout；
- 401 与 403 区分；
- manifest 用户差异；
- direct API authorization；
- Cookie 生命周期；
- 插件停用后的路由和页面撤销。

## 8.2 最终验收剧本

### 场景 A：匿名访问

1. 启动空 Cookie 浏览器；
2. 打开 `/`；
3. 只出现登录页面；
4. 调用 protected API 返回 401。

### 场景 B：管理员

1. admin 登录；
2. 出现组织、用户、角色、字典导航；
3. 创建学院 manager 和班级 student；
4. 配置角色和作用域；
5. 管理员可修改全树。

### 场景 C：学院管理员

1. manager 登录；
2. 看得到组织管理；
3. 可以修改授权学院及子节点；
4. 修改其他学院返回 403；
5. 看不到角色管理。

### 场景 D：学生

1. student 登录；
2. 不显示管理导航；
3. `/auth/me` 正常；
4. 手工调用管理 API 返回 403。

### 场景 E：租户隔离

自动化创建 tenant B：

1. tenant A 用户不能读取 tenant B 节点；
2. tenant A role 不能绑定 tenant B 用户或节点；
3. input 中伪造 tenantId 被 schema 拒绝或忽略；
4. 修改请求头不能切换 tenant；
5. session tenant 固定。

### 场景 F：插件生命周期

1. 停用 dict：
   - route 404；
   - manifest 消失；
   - 其他插件正常。
2. 停用 rbac：
   - permission 页面 fail closed；
   - protected route 不得降级为放行。
3. 恢复插件：
   - effect 无重复注册；
   - 权限 definitions 幂等恢复。
4. HMR server/auth/rbac：
   - 无重复 context resolver；
   - 无重复 authorizer；
   - 无旧 session pool 或 handler 泄漏。

## 8.3 数据库和迁移检查

```bash
pnpm db:reset
pnpm db:migrate
pnpm seed:p1
pnpm db:generate
git diff --exit-code -- db/migrations
```

要求：

- 从空库可完整重放；
- seed 可重复执行；
- generate 无意外 diff；
- drop-guard 通过；
- 不使用 `DROP ... CASCADE`；
- 没有运行时自动同步 schema；
- 没有重新引入数据层 v3 治理栈。

## 8.4 文档收口

更新：

- `docs/PLAN.md`
  - P1 标记完成；
  - 写明“底层租户边界、单租户产品模式”；
  - RBAC 改为 permission code + node scope。
- `CLAUDE.md`
  - 当前阶段和 P2 指针；
  - principal/tenant/permission 纪律。
- `STATUS.md`
  - 每个 P1 会话完成项；
  - 关键验收输出；
  - 未迁移能力清单。
- `docs/notes/p1-migration-audit.md`
  - 所有条目更新为 migrated/adapted/dropped。
- `docs/notes/auth-security.md`
  - session hash；
  - Cookie；
  - Argon2；
  - tenant derivation。
- `docs/notes/rbac.md`
  - permission code；
  - role union；
  - self/subtree；
  - admin bypass；
  - manifest 与 API 的不同检查方式。

最终提交：

```text
p1-s8: 完成基座迁移与权限闭环验收
```

---

## 9. P1 工程纪律

1. `tenantId` 只能来自配置、session 或服务端查出的关联对象。
2. 普通 contract input 禁止出现可自由填写的 `tenantId`。
3. 每个 tenant-owned repository 查询必须显式 tenant scoped。
4. 跨租户关联优先使用复合外键，不能只依赖 UUID 全局唯一。
5. 菜单隐藏不能替代 API 鉴权。
6. procedure 必须使用 permission code，禁止判断 role name。
7. permission code 发布后视为稳定 API，改语义应创建新 code。
8. 密码、Cookie、原始 session token禁止进入日志。
9. session 数据库只存 hash。
10. P1 不引入 CASL、RLS、Redis 权限缓存和软删除框架。
11. 旧代码只迁移领域价值，不迁移宿主、框架和历史兼容层。
12. 所有 route、context resolver、permission definition、UI page 注册必须走 effect。
13. beta/rc API 继续现场探针，不根据旧项目代码推测。
14. 数据库 custom SQL 继续使用现有手工 custom migration 通道。
15. 任何新增基础设施机制必须先通过数据层 retrospective 的触发表判定。

---

## 10. P1 明确不做事项

以下事项即使开发过程中“顺手”，也不进入 P1：

- CAS；
- OAuth/OIDC/SAML；
- 注册与找回密码；
- MFA；
- 设备和 session 管理页面；
- 用户批量导入；
- 多组织兼职；
- 一个用户多个主组织；
- 属性权限；
- 字段级权限；
- deny rule；
- 动态权限表达式；
- 数据行条件 JSON；
- 跨租户平台管理员；
- 租户管理 UI；
- RLS；
- 权限缓存；
- 审计日志平台；
- 字典国际化；
- 完整设计系统；
- 移动端适配；
- 旧数据库数据导入。

其中任何一项只有在 P2–P4 主业务真实阻塞时才能重新进入计划。

---

## 11. P1 完成定义

以下全部满足才算 P1 完成：

- [ ] 空 PG18 可完整 migrate + seed；
- [ ] 本地登录、me、logout 通过；
- [ ] session 原始 token 不落库；
- [ ] tenantId 不来自业务 input；
- [ ] 两租户隔离测试通过；
- [ ] 组织树创建、移动、删除通过；
- [ ] self/subtree 权限矩阵通过；
- [ ] 管理员、学院管理员、学生获得不同 manifest；
- [ ] 无权限 API 直接调用返回 403；
- [ ] dict 插件声明并使用自己的权限；
- [ ] 插件停用后路由、页面和权限定义 effect 正确撤销；
- [ ] `pnpm typecheck`、`pnpm test` 全绿；
- [ ] migrate 后 generate 零产出；
- [ ] STATUS、PLAN、迁移 audit 和 notes 已更新；
- [ ] 未引入“不做事项”中的范围。

P1 最终产物不是一个完整 IAM 产品，而是一套足以承载综测主业务的可信基础：

```text
可信租户边界
  + 用户与身份
  + Cookie session
  + ltree 组织树
  + 节点作用域 RBAC
  + 服务端 API 鉴权
  + manifest 权限过滤
  + 最小数据字典
```
