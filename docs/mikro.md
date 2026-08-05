## 结论

当前分支已经完成了**运行时层面的 Effect 迁移**：

- 根启动脚本直接运行 `packages/app/src/effect/main.ts`；
- 后端由 Effect Layer、HttpApi、NodeRuntime 组成；
- HTTP server、OpenAPI/Scalar、数据库、插件 Layer 都在同一个组合根中；
- 根依赖已经没有 Cordis 和 oRPC。

但你的“乱套了”的感觉是准确的。现在属于：

> **运行时迁移完成，但迁移后的目录、命名和兼容代码还没有收口。**

不建议推倒重写，也不建议把所有内容强行合成你列出的十几个包。真正应做的是：

1. 删除明确的迁移残留；
2. 消除旧错误模型和新 Effect 错误模型的双轨；
3. 重新按“应用、平台、端口、前端基础设施、插件”分组；
4. 把所有 `effect/` 目录改成稳定的业务命名；
5. 拆分几个已经过大的 `index.ts`。

---

# 一、为什么现在多了这么多包

当前 `packages/` 顶层有：

```text
api-client
api-contract
api-kit
api
app
assembly-contract
assembly
auth-contract
i18n-contract
plugins
rbac-contract
ui-contract
ui
web-i18n
web-runtime
```

这些并非都是插件。它们实际上混合了五种完全不同的东西：

| 类别              | 当前包                                                           |
| ----------------- | ---------------------------------------------------------------- |
| 可部署应用        | `app`、`apps/web`                                                |
| 装配编译器        | `assembly`、`assembly-contract`                                  |
| API 基础设施      | `api`、`api-kit`、`api-client`、`api-contract`                   |
| 跨插件端口/纯模型 | `auth-contract`、`rbac-contract`、`ui-contract`、`i18n-contract` |
| 前端基础设施      | `ui`、`web-runtime`、`web-i18n`                                  |
| 真正的插件        | `plugins/**`                                                     |

问题不主要在数量，而在于这些类别全平铺在 `packages/` 下，名称又不能直接说明依赖方向。

例如：

- `api` 是**生成的全插件 API 聚合体**，它反向依赖所有贡献 API 的插件；
- 插件不能依赖 `api`，否则形成“插件 → 聚合体 → 插件”的环；
- 所以共享 API ID、前缀、Schema 工具必须放在插件可以安全依赖的 `api-kit` 中。
- `auth-contract`、`rbac-contract` 也不是重复实现，而是跨插件调用的端口；把它们合回实现插件会重新产生真实 ESM 环。

因此，有些拆包是必要的；只是现在命名和物理位置没有把这个逻辑展示出来。

---

# 二、哪些包应该保留、删除、移动或重命名

## 应当保留独立

### `api` 与 `api-kit`

不能合并。

- `api-kit`：插件可依赖的 API 内核。
- `api`：从所有活跃插件生成的聚合体。

`api-kit` 中包括：

- `index.ts`：API ID、`/api` 前缀、游标编码、分页常量；
- `schema.ts`：分页 Schema、通用字段 Schema、BadRequest；
- `node.ts`：Node HTTP server service、Connect middleware 适配。

建议仅重命名：

```text
api-kit → api-core
```

`kit` 含义过于宽泛。

### `assembly` 与 `assembly-contract`

也不能简单合并。

`assembly-contract` 是无依赖的 SPI，数据库等 capability provider 通过它实现装配能力，而不需要依赖整个 Assembly 实现。文件中的注释也明确规定 Assembly Core 不应了解数据库、对象存储、搜索索引等具体 capability。

建议重命名：

```text
assembly-contract → assembly-spi
```

比 `contract` 更准确。

### `auth-contract` 与 `rbac-contract`

应保留。

它们保存的是跨插件的 Effect service tags、调用端口和共享错误，而不是 Auth/RBAC 的实现。将其合并回插件会让：

```text
org → auth
auth → org schema
```

或者：

```text
org/auth → rbac
rbac → org/auth schema
```

重新形成值导入环。

建议重命名：

```text
auth-contract → auth-ports
rbac-contract → authorization-ports
```

### `ui-contract` 与 `ui`

不应合并。

- `ui-contract` 是不依赖 React 的页面、布局、surface、visibility、ID 等声明模型；
- `ui` 是 React 组件库和样式。

### `i18n-contract` 与 `web-i18n`

不建议合并。

- `i18n-contract` 是插件和生成器可引用的纯消息类型；
- `web-i18n` 是浏览器侧 formatter、provider、catalog 实现。

---

## 应当删除或重写

### 1. 删除误嵌套的旧文件

当前存在：

```text
packages/api-client/packages/web-i18n/src/format.ts
```

这是明确的迁移残留。它仍然只识别 `ORPCError`，而真正的 `packages/web-i18n/src/format.ts` 已经支持 Effect `_tag` 错误。

这个目录不属于 pnpm workspace 中的独立包，也不属于 `api-client` 的职责，应整个删除：

```text
packages/api-client/packages/
```

### 2. 重写后删除 `api-contract`

这是当前最主要的架构残留。

`api-contract` 仍然定义：

- Zod `ErrorDefinition`；
- `DomainError`；
- `defineDomainErrors()`；
- throw-based 领域错误工厂；
- `AccessDeniedError`。

与此同时，每个插件又定义了一套 Effect `Schema.TaggedErrorClass`。例如 Auth 同时存在：

```text
src/iam/errors.ts       // Zod + defineDomainErrors
src/effect/errors.ts    // Effect TaggedErrorClass
```

因此现在每个错误至少有两份定义：

```text
错误码
HTTP status
payload shape
开发者消息
Effect error class
旧 DomainError definition
```

仓库还需要 `effect-api-parity`、`effect-error-shape` 等门禁来保证两套定义没有漂移。

正确收口方式是：

1. Effect TaggedError/Schema 成为唯一错误结构来源；
2. 本地化只保留“错误码 → MessageDescriptor”的映射；
3. 删除各插件旧的 `errors.ts` / `iam/errors.ts`；
4. 删除 `defineDomainErrors`、`DomainError` 和相关 parity 测试；
5. 最终删除 `@qualy/api-contract`。

仍然需要的纯前端错误类型辅助，可以移到：

```text
i18n-contract
或
api-client
```

### 3. 删除或暂停 `plugin-dict`

当前 `dict` 插件只有一个空的 `src/db/schema.ts`：

```ts
export {}
```

它现在没有 runtime、API、UI、表或业务实现。保留一个空插件只会增加装配项和认知负担。

建议：

- 近期没有字典业务：删除包和清单项；
- 确定马上实现：移到 `plugins/experimental/dict`，不要作为正式基础插件装配。

---

## 应当移动

### `packages/app` → `apps/server`

`app` 是部署入口，不是可复用库。它拥有：

- `qualy.yml`；
- `qualy.lock.json`；
- Node HTTP server；
- Effect 根 Layer；
- 健康探针；
- Scalar/OpenAPI；
- 各种生成文件；
- assembly 验证。

它和 `apps/web` 是同级的两个组合根，最自然的结构是：

```text
apps/
  server/
  web/
```

包名可以暂时保持 `@qualy/app`，物理路径先移动即可。

---

## 应当重命名目录

现在绝大多数后端插件仍有：

```text
src/effect/
```

迁移期间它表示“新 Effect 实现，与旧 Cordis 实现并存”。现在 Cordis 已删除，`effect` 已经不再是有意义的业务层名称。

统一改为：

```text
src/server/
```

或者：

```text
src/runtime/
```

我更推荐 `server/`：

```text
api.ts             HTTP 声明
server/            服务、handler、Layer
db/                schema
client/            浏览器实现
ui.ts              UI contribution 声明
permissions.ts     权限目录
messages.ts        消息声明
```

---

# 三、推荐的目标目录

建议先只调整物理目录和名称，不同时大改业务实现：

```text
apps/
  server/                         # 当前 packages/app
  web/                            # 当前 apps/web

packages/
  platform/
    api/                          # 生成的 HttpApi 聚合体
    api-core/                     # 当前 api-kit
    api-client/
    assembly/
    assembly-spi/                 # 当前 assembly-contract

  ports/
    auth/                         # 当前 auth-contract
    authorization/                # 当前 rbac-contract

  models/
    ui/                           # 当前 ui-contract
    i18n/                         # 当前 i18n-contract

  frontend/
    ui/                           # React 组件库
    runtime/                      # 当前 web-runtime
    i18n/                         # 当前 web-i18n

  plugins/
    base/
      auth/
      auth-local/
      layout-default/
      org/
      rbac/
    infra/
      database/
      ui-registry/
      web/
    demo/
      ping/
```

npm 包名不必立即跟着路径一起改，可以分两次完成，避免一次性产生大量无意义 import diff。

---

# 四、当前每个顶层包的职责与文件

以下覆盖生产源码；`tests/` 统一表示该包的单元、集成或架构门禁，不逐个复述断言。

## `app`

建议迁到 `apps/server`。

```text
qualy.yml
```

人工维护的产品插件清单。

```text
qualy.lock.json
```

Assembly 解析后的审核产物。

```text
runtime.gen.ts
```

根据活跃插件生成的 Effect Layer 组合。

```text
api-handlers.gen.ts
routes.gen.ts
permissions.gen.ts
ui.gen.ts 等
```

各类静态聚合产物。

```text
src/effect/config.ts
```

环境变量、数据库配置、权限目录、登录驱动、UI catalog、Web 配置等宿主输入 Layer。

```text
src/effect/health.ts
```

`/health/live` 与 `/health/ready`。

```text
src/effect/runtime.ts
```

整个后端组合根：HttpApi、Scalar、Node server、pluginLayers、原始 Web routes。

```text
src/effect/main.ts
```

执行 assembly 验证并通过 `NodeRuntime.runMain` 启动。

```text
src/verify-assembly.ts
```

验证 manifest、lock 和生成文件对应同一份 assembly。

`server` 和 `api-reference` 不再作为插件包存在，是合理的：HTTP listener 和 API 文档现在都是宿主职责。`runtime.ts` 中已经直接构造 Node server，并按配置挂载 Scalar。

## `api`

```text
src/index.ts
```

重新导出 `api.gen.ts`。

```text
src/api.gen.ts
```

生成的全插件 HttpApi aggregate。

该包必须保持“只含 API 定义，不含 handler、数据库和 Node 代码”。

## `api-kit`，建议改名 `api-core`

```text
src/index.ts
```

API ID、API prefix、分页常量、cursor 编解码。

```text
src/schema.ts
```

分页、字段约束、通用 BadRequest 等 Effect Schema。

```text
src/node.ts
```

Node server service 与 Connect middleware 桥接。

不应合并进 `api`，否则插件依赖聚合体会形成反向环。

## `api-client`

```text
src/effect/index.ts
```

从 `@qualy/api` 创建类型化 HttpApiClient。

```text
src/effect/query.ts
```

Effect 请求到 TanStack Query 的适配，负责保留错误类型和处理取消。

```text
packages/web-i18n/...
```

误复制的旧 oRPC 文件，删除。

可以把 `src/effect/` 直接改成：

```text
src/client.ts
src/query.ts
```

## `api-contract`

现在主要是旧错误 DSL。建议完成单一错误来源重构后删除。

## `assembly`

文件职责比较清晰，不需要重写：

```text
manifest.ts       解析和验证 qualy.yml
metadata.ts       读取插件 package.json 中的 qualy metadata
registry.ts       发现 capability provider 和插件包
resolve.ts        解析 active/disabled/detached 插件
graph.ts          拓扑排序与环检测
lock.ts           lock 生成、读取、漂移检查、原子写入
runtime-plan.ts   生成 runtime.gen.ts
work.ts           plan/generate/deploy capability 调度
hash.ts           稳定 hash 和短 ID
index.ts          公共导出
testkit.ts        临时 assembly 测试工作区
```

## `assembly-contract`

只有 `src/index.ts`，定义：

- capability provider 接口；
- resolve/generate/deploy 上下文；
- contribution；
- capability state；
- retention；
- provider metadata。

建议改名 `assembly-spi`，不要合并。

## `auth-contract`

```text
src/index.ts
```

Org 等插件调用 Auth 的 Placement 端口。

```text
src/login.ts
```

登录驱动、登录尝试和结果等跨 Auth/Auth-local 边界。

建议改名 `auth-ports`。

## `rbac-contract`

```text
index.ts
```

Principal、permission、grant、profile 等共享类型。

```text
effect.ts
```

Rbac Effect service tag 和方法接口。

```text
errors.ts
```

Auth/RBAC 共同使用的错误，例如最后管理员不变量。

```text
scope.ts
```

租户级、节点级、自身和子树覆盖模型。

```text
canonical.ts
```

规范化的系统权限、角色或授权常量。

```text
system-actor.ts
```

显式可信系统调用身份。

```text
testkit.ts
```

测试 principal 和辅助方法。

应保留，建议改名 `authorization-ports`。

## `ui-contract`

```text
declarations.ts   插件 UI contribution 结构
ids.ts            稳定页面/layout/surface ID
pages.ts          页面与导航声明
surfaces.ts       slot/surface 模型
visibility.ts     UiAuthorizer 与可见性规则
index.ts          统一导出
```

它是纯模型，不能和 React 组件包 `ui` 合并。

## `i18n-contract`

只有一个较大的 `src/index.ts`，保存：

- MessageDescriptor；
- MessageValues；
- catalog 类型；
- 错误消息映射；
- 从 descriptor 推导 placeholder 类型的工具。

可以内部拆成 `messages.ts`、`catalog.ts`、`errors.ts`，但没有必要拆成更多 package。

## `ui`

共享 React 设计系统：

```text
components/*.tsx
```

Button、Alert、Card、Input、Label、Spinner、管理后台表单组件等。

```text
lib/cn.ts
```

className 合并。

```text
styles/theme.css
```

主题变量和基础样式。

## `web-runtime`

浏览器插件运行平台：

```text
index.tsx
```

RuntimeProvider、API client、QueryClient、manifest 生命周期和 hooks。

```text
pages.ts
```

页面注册与访问逻辑。

```text
route-builder.tsx
```

从授权后的 manifest 构建 React Router 路由树。

```text
links.tsx
```

页面引用到 React Router Link 的桥接。

```text
component-boundary.tsx
```

懒加载、插件组件错误和 loading boundary。

包本身应保留，但 `index.tsx` 已承担过多职责，建议拆成：

```text
provider.tsx
api-runtime.ts
manifest.ts
hooks.ts
index.ts
```

## `web-i18n`

```text
index.tsx
```

I18nProvider 和 React hooks。

```text
format.ts
```

API 错误和普通消息格式化。

```text
messages.ts
```

公共界面消息声明。

```text
catalogs/zh-CN.ts
```

公共中文 catalog。

当前 `format.ts` 仍保留 `ORPCError` 兼容分支；既然 oRPC 已完全删除，这一分支也应在收口阶段删除。

---

# 五、每个插件及其文件

## `plugin-database`

这是最完整、边界也最合理的基础设施插件，不建议合并。

```text
src/assembly/baseline.ts
```

插件自带 baseline SQL 片段。

```text
src/assembly/contribution.ts
```

解析各插件声明的数据库 contribution。

```text
src/assembly/drizzle.ts
```

生成 Drizzle schema/config 和数据库 capability 工作。

```text
src/assembly/drop-guard.ts
```

危险 DROP 操作审查。

```text
src/assembly/generate.ts
```

生成 migration lineage。

```text
src/assembly/schema.ts
```

聚合插件 schema。

```text
src/assembly/state.ts
```

数据库 capability 写入 lock 的状态。

```text
src/assembly/index.ts
```

导出数据库 capability provider。

```text
src/effect/index.ts
```

Database tag、PgClient、Drizzle、迁移准备和资源 Layer。

```text
src/effect/constraints.ts
```

Effect SQL 错误到约束错误的翻译。

```text
src/migrator.ts
```

执行已提交 migration lineage。

```text
src/pg-errors.ts
```

提取原始 PostgreSQL SQLSTATE 和 constraint。

```text
src/testkit.ts
```

真实 PostgreSQL 测试生命周期。

仅建议把 `effect/` 改成 `runtime/`。

## `plugin-ui-registry`

```text
src/api.ts
```

`/app/manifest` 的 HttpApi 声明。

```text
src/effect/manifest.ts
```

把静态 UI catalog、当前 principal 和授权结果投影成客户端 manifest。

```text
src/effect/authorizer.ts
```

UiAuthorizer 实现。

```text
src/effect/index.ts
```

Layer 与 API handlers 接线。

结构合理，把 `effect/` 改为 `server/` 即可。

## `plugin-web`

```text
src/effect/index.ts
```

开发环境接 Vite middleware 和 HMR websocket；生产环境服务已构建静态文件；为 Node Router 提供 wildcard handler。

它独立成插件是合理的，因为有些 headless assembly 可以不带前端。目录可改为 `src/server/index.ts`。

## `plugin-auth`

后端：

```text
src/api.ts                     Auth/IAM HttpApi endpoint 定义
src/constants.ts               系统用户类型、恢复账号等常量

src/db/schema.ts               Schema 聚合出口
src/db/relations.ts            Drizzle relations
src/db/tables/*.ts             provider/session/user/identity/user-type 等表

src/effect/auth-config.ts      Auth 配置 service
src/effect/session-contract.ts session 内部端口
src/effect/session.ts          会话创建、读取、失效
src/effect/sign-in.ts          登录驱动编排
src/effect/user-types.ts       用户类型用例
src/effect/users.ts            用户用例
src/effect/errors.ts           Effect tagged errors
src/effect/index.ts            Layer、service、handler 接线

src/iam/queries.ts             IAM 数据访问
src/iam/errors.ts              旧错误 DSL，待删
src/iam/messages.ts            IAM 消息声明

src/session.ts                 公共 session DTO/类型
src/permissions.ts             权限目录
src/ui.ts                      UI contribution 声明
```

前端 `client/`：

```text
LoginPage.tsx
UserMenu.tsx
iam/NewUserForm.tsx
iam/NewUserTypeForm.tsx
iam/UserDetailPage.tsx
iam/UserGrants.tsx
iam/UserTypeEditor.tsx
iam/UserTypesPage.tsx
iam/UsersPage.tsx
i18n.ts
locales/zh-CN.ts
index.ts
```

主要问题不是包太多，而是：

- `effect/index.ts` 过大；
- `iam/queries.ts` 也很大；
- 新旧错误定义并存。

建议改为：

```text
server/
  layer.ts
  handlers/
  session/
  sign-in/
  users/
  user-types/
  repo/
  errors.ts
```

## `plugin-auth-local`

```text
src/api.ts             本地密码登录 endpoint
src/effect/index.ts    provider Layer 和 handler
src/login-driver.ts    对 auth login port 的实现
src/password.ts        Argon2 hash/verify
src/errors.ts          登录错误定义
client/                本地登录 UI
```

应继续独立。它是一个可替换认证 provider，不应并入 Auth Core。

## `plugin-layout-default`

它仍然存在，只是位于 `plugins/base`：

```text
src/ui.ts
```

声明默认 layout contribution。

```text
client/AdminShell.tsx
client/BlankShell.tsx
client/index.ts
```

实现默认管理后台壳和空白壳。

这个包很小，但边界合理：替换布局不应修改 Web 组合根。

## `plugin-org`

```text
src/api.ts                 Org HttpApi 定义
src/coverage.ts            节点、自身、子树权限覆盖计算

src/db/code-pattern.ts     组织编码约束
src/db/ltree.ts            ltree 类型
src/db/schema.ts           schema 聚合
src/db/tables/*.ts         tenant、org type、rule、node 表

src/queries.ts             数据访问
src/effect/errors.ts       Effect tagged errors
src/effect/session-port.ts 跨 Auth session 端口
src/effect/index.ts        Org service、事务和 handlers

src/errors.ts              旧错误 DSL，待删
src/messages.ts            消息声明
src/permissions.ts         权限目录
src/ui.ts                  UI contribution
```

前端：

```text
client/OrgPage.tsx
client/i18n.ts
client/locales/zh-CN.ts
client/index.ts
```

`effect/index.ts` 已超过 36 KB，应该按 `tree`、`types`、`rules`、`handlers`、`layer` 拆分。

## `plugin-rbac`

```text
src/api.ts                   IAM/RBAC HttpApi 定义
src/db/schema.ts
src/db/tables/*.ts           permission、role、grant、eligibility 等表

src/effect/diagnostics.ts    授权诊断
src/effect/escalation.ts     权限升级防护
src/effect/grants.ts         Grant 用例
src/effect/roles.ts          Role 用例
src/effect/errors.ts         Effect tagged errors
src/effect/index.ts          Rbac service、Layer、handlers

src/queries.ts               数据访问
src/errors.ts                旧错误 DSL，待删
src/messages.ts              消息声明
src/permissions.ts           RBAC 自身权限目录
src/ui.ts                    UI contribution
```

前端：

```text
client/NewRoleForm.tsx
client/RoleEditor.tsx
client/RolesPage.tsx
client/i18n.ts
client/locales/zh-CN.ts
client/index.ts
```

同样应拆 `effect/index.ts`，但不应与 `rbac-contract` 合并。

## `plugin-dict`

空占位，建议删除或移到 experimental。

## `plugin-ping`

完整的示例插件：

```text
src/api.ts           示例 endpoint
src/db/schema.ts     ping log 表
src/effect/index.ts  handler 与 Layer
src/messages.ts      消息声明
src/ui.ts            示例页面 contribution
client/              Ping 页面
```

作为插件开发模板很有价值，但生产 assembly 可以 disable。也可以改名为：

```text
plugins/examples/ping
```

比 `demo` 更明确。

---

# 六、`apps/web`

这是浏览器组合根，不应合并进 `plugin-web`：

- `plugin-web` 负责**怎么交付前端资源**；
- `apps/web` 负责**构建哪个前端应用**。

文件：

```text
index.html       Vite HTML 入口
vite.config.ts   构建配置
tsconfig.json
package.json

src/main.tsx     React mount
src/App.tsx      Provider、Router 和宿主级错误/空状态
src/app.css      应用样式

scripts/         chunk/构建检查
tests/           浏览器组合根测试
```

`App.tsx` 本身不拥有具体页面和布局；页面、layout 和导航来自生成的插件 manifest，因此它作为薄组合根的方向是正确的。

---

# 七、最终裁决

## 直接删除

```text
packages/api-client/packages/
packages/plugins/base/dict/       # 暂无业务时
```

## 重写后删除

```text
packages/api-contract/
各插件旧的 errors.ts / iam/errors.ts
Effect 与旧 error DSL 的 parity gates
web-i18n 中 ORPCError fallback
```

## 移动

```text
packages/app → apps/server
```

## 重命名

```text
api-kit            → api-core
assembly-contract  → assembly-spi
auth-contract      → auth-ports
rbac-contract      → authorization-ports

所有 src/effect/   → src/server/ 或 src/runtime/
```

## 保持独立，不要合并

```text
api / api-core / api-client
assembly / assembly-spi
auth / auth-ports
rbac / authorization-ports
ui / ui-contract
web-runtime / web-i18n
app(server) / plugin-web / apps/web
```

## 拆文件但不拆包

```text
plugin-auth/src/effect/index.ts
plugin-org/src/effect/index.ts
plugin-rbac/src/effect/index.ts
web-runtime/src/index.tsx
apps/web/src/App.tsx
```

整体上，当前架构不是设计失败。大约 **70% 的额外包是为静态装配、浏览器/服务端隔离和解除 ESM 环而合理产生的**；真正多余的是旧错误体系、一个空插件、误嵌套目录以及迁移期命名。完成上述收口后，目录会清楚很多，而不需要牺牲已经建立起来的插件边界。

我发现本项目现在的Drizzle几乎用的全都是sql``查询。Drizzle的SQL查询是语法不严格的，类型也要靠自己制定，也就是说除了Drizzle-Kit提供的迁移工具以外，几乎是没有享受到Drizzle提供的任何好处。我在考虑要不要切换到MikroORM+Kysely的组合，对于Kysely来说SQL语句是语法严格的，不会允许出现语法不严格的情况，而且MikroORM可以直接创建Kysely兼容层，且v7提供了诸多新功能，你可以在现在的场景下考虑一下。对于Effect适配，MikroORM 的 transactional() 会在回调成功完成后 flush 并提交；回调抛异常或返回 rejected Promise 时则回滚，而 Effect.runPromise() 在 Effect 失败时会返回 rejected Promise，因此两者的语义正好匹配。所以你帮我认真细细考虑下。

## 结论

**切换到 MikroORM v7.1 + Kysely 在 Qualy 当前阶段是有充分理由的，而且长期架构大概率优于现在的 Drizzle 用法。**

但应当把目标定义成：

> **MikroORM 负责实体元数据、Schema、迁移、连接与事务；Kysely 作为默认业务查询层；MikroORM 的 Unit of Work 只在适合的场景选择性使用。**

而不是把 MikroORM 和 Kysely 当作两套并列的数据访问框架，也不应长期保留：

```text
Drizzle Schema + MikroORM Entity + Kysely Database 类型
```

三套数据库模型。

我不建议立即无条件全量重写。先用最困难的 `org + rbac + auth` 跨插件事务路径完成一个纵向验证；只要该验证通过，就应趁目前业务插件仍少，完成整套切换。继续扩展业务后再换，成本会快速上升。

---

# 一、你对当前 Drizzle 使用情况的判断基本正确

当前查询代码并不是偶尔使用 `sql`` ` 补充 Drizzle，而是把它作为主要查询 DSL。

例如 `org/src/queries.ts` 中，表名、列名、JOIN、返回列、类型转换几乎全部是字符串：

```ts
export const nodeQuery = (tenantId: string, nodeId: string): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId} and id = ${nodeId}`
```

其中还包括：

- 递归 CTE；
- `ltree` 的 `<@`；
- `string_to_array(... )::uuid[]`；
- 手写 INSERT/UPDATE/DELETE；
- 手写列清单；
- 手写别名；
- 手写 CASE；
- 手写 `RETURNING`。

RBAC 查询层也是相同结构，连最关键的授权判定都依赖完整裸 SQL：

```ts
select exists (
  select 1
  from (...)
  join roles ...
  where ...
)
```

更严重的是，查询结果通过这一类函数人工断言：

```ts
const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows
```

然后再定义一份手工的 `NodeRow`、`TypeRow`、`RuleRow`。

这意味着 TypeScript 不会发现：

- 列名拼错；
- 表名拼错；
- JOIN 后引用了不存在的别名；
- 查询删除了一个返回列；
- SQL 返回 nullable，但接口声明 non-null；
- PostgreSQL 实际返回 `string`，接口声明 `number`；
- SQL alias 与 Row 接口字段不一致。

Drizzle 官方也明确说明，`sql<T>` 的泛型只是告诉 TypeScript“相信这个类型”，不会做运行时映射或验证；写错泛型时，运行值不会与声明类型匹配。

因此，从**查询类型安全**来看，你的判断成立：

> 目前 Drizzle 在 Qualy 中主要承担 Schema 描述、Drizzle-Kit 迁移、SQL 参数化和 Effect 数据库连接；它的类型化查询能力基本没有被利用。

不过也不能说完全没有获得 Drizzle 的价值。当前仍然用到了：

- 类型化 Schema 和约束声明；
- Drizzle-Kit 聚合迁移；
- SQL 参数绑定和转义；
- Effect 原生数据库 Layer；
- Effect 原生事务上下文；
- 自定义类型、索引、部分索引和约束；
- Schema 到迁移的 diff。

当前 `org_nodes` 中的复合外键、部分唯一索引、GiST、check、`uuidv7()` 默认值等，都是由 Drizzle Schema 表达的。

所以问题并非“Drizzle 毫无价值”，而是：

> **当前运行时查询模型与 Drizzle 的优势错位了。**

---

# 二、Kysely 确实更符合这些查询

Kysely 的主要价值不是“比 SQL 简单”，而是它尽量保持 SQL 的结构，同时把当前查询上下文编码进 TypeScript：

- 当前可见的表；
- 当前 JOIN 后可见的别名；
- 可引用的列；
- WHERE 左右操作数类型；
- SELECT 后的结果字段；
- alias；
- 子查询、CTE、相关子查询的可见范围。

Kysely 官方明确说明，它只允许引用查询当前位置可见的表和列，并能从 SELECT、JOIN、子查询、CTE、alias 中推导结果类型。

例如当前的简单查询：

```sql
select id, code, name, sort_order
from org_types
where tenant_id = $1
order by sort_order, name
```

可以变成：

```ts
const rows = await db
  .selectFrom('orgTypes')
  .select(['id', 'code', 'name', 'sortOrder'])
  .where('tenantId', '=', tenantId)
  .orderBy('sortOrder')
  .orderBy('name')
  .execute()
```

其结果类型由 SELECT 自动推导，不再需要手写 `TypeRow` 和 `rows<TypeRow>()`。

但“语法严格”需要稍作限定。

Kysely 能保证的是：

- Builder 调用组成合法的查询结构；
- 表和列在类型层存在；
- 引用范围基本正确；
- 操作数类型大体兼容；
- 返回类型可推导。

它不能保证所有数据库语义都正确。例如：

- 自定义 PostgreSQL 操作符；
- `ltree <@`；
- `subpath()`；
- 自定义函数；
- 特定 cast；
- 原始 trigger/function DDL；
- `sql`` ` escape hatch 内部的内容。

Kysely 自己也明确提供 raw SQL escape hatch。

不过它与当前情况的区别很大。当前是：

```text
整个查询都是 raw SQL
```

切换后可以变成：

```text
查询骨架、表、列、JOIN、结果均类型化
只有 ltree 操作符或特殊函数是局部 raw expression
```

这是实质性提升。

---

# 三、MikroORM v7 + Kysely 不是生硬拼接

MikroORM v7 已经用 Kysely 取代 Knex 作为 SQL 基础设施，并通过 `EntityManager.getKysely()` 提供一等集成。`defineEntity` 定义的实体可以直接驱动 Kysely 的表名、列名、nullability 和类型推导。

例如：

```ts
const OrgNode = defineEntity({
  name: 'OrgNode',
  tableName: 'org_nodes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    name: p.string(),
    path: p.type(LtreeType),
  },
})
```

之后：

```ts
const db = em.getKysely({
  tableNamingStrategy: 'entity',
  columnNamingStrategy: 'property',
  convertValues: true,
})
```

即可使用实体名和属性名构造 Kysely 查询，MikroORM 会在编译查询时转换为真实表名、snake_case 列名并执行自定义类型转换。

这比以下组合更一致：

```text
Drizzle Schema
+
手写 Kysely Database interface
+
Kysely 查询
```

因为后一种方案仍然存在两份 Schema 事实源。

MikroORM v7.1 对 Qualy 还有若干直接相关能力：

- `defineEntity` 全类型推导；
- 类型化 Kysely；
- 事务传播；
- 乐观锁和悲观锁；
- `AbortSignal` 查询取消；
- PostgreSQL 高级索引；
- check constraint；
- 数据库 trigger；
- custom type；
- migration snapshot。

尤其 v7.1 已支持在实体定义中声明数据库 trigger，由迁移系统创建、修改和删除。Qualy 原有 baseline SQL 中的一部分 trigger 可以因此回到 Schema 元数据中；不过 `CREATE EXTENSION ltree`、特殊 function 和其他非实体对象仍需保留自定义 SQL 通道。

---

# 四、它与插件化 Assembly 是可以兼容的

## 1. 每个插件继续拥有自己的实体

当前插件声明：

```json
{
  "qualy": {
    "contributions": {
      "database": {
        "schemaEntry": "src/db/schema.ts",
        "dependsOn": [...]
      }
    }
  }
}
```

可以调整为：

```json
{
  "qualy": {
    "contributions": {
      "database": {
        "entitiesEntry": "src/db/entities.ts",
        "baselineDir": "db/baseline",
        "dependsOn": [...]
      }
    }
  }
}
```

每个插件导出：

```ts
export const orgEntities = [Tenant, OrgType, OrgTypeRule, OrgNode] as const
```

Assembly Core 根据 lock 生成：

```ts
import { orgEntities } from '@qualy/plugin-org/entities'
import { authEntities } from '@qualy/plugin-auth/entities'
import { rbacEntities } from '@qualy/plugin-rbac/entities'

export const entities = [...orgEntities, ...authEntities, ...rbacEntities] as const

export type DatabaseEntities = typeof entities
```

这与 MikroORM v7.1 官方增加的 `discovery:export` 思路一致：生成一个 `entities = [...] as const` 的静态 tuple，使 `EntityManager` 和 `getKysely()` 保留完整实体类型。

Qualy 不应直接采用目录扫描，而应继续使用现有 Assembly lock 来生成这个文件。原因是 Assembly 才知道：

- 哪些插件 active；
- 哪些 disabled；
- 哪些 detached 仍需保留数据库对象；
- 数据库依赖顺序；
- 哪些实体必须进入迁移视野。

## 2. `disabled` 和 `detached` 语义必须继续由 Qualy 管理

MikroORM 的 Migration/Schema Generator 不理解：

```text
插件未运行 ≠ 删除插件表
```

它只看到“本次实体元数据中有没有这张表”。

所以生成实体集合时必须继续使用数据库 capability 的 retained order，而不能只聚合 active 插件。当前 baseline 逻辑已经明确规定 disabled 和 detached 插件继续贡献数据库对象。

应保持：

```text
runtime entities     = active 插件
database entities    = active + disabled + detached 数据库插件
```

否则任何 ORM 都会重新引入“禁用插件导致 DROP”的问题。

## 3. 插件编译时的 Kysely 类型需要单独设计

这里是 MikroORM 自动类型推导与插件架构之间最容易踩坑的地方。

宿主生成的全库 `EntityManager` 能获得完整 Kysely 类型，但业务插件不能反向依赖宿主的：

```text
apps/server/entities.gen.ts
```

否则形成：

```text
plugin → host aggregate → plugin
```

因此每个插件的查询层应该使用其**数据库依赖闭包的本地类型视图**。

例如 Org 查询需要：

```ts
export const orgQueryEntities = [...orgEntities, ...orgDatabaseDependencies] as const
```

或者由 Assembly/codegen 验证并生成插件局部的 `OrgDatabase` 类型。

运行时仍然拿同一个 `EntityManager.getKysely()`，但在插件边界将其缩窄为该插件声明可见的表集合。这里允许存在一个经过 Assembly 验证的集中 cast，但不允许每个查询自行 `as`。

也就是说，必须避免：

```ts
const db = em.getKysely() as Kysely<any>
```

否则换成 Kysely也只是把 `sql`` ` 的不安全换成 `any`。

---

# 五、关于 Effect 与 `transactional()`：方向正确，但直接写法还不够

你提出的基本推理成立：

```ts
await em.transactional(async (em) => {
  return Effect.runPromise(program)
})
```

- Effect 成功：Promise resolve；
- Effect 失败：Promise reject；
- MikroORM 看到回调 reject：回滚；
- 成功完成后 MikroORM flush 并 commit。

Effect 官方也确认，`runPromise` 在 Effect 失败时返回 rejected Promise。

MikroORM 的 `em.transactional()` 会在成功回调后 flush 内部 EntityManager 并提交；异常则回滚。Kysely 从事务内的 `EntityManager` 获取时，也自动绑定当前事务连接。

但生产级适配层还必须解决以下问题。

## 1. `runPromise` 不会直接 reject 原始 `E`

假设：

```ts
Effect.fail(new NodeNotFound())
```

`Effect.runPromise()` reject 的通常是包含 Cause 的 `FiberFailure`，不是可以直接：

```ts
catch (error) {
  if (error instanceof NodeNotFound) ...
}
```

的原始错误。

如果事务适配器简单使用：

```ts
Effect.tryPromise(() => em.transactional(() => Effect.runPromise(effect)))
```

就会把原来的：

```ts
Effect<A, NodeNotFound | AccessDenied>
```

压平为某个未知 Promise 异常，丢失 Effect 的错误通道。

更稳健的模式是：

1. 用 `runPromiseExit` 执行内部 Effect；
2. Success 时返回值；
3. Failure 时抛出一个只用于触发回滚的内部 sentinel；
4. `transactional()` 回滚后，在外部重新用 `Effect.failCause()` 恢复原 Cause。

概念上：

```ts
class RollbackCause extends Error {
  constructor(readonly cause: Cause.Cause<unknown>) {
    super('transaction effect failed')
  }
}

const exit = await Runtime.runPromiseExit(runtime)(program, { signal })

if (Exit.isFailure(exit)) {
  throw new RollbackCause(exit.cause)
}

return exit.value
```

事务外：

```ts
error instanceof RollbackCause
  ? Effect.failCause(error.cause)
  : Effect.fail(mapDatabaseFailure(error))
```

这样才能同时保留：

- 类型化业务失败；
- defect；
- interruption；
- rollback 语义。

## 2. 必须传播 Effect interruption

若外层 Fiber 被中断，而内部 `Effect.runPromise()` 没收到 AbortSignal，可能出现：

```text
HTTP 请求已经取消
外层 Effect 已结束
事务里的 Effect 仍在运行
最后甚至可能提交
```

MikroORM v7.1 的 `transactional()`、EntityManager 和 QueryBuilder 都支持 `AbortSignal`；PostgreSQL 还可以配置主动取消查询。

适配器应把同一个 signal 同时传给：

```ts
em.transactional(callback, {
  signal,
  inflightQueryAbortStrategy: 'cancel query',
})
```

和：

```ts
Runtime.runPromiseExit(runtime)(program, { signal })
```

这样外层 Effect interruption 才会沿完整路径传播。

## 3. 默认事务传播语义并不相同

MikroORM v7 中：

- `em.transactional()` 默认传播是 `NESTED`；
- 内层 transaction 会创建 savepoint；
- `@Transactional()` 默认是 `REQUIRED`。

Qualy 当前跨插件事务的语义更接近：

```text
已有事务时加入同一事务
```

而不是每个跨插件方法自动创建 savepoint。

所以 Qualy 的 `Database.transaction()` 默认应显式使用：

```ts
TransactionPropagation.REQUIRED
```

并把 savepoint 暴露为另一个明确接口：

```ts
database.savepoint(...)
```

否则调用层次稍微变化，就会悄悄引入不同的回滚边界。

## 4. 不要在事务边界把 Effect 失败“处理成成功”

例如：

```ts
Effect.either(program)
Effect.catchAll(program, () => Effect.succeed(fallback))
```

若在事务回调内部执行，Effect 最终成功，MikroORM 就会提交。

这本身不是错误，但规则应明确：

> 只有最终未处理的 Effect Cause 才触发事务回滚；业务恢复成 success 就意味着允许提交当前数据库状态。

---

# 六、Kysely 写入与 MikroORM Unit of Work 的关系

这里不能混用得过于随意。

Kysely 的：

```ts
insertInto()
updateTable()
deleteFrom()
```

会立即执行 SQL。

MikroORM 的实体修改则通常先进入 Unit of Work，等 `flush()` 时执行。`transactional()` 在提交前会 flush。

因此同一事务中出现：

```text
先通过 MikroORM 加载实体
再通过 Kysely 更新同一行
然后继续读取那个已加载实体
```

EntityManager identity map 中的对象可能已经过时。

建议给 Qualy 建立明确纪律：

### 默认：Kysely command/query service

目前 Org、Auth、RBAC 都是：

- 多表条件查询；
- 行锁；
- 批量更新；
- 复杂约束检查；
- CTE；
- 作用域投影；
- DTO 返回。

它们天然更适合 Kysely，而不是 Entity CRUD。

这些服务应在一个事务里全部使用 Kysely，避免 identity map 参与。

### MikroORM Entity API 只用于适合的场景

例如：

- 简单实体生命周期；
- 明确的聚合关系加载；
- 需要 ORM optimistic lock；
- 需要 collection/populate；
- 需要实体 hook；
- 对象图写入明显比 SQL command 更自然。

并规定：

```text
同一事务内，不得同时通过 Kysely 和 Unit of Work 修改同一实体集合，
除非显式 flush + clear/refresh。
```

因此目标不是“所有 SQL 改成 `em.find()`”，而是：

> **Kysely-first，MikroORM metadata/transaction-first，UoW selective。**

---

# 七、迁移系统是切换中成本最高的部分

当前数据库 capability 不只是调用 Drizzle-Kit。它已经包含：

- 插件 Schema entry 聚合；
- 数据库依赖拓扑；
- detached retention；
- baseline SQL；
- pre/post structure；
- migration lineage；
- drop guard；
- clean-room 生成；
- migrations apply/off；
- 空库重放。

MikroORM Migration 支持：

- 基于实体元数据生成 diff；
- snapshot；
- 事务化执行；
- all-or-nothing；
- `dropTables: false`；
- custom MigrationGenerator；
- 手工 `addSql()`。

但迁移后必须重新实现 Qualy 特有的这一层：

```text
Assembly database capability
        ↓
聚合 retained plugins 的 entities
        ↓
MikroORM metadata/schema snapshot
        ↓
生成 migration
        ↓
注入 baseline SQL
        ↓
drop guard
        ↓
提交并部署
```

不能直接用：

```bash
mikro-orm migration:create
```

扫描整个 workspace，然后认为完成了插件装配。Assembly lock 仍然是选择实体集合的权威。

## 迁移格式变化也是一个取舍

当前 Drizzle migration 是纯 SQL，优点是：

- 容易审计；
- 可脱离框架执行；
- PG 故障恢复路径简单；
- provenance/header 容易注入。

MikroORM 默认 migration 是带 `addSql()` 的 TS/JS 类。虽然 SQL 仍然可见，但独立执行性较差。

建议保留以下目标：

- migration 内容必须可审阅；
- migration 生成后不得依赖运行时实体来决定行为；
- custom SQL 必须进入提交的 migration；
- deploy 只执行已提交 migration；
- drop guard 不取消；
- baseline fragment 不取消；
- 生产启动不运行 schema update。

至于最终存 TS migration 还是继续产出纯 SQL，可以在 spike 中比较。这里不能为了换 ORM，把已经正确的数据层纪律一并删除。

---

# 八、两条路线的实际比较

| 维度                      |                            修正现有 Drizzle |   MikroORM v7.1 + Kysely |
| ------------------------- | ------------------------------------------: | -----------------------: |
| 普通查询类型安全          |                  高，前提是全面改用 Builder |                     很高 |
| SQL 风格与复杂查询可读性  |                                          中 |                       高 |
| 结果类型推导              |                                          高 |                       高 |
| PostgreSQL 特殊表达式     |                               仍需 `sql`` ` |        仍需局部 `sql`` ` |
| Effect 原生集成           |                                    **最好** |                 需要适配 |
| interruption/Scope        |                                        原生 | 必须正确桥接 AbortSignal |
| 插件实体聚合              |                                  当前已完成 |         需要改造 codegen |
| migration 装配            |                                  当前已完成 |        需要重做 provider |
| Unit of Work/Identity Map |                                          无 |                     可选 |
| 乐观锁/悲观锁             |                                        手工 |                 一等支持 |
| trigger 元数据            |                         较弱，依赖 baseline |              v7.1 已支持 |
| 版本成熟度                | Drizzle 1.0 RC，Effect 适配也在 RC/unstable |      MikroORM 7.1 stable |
| 迁移成本                  |                                        较低 |                       高 |

当前仓库钉的是 `drizzle-orm 1.0.0-rc.4`，而 Effect 也是 v4 beta，并且使用多个 `effect/unstable/*` 模块。

所以“保持现状”也不是完全没有版本风险。

---

# 九、我建议的最终架构

```text
@qualy/plugin-database
├── assembly/
│   ├── contribution.ts       # entitiesEntry / baselineDir / dependsOn
│   ├── entities.ts           # 聚合 retained plugin entities
│   ├── migrations.ts         # MikroORM diff/generator 适配
│   ├── baseline.ts           # 保留
│   └── drop-guard.ts         # 保留
│
├── runtime/
│   ├── orm.ts                # scoped MikroORM resource
│   ├── database.ts           # Effect Database service
│   ├── transaction.ts        # Cause + interruption 安全桥
│   ├── kysely.ts             # getKysely 配置
│   └── errors.ts             # DB exception → typed infrastructure error
│
└── testkit/
```

每个业务插件：

```text
plugin-org/
├── src/db/
│   ├── entities/
│   │   ├── tenant.ts
│   │   ├── org-type.ts
│   │   ├── org-type-rule.ts
│   │   └── org-node.ts
│   └── index.ts
│
├── src/server/
│   ├── repository.ts         # Kysely 查询
│   ├── service.ts            # Effect 业务流程
│   ├── errors.ts
│   └── layer.ts
│
└── db/baseline/
    └── 0001_ltree.sql
```

查询层不再暴露：

```ts
SQL
unknown
rows<Row>()
```

而是暴露：

```ts
Effect.Effect<readonly NodeRow[], DatabaseError>
```

其中 `NodeRow` 直接由 Kysely SELECT 推导。

---

# 十、切换前必须通过的验证

不要拿 `ping` 做验证。它太简单，会让任何方案看起来都可行。

应选择 `Org.changeNodeType`，因为它同时覆盖：

1. `ltree`；
2. 复合外键；
3. 部分索引；
4. tenant row lock；
5. Org 自身写入；
6. 调用 RBAC；
7. 调用 Auth Placement；
8. 同一事务连接跨插件传播；
9. Effect typed failure；
10. constraint translation；
11. rollback；
12. interruption。

当前这条路径正是为了验证跨插件 ambient transaction 而设计的。

验证必须满足：

- MikroORM 实体生成的目标 DDL与当前数据库等价；
- 不产生意外 DROP/ALTER；
- 约束名和索引名保持；
- Kysely 查询除 `ltree` 等局部表达式外不使用整段 raw SQL；
- 拼错表名或列名会 typecheck 失败；
- SELECT 结果不再手写 Row cast；
- `Effect.fail` 回滚；
- defect 回滚；
- Fiber interruption 回滚；
- 跨插件调用看到事务内未提交状态；
- 嵌套事务默认 REQUIRED；
- 显式 savepoint 正常；
- disabled/detached 插件不生成 DROP；
- baseline `ltree` 在 clean-room 空库生成中仍位于建表前；
- 全部现有 migration、seed、HTTP、browser gates 通过。

---

## 最终裁决

我的判断是：

> **值得切换，而且 MikroORM v7.1 + Kysely 比“继续大量使用 Drizzle `sql`` `”更适合 Qualy。**

理由不是 MikroORM 功能更多，而是它能形成一条更完整的类型链：

```text
插件实体定义
→ Schema / migration metadata
→ Kysely table/column types
→ 查询结果类型
→ Effect service output
→ HttpApi Schema
```

当前则是：

```text
Drizzle Schema
→ migration
×
手写 SQL 字符串
→ unknown
→ 手写 Row interface
→ 类型断言
```

但这一裁决有两个限定：

1. **必须完整替换数据库元数据事实源。** 不应长期同时维护 Drizzle Schema 和 MikroORM Entity。
2. **必须实现 Cause 和 interruption 安全的 Effect 事务桥。** 单纯 `transactional(() => Effect.runPromise(...))` 能回滚，但不足以保留 Qualy 当前的类型化错误和结构化取消语义。

一旦高难度纵向验证通过，就应完成切换；若验证失败，退路不是保留三层混合架构，而是继续使用 Drizzle，并把现有整段 `sql`` ` 逐步重写为 Drizzle typed query builder。

如果已经支持直接写trigger和function了，是否还有必要支持behavior/baseline等手写SQL功能，还是说可以去除？MikroORM是否支持在代码中自定义执行迁移生成器和执行器？怎么做最合适？assembly此时应该做什么功能？我们之前讨论说，assembly提供接口，db插件可以注册能力，此时才会执行相关generate migrate脚本，是否应该仍然保持，怎么做？

## 结论

建议这样收口：

> **删除独立的 `behavior` 机制；不要彻底删除手写 SQL 通道。将现有 `baseline` 缩减并重命名为唯一的 `migrationFragments` 通道。**

最终数据库定义来源应当是：

```text
MikroORM Entity metadata
  负责表、列、关系、约束、索引、默认值、受支持的 trigger

plugin-owned migration fragments
  只负责 MikroORM 无法表达或不适合表达的数据库对象

MikroORM Migrator
  生成和执行最终中心迁移序列
```

Assembly 的 capability provider 机制应当继续保留，而且这次切换反而证明它是正确的：

> Assembly Core 不认识 MikroORM，也不认识数据库；Database 插件注册 `database` capability，并实现 `resolve / plan / generate / deploy / commands`。

不应让 Assembly Core 直接调用 MikroORM。

---

# 一、先纠正一个前提：MikroORM 不是普遍支持任意 function 元数据

MikroORM v7.1 对 trigger 的支持比较完整：

```ts
triggers: [
  {
    name: 'update_timestamp',
    timing: 'before',
    events: ['insert', 'update'],
    body: `NEW.updated_at = NOW(); RETURN NEW`,
  },
]
```

在 PostgreSQL 下，MikroORM 会为这个 `body` 生成：

```text
trigger function
+
trigger
```

并由 Schema Generator 和 Migration System 管理创建、更新和删除。

但这里的 function 是：

> **某个 trigger 的实现函数。**

它不等于 MikroORM 提供了一个通用的数据库 function registry。官方文档中公开的是 trigger-scoped `body` 和完整 DDL 的 `expression` escape hatch，并没有因此建立一个可管理任意独立 function、procedure、view、extension、policy 的通用元数据系统。

例如这些仍然需要自定义迁移 SQL：

```text
CREATE EXTENSION ltree
CREATE FUNCTION calculate_score(...)
CREATE PROCEDURE ...
CREATE VIEW ...
CREATE MATERIALIZED VIEW ...
CREATE POLICY ...
ALTER TABLE ... ENABLE ROW LEVEL SECURITY
GRANT / REVOKE
CREATE DOMAIN
CREATE OPERATOR
一次性数据迁移
复杂的 PostgreSQL 特有 DDL
```

还有一个重要限制：trigger 使用 `expression` 时，MikroORM 不会检测 expression 内容后续的修改；要更新它，需要手动 drop/recreate。官方因此建议应由迁移系统持续管理的 trigger 优先使用 `body`。

所以不能因为 trigger 支持增强，就删除所有自定义 SQL 能力。

---

# 二、`behavior` 可以删除，`baseline` 应改造而不是删除

## 删除 `behavior`

单独的 behavior 概念没有必要继续存在。

过去 behavior 通常包括：

- trigger；
- trigger function；
- projection dirty trigger；
- 审计 trigger；
- updated-at trigger。

其中与单表 trigger 绑定的行为，现在都可以放回对应 Entity：

```ts
export const OrgNode = defineEntity({
  name: 'OrgNode',
  tableName: 'org_nodes',

  properties: {
    // ...
  },

  triggers: [
    {
      name: 'trg_org_nodes_updated_at',
      timing: 'before',
      events: ['update'],
      body: `
        NEW.updated_at = NOW();
        RETURN NEW;
      `,
    },
  ],
})
```

这有几个直接收益：

- 表结构和 trigger 归属放在同一个插件；
- trigger 修改进入 MikroORM migration diff；
- 删除实体时 trigger 也进入 diff；
- 不再单独维护 behavior lock；
- 不需要手工决定 trigger 应在建表前还是建表后；
- PostgreSQL trigger function 名称和 DDL由 MikroORM统一生成。

因此：

```text
behaviorDir
behavior.lock
behavior compiler
```

都不应重新引入。

## `baseline` 不应原样保留

当前 `baseline` 的范围过宽，注释中把这些全部列为候选：

- extension；
- function；
- trigger；
- view；
- 必需行。

换成 MikroORM 后，trigger 应迁出；某些索引、check 和其他结构也应迁进 Entity metadata。

但 `CREATE EXTENSION ltree` 这一类问题依然存在。当前机制之所以被引入，是因为从任意插件组合 clean-room 生成迁移时，`org_nodes.path ltree` 需要在建表前先创建 extension；单独依赖宿主历史迁移会破坏插件自包含。

所以应把：

```text
baselineDir
```

改名并收窄为：

```text
migrationFragmentsDir
```

或者：

```text
schemaSqlDir
```

我更推荐 `migrationFragmentsDir`，因为这些文件本质上是：

- 插件拥有；
- 追加式；
- 编译进中心 migration lineage；
- 一旦编译不得修改；
- 不是每次启动都执行的“当前 baseline”。

---

# 三、最终只保留一个手写 SQL escape hatch

建议数据库 contribution 变为：

```ts
export interface DatabaseContribution {
  /**
   * 导出该插件 MikroORM EntitySchema / defineEntity 的模块。
   */
  entitiesEntry?: string

  /**
   * MikroORM Entity metadata 无法承载的迁移 SQL。
   */
  migrationFragmentsDir?: string

  /**
   * 数据库对象依赖的其他插件。
   */
  dependsOn: string[]
}
```

插件 metadata：

```json
{
  "qualy": {
    "contributions": {
      "database": {
        "entitiesEntry": "./src/db/entities.ts",
        "migrationFragmentsDir": "./db/migrations",
        "dependsOn": ["@qualy/plugin-org"]
      }
    }
  }
}
```

每个 fragment 可以保留 phase：

```sql
-- qualy:phase pre-schema
-- qualy:kind extension

CREATE EXTENSION IF NOT EXISTS ltree;
```

```sql
-- qualy:phase post-schema
-- qualy:kind function

CREATE OR REPLACE FUNCTION qualy_calculate_score(...)
RETURNS ...
LANGUAGE sql
AS $function$
  ...
$function$;
```

只需要两个 phase：

```text
pre-schema
post-schema
```

不再需要 `behavior`、`manual` 等平行分类。

## 各类数据库对象应落在哪里

| 对象                             | 推荐来源                     |
| -------------------------------- | ---------------------------- |
| 表、列                           | MikroORM Entity              |
| 主键、外键、唯一约束             | MikroORM Entity              |
| 普通/部分/表达式索引             | 能由 MikroORM表达时放 Entity |
| Check constraint                 | MikroORM Entity              |
| 默认值、`uuidv7()`               | Entity `defaultRaw`          |
| 自定义列类型映射                 | MikroORM `Type`              |
| 普通 trigger                     | Entity `triggers[].body`     |
| trigger 专用 function            | 由 MikroORM 自动生成         |
| `expression` 型 trigger          | 尽量避免；必要时视为手写 SQL |
| Extension                        | pre-schema fragment          |
| 独立 reusable function/procedure | post-schema fragment         |
| View/materialized view           | post-schema fragment         |
| RLS policy、GRANT                | post-schema fragment         |
| 一次性数据迁移                   | 手工 Migration 类            |
| destructive purge                | 人工审核 Migration 类        |

这里要区分两类手写 SQL。

### 插件自包含的结构资产

例如：

```text
ltree extension
独立数据库 function
view
RLS policy
```

放在插件的 `migrationFragmentsDir`。

### 某次版本升级的一次性步骤

例如：

```text
旧字段转换到新字段
历史数据回填
两阶段重命名
显式 DROP
```

不放 fragment 目录，而是直接编辑这次生成的中心 MikroORM Migration 类：

```ts
export class Migration20260806Foo extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update ...`)
    this.addSql(`alter table ...`)
  }
}
```

MikroORM 的 Migration 基类公开提供 `addSql()`、`execute()`、`getEntityManager()` 等接口。

---

# 四、MikroORM 完整支持程序化生成和执行迁移

是的，而且不需要 Shell 调 CLI。

初始化时注册 `Migrator`：

```ts
import { MikroORM } from '@mikro-orm/postgresql'
import { Migrator } from '@mikro-orm/migrations'

const orm = await MikroORM.init({
  entities,
  clientUrl,
  extensions: [Migrator],

  migrations: {
    pathTs: migrationsPath,
    path: compiledMigrationsPath,
    snapshot: true,
    transactional: true,
    allOrNothing: true,
    dropTables: true,
    generator: QualyMigrationGenerator,
  },
})
```

之后可以直接：

```ts
const result = await orm.migrator.create(
  migrationsPath,
  false, // blank
  false, // initial
  migrationName,
)

const pending = await orm.migrator.getPending()

await orm.migrator.up()

await orm.migrator.down()
```

`Migrator` 的公开接口包括：

- `create()`；
- `createInitial()`；
- `up()`；
- `down()`；
- `getPending()`；
- `getExecuted()`；
- `checkSchema()`；
- `rollup()`。

官方文档也直接给出了 `orm.migrator.create()`、`up()`、`down()` 的程序化用法。

## 自定义 Migration Generator

配置中可以提供：

```ts
migrations: {
  generator: QualyMigrationGenerator,
}
```

自定义 generator 可以继承：

```ts
import { TSMigrationGenerator } from '@mikro-orm/migrations'

export class QualyMigrationGenerator extends TSMigrationGenerator {
  override generateMigrationFile(
    className: string,
    diff: {
      up: string[]
      down: string[]
    },
  ): string {
    const generated = super.generateMigrationFile(className, diff)

    return [
      '// generated by @qualy/plugin-database',
      '// do not create migrations outside `pnpm qualy generate`',
      generated,
    ].join('\n')
  }

  override createStatement(statement: string, padLeft: number): string {
    return super.createStatement(normalizePostgresSql(statement), padLeft)
  }
}
```

MikroORM 的 `migrations.generator` 是公开配置项；自定义 generator 可以控制 Migration 文件内容和每条 SQL 的输出格式。

但需要明确：

> `MigrationGenerator` 负责把已有的 `up/down SQL diff` 输出成 Migration 文件，它不是数据库装配决策器。

它不应该负责：

- 哪些插件进入 assembly；
- disabled/detached 是否保留；
- Entity 从哪些插件聚合；
- 哪些 SQL fragment 待编译；
- destructive 是否允许。

这些仍由 Qualy Database capability 决定。

## 不应使用 `orm.schema.update()` 部署生产

MikroORM 也提供：

```ts
await orm.schema.getUpdateSchemaSQL()
await orm.schema.getUpdateSchemaMigrationSQL()
await orm.schema.update()
```

但官方明确警告 Schema Generator 可能直接 drop/alter 数据库对象，适合开发和生成 SQL，不是生产迁移替代品。生产应执行经过审阅并提交的 Migration 文件。

所以 Qualy 应使用：

```text
generate: orm.migrator.create()
deploy:   orm.migrator.up()
```

而不是：

```text
startup: orm.schema.update()
```

---

# 五、最合适的迁移生成方式

不建议强行把 Entity diff 和 custom SQL 拼进同一个 Migration 类。

更简单稳妥的是，一次 `qualy generate` 最多产生三条连续迁移：

```text
Migration..._pre_schema_assets
Migration..._<用户提供名称>
Migration..._post_schema_assets
```

执行顺序：

```text
pre-schema fragments
→ MikroORM Entity schema migration
→ post-schema fragments
```

MikroORM 默认：

- 每条 migration 运行在事务中；
- 所有 migration 还会被包在一个 master transaction 中；
- 中间任一失败会整体回滚。

因此不必像当前 Drizzle 编译器那样强制把三部分拼进同一个 `migration.sql`。当前代码这样做是为了保证 pre-structure、结构和 post-structure 顺序以及空库应用完整性。 MikroORM 的有序 migration + `allOrNothing: true` 可以更自然地表达这个顺序。

推荐实现：

```ts
async function generateDatabase(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): Promise<void> {
  const assembly = await loadDatabaseAssembly(context)

  const orm = await createMigrationOrm({
    entities: assembly.entities,
    migrationsPath: assembly.migrationsPath,
  })

  try {
    const before = snapshotMigrationFiles(assembly.migrationsPath)

    const pendingAssets = findPendingFragments(assembly.fragments, assembly.migrationsPath)

    if (pendingAssets.pre.length > 0) {
      await writeFragmentMigration({
        path: assembly.migrationsPath,
        name: 'pre_schema_assets',
        fragments: pendingAssets.pre,
      })
    }

    await orm.migrator.create(assembly.migrationsPath, false, false, context.args.name)

    if (pendingAssets.post.length > 0) {
      await writeFragmentMigration({
        path: assembly.migrationsPath,
        name: 'post_schema_assets',
        fragments: pendingAssets.post,
      })
    }

    const created = diffMigrationFiles(before, assembly.migrationsPath)

    assertFragmentsImmutable(assembly.fragments, assembly.migrationsPath)

    guardDestructive(created)
    validateMigrationImports(created)
  } finally {
    await orm.close(true)
  }
}
```

`writeFragmentMigration()` 可以由 Qualy 自己生成一个很小的 MikroORM Migration 类：

```ts
export class Migration20260806024500PreSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE EXTENSION IF NOT EXISTS ltree;`)
  }
}
```

不需要为了这种简单文件去修改 MikroORM 内部 Migrator。

MikroORM `create()` 的返回值包含：

```ts
{
  code,
  diff,
  fileName,
}
```

因此 Database provider 也能精确记录和检查本轮产物。

---

# 六、Assembly 应该做什么

Assembly Core 继续保持当前设计，甚至可以基本不改。

现有 `assembly-contract` 已经定义：

```ts
interface AssemblyCapabilityProvider {
  key: string

  parseContribution(...)
  resolve(...)
  retainsPlugin?(...)
  plan?(...)
  generate?(...)
  deploy?(...)
  commands?: ...
}
```

它明确要求 Assembly Core 不理解数据库、搜索索引和对象存储，只负责调用 capability provider，并把 provider 的状态作为 opaque state 写入 lock。

这正是应该保留的边界。

## Assembly Core 负责

```text
读取 qualy.yml
发现插件
发现 capability provider
校验一个 capability 只有一个 provider
选择 active / disabled / detached
维护 qualy.lock.json
验证 frozen lock
调用 provider 生命周期
保存和 hash provider 的 opaque state
```

## Assembly Core 不负责

```text
理解 Entity
初始化 MikroORM
理解 migration snapshot
扫描 SQL
判断 trigger
连接 PostgreSQL
执行 migration
判断表依赖
生成 Kysely 类型
```

## Database capability provider 负责

```text
解析 entitiesEntry
解析 migrationFragmentsDir
解析数据库 dependsOn
计算 retained database plugin order
加载 Entity metadata
生成 entities.gen.ts
初始化 migration-only MikroORM
调用 orm.migrator.create()
生成 fragment migrations
执行 drop guard
调用 orm.migrator.up()
检查 pending migrations
生成 Kysely/Entity 类型聚合
```

---

# 七、capability 注册机制必须继续保留

答案是明确的：**保留。**

但这里的“注册”应该是静态声明，不是应用启动后动态注册。

Database 插件的 `package.json` 声明自己提供 capability：

```json
{
  "name": "@qualy/plugin-database",
  "qualy": {
    "capabilityProvider": {
      "key": "database",
      "entry": "./assembly"
    }
  }
}
```

其他插件只声明 contribution：

```json
{
  "qualy": {
    "contributions": {
      "database": {
        "entitiesEntry": "./src/db/entities.ts",
        "migrationFragmentsDir": "./db/migrations",
        "dependsOn": ["@qualy/plugin-org"]
      }
    }
  }
}
```

Assembly resolve 时：

1. 发现某些插件声明了 `contributions.database`；
2. 查找 `database` provider；
3. 没有 provider 就硬失败；
4. 加载 `@qualy/plugin-database/assembly`；
5. 调用其 `parseContribution()` 和 `resolve()`；
6. 把结果写入 lock。

当前 Database provider 已经负责数据库对象依赖排序，并在缺少数据库依赖时于生成迁移之前拒绝 assembly。

这套设计不应因为底层从 Drizzle 换成 MikroORM 而改变。

---

# 八、建议的命令生命周期

## `qualy resolve`

纯操作，不连接数据库：

```text
manifest
→ plugin selection
→ load database capability provider
→ parse entitiesEntry / fragments / dependsOn
→ 计算 active + disabled + detached 的 retained DB 集合
→ 拓扑排序
→ 计算 fragment hashes
→ 写 qualy.lock.json
```

数据库 provider 的 resolve 结果可以是：

```ts
interface DatabaseState {
  order: string[]

  fragments: Array<{
    plugin: string
    path: string
    phase: 'pre-schema' | 'post-schema'
    sha256: string
  }>
}
```

`resolve` 不应初始化 MikroORM，也不应连接数据库。

## `qualy plan`

输出：

```text
database:
  add entities: @qualy/plugin-foo
  retain entities: @qualy/plugin-old (detached)
  pending fragment: @qualy/plugin-org/0001_ltree.sql
  possible destructive schema change: unknown until generate
```

仍不连接数据库。

## `qualy generate --name add-score-rule`

Assembly Core 调用：

```ts
databaseProvider.generate(context)
```

Database provider：

```text
生成 retained entities aggregate
→ 生成 pre-schema custom migration
→ MikroORM migrator.create()
→ 生成 post-schema custom migration
→ drop guard
→ provenance/hash 检查
→ snapshot 检查
```

## `qualy deploy`

Assembly Core 调用：

```ts
databaseProvider.deploy(context)
```

Database provider：

```ts
MikroORM.init(...)
→ migrator.getPending()
→ migrator.up()
→ 输出已执行 migration
→ close()
```

MikroORM 也允许通过 `migrationsList` 显式提供 migration 类，而不是文件扫描；这在以后打包成单文件或容器产物时有用，但当前普通文件发现已经足够。

## 应用启动

Effect Database Layer：

```text
读取生成的 retained entities aggregate
→ scoped MikroORM.init()
→ 检查 pending migration
→ pending > 0 时拒绝启动
→ 提供 EntityManager/Kysely/transaction service
→ Scope 关闭时 orm.close()
```

开发环境可以保留：

```text
QUALY_MIGRATIONS=apply
```

生产默认：

```text
QUALY_MIGRATIONS=off
```

即部署任务执行 migration，应用只验证数据库没有落后。

---

# 九、推荐的目录形态

```text
packages/plugins/infra/database/
├── src/
│   ├── assembly/
│   │   ├── contribution.ts
│   │   ├── state.ts
│   │   ├── entities.ts
│   │   ├── fragments.ts
│   │   ├── generator.ts
│   │   ├── deploy.ts
│   │   ├── drop-guard.ts
│   │   └── index.ts
│   │
│   ├── runtime/
│   │   ├── database.ts
│   │   ├── transaction.ts
│   │   ├── kysely.ts
│   │   ├── config.ts
│   │   └── layer.ts
│   │
│   ├── migrations/
│   │   ├── QualyMigrationGenerator.ts
│   │   └── render-fragment-migration.ts
│   │
│   └── testkit/
│
└── package.json
```

业务插件：

```text
packages/plugins/base/org/
├── src/db/
│   ├── entities/
│   │   ├── Tenant.ts
│   │   ├── OrgType.ts
│   │   ├── OrgTypeRule.ts
│   │   └── OrgNode.ts
│   └── entities.ts
│
└── db/migration-fragments/
    └── 0001_ltree.sql
```

其中 trigger 直接写入相应 Entity，不再出现在 migration fragments。

---

# 最终裁决

保留和删除项如下：

| 机制                                  | 裁决                                       |
| ------------------------------------- | ------------------------------------------ |
| MikroORM Entity Schema                | **成为数据库结构主事实源**                 |
| MikroORM trigger `body`               | **用于所有可表达 trigger**                 |
| `behaviorDir`                         | **删除**                                   |
| `behavior.lock`                       | **删除**                                   |
| 原 `baselineDir`                      | **重命名并收窄为 `migrationFragmentsDir`** |
| pre/post phase                        | **保留**                                   |
| fragment hash/不可变校验              | **保留**                                   |
| drop guard                            | **保留**                                   |
| 手工 Migration 类                     | **保留，用于数据迁移和破坏性操作**         |
| Assembly capability provider          | **必须保留**                               |
| Assembly Core 直接认识 MikroORM       | **禁止**                                   |
| Database provider 程序化调用 Migrator | **推荐**                                   |
| 生产使用 `schema.update()`            | **禁止**                                   |
| `orm.migrator.up()`                   | **作为正式 deploy 路径**                   |

最精确的架构表述是：

> **MikroORM 管理它能理解的数据库结构；Qualy Database capability 管理插件集合、生成顺序和 MikroORM 不理解的 SQL；Assembly Core 只管理 capability 生命周期，完全不管理数据库细节。**
