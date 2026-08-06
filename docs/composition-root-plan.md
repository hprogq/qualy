# 组合根收口实施方案(阶段 2.6 v3)

装配核心已与 database 解耦(capability-boundary 测试守),但组合根没有:
`apps/server/src/{runtime,config,health}.ts` 无条件点名五处插件导入,没有 database 的装配
连编译都过不去。本方案让宿主源码不再出现任何 `@qualy/plugin-*` 导入,同时把
「新增一种集成点 = 新文件 + 新 exports 子路径 + 新声明 + 新 gen 脚本」这条税降为
「拥有方定义一个注册表服务,贡献方在已有 layer 里加一次调用」。

## 0. 分类结论(每一项都核对过读取时机)

| 集成点                              | 现状                                         | 去向                                             | 依据                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ui surfaces                         | `ui.ts` 数据导出 + `gen-ui.ts` + `UiCatalog` | **注册表**(ui-registry 拥有)                     | UiManifest 的构建期读取(manifest.ts:54)只是实现选择,改请求期即可                                                                                                               |
| login drivers                       | `login-driver.ts` + `gen-login-drivers.ts`   | **注册表**(auth 拥有)                            | sign-in 的构建期读取(sign-in.ts:230)同上                                                                                                                                       |
| readiness                           | 宿主 health.ts 直接 import `ping`            | **注册表**(api-kit 拥有)                         | 消费本来就在请求期                                                                                                                                                             |
| permissions                         | `permissions.ts` + `gen-permissions.ts`      | **静态,升为 rbac 的能力**(modules + layerExport) | rbac **构建期**把 catalog 镜像进 permissions 表(index.ts:63-75),而贡献方(auth/org)构建在 rbac **之上**,注册表时序倒置;且 seed(CLI)与错误码式全局唯一性校验需要不启动应用就能读 |
| entities                            | database 能力的 `modules()`                  | 静态不变,生成模块**导出 layer**                  | CLI `generate` 要在不启动应用时建 declared 库                                                                                                                                  |
| 每插件 config                       | 宿主 `config.ts` 代读                        | **生成器通道**(`qualy.runtime.config`)           | 清单值必须从清单流向插件,运行时没有别的载体                                                                                                                                    |
| api 契约 / routes / client chunk 表 | 静态生成                                     | 不动                                             | 类型不存在于运行时;浏览器 lazy import 需静态可见                                                                                                                               |

判据一句话:**只有「不启动应用就必须存在」的值走静态文件;其余走注册表**。

## 1. 注册表通用纪律

Effect 的注册表习语来自上游源码(实读路径):

- `HttpRouter`(`repos/effect/.../unstable/http/HttpRouter.ts:103-170,478-480,565`):
  `Context.Service` 内装可变结构,注册即
  `use(f) = Layer.effectDiscard(Effect.flatMap(HttpRouter, f))`,注册 effect 可用 Scope
  (签名里 `Exclude<R, Scope.Scope>`),拥有方 `layer = Layer.effect(HttpRouter)(make)`。
- `HttpApiBuilder.group`(`.../httpapi/HttpApiBuilder.ts:120-155`):贡献方以键发布服务、
  收集方从 context 读走 —— 本仓 `apiHandlers` 已在用。

cordis 对应:`ctx.xxx.register(v)` → 贡献方 layer 里 `yield* xxx.addPage(v)`;
`ctx.effect(反动作)` → `Effect.acquireRelease` 挂 layer scope(卸载自动反注册);
`ctx.loader.await()` → **layer 图 + 端口最后绑定**;`inject` 门控 → require 注册表服务
(缺拥有方 = 编译错)。

五条纪律,适用于每一个注册表:

1. **读取时机**:注册表**服务句柄**可以在构建期 yield(它是稳定容器),**内容**只能在
   请求期读,或由 layer 图上位于全部贡献方之后的 layer 读。拥有方自己的消费一律请求期。
2. **重复即 die**:重名 id/path/contract 是坏装配不是可处理错误 —— 注册 effect 内部
   `Effect.die`,layer 构建失败,进程拒绝启动(dev 循环立刻看到;gen-ui 的注释本来就说
   registry 会在 boot 抛,codegen 只是提前 —— 现在提前的那份删掉,boot 那份是唯一裁决)。
   注册方法的 error channel 保持 `never`。
3. **顺序无语义**:`Layer.mergeAll` 并行构建,注册顺序不确定 —— ID 命名空间化、展示排序用
   显式 `order` 字段(UI 组合模型的冻结规则升为通用规则)。
4. **探针预绑定**:注册进注册表的 effect(如就绪探针)必须 `R = never` —— 贡献方在自己的
   layer 里(那里有它的服务)把依赖绑好再注册,注册表不做 R 的管道。
5. **注册值有类型**:注册方法的参数是契约包里的具名类型,`visibility` 等字段显式必填
   (无隐式默认,冻结规则不变)。

可变容器遵守既有纪律:装进 Map/数组等稳定容器再变更,不做 `this.prop =` 重赋值。

## 2. Readiness 注册表(第一步,验证习语)—— **已实施 2026-08-06**

住 `@qualy/api-kit`(宿主与插件都已依赖,且探针概念属于服务器基座):

```ts
export interface ReadinessCheck {
  readonly name: string
  /** pre-bound: the plugin supplies its own services before registering */
  readonly probe: Effect.Effect<void, unknown>
}
export class Readiness extends Context.Service<
  Readiness,
  {
    readonly register: (check: ReadinessCheck) => Effect.Effect<void, never, Scope.Scope>
    readonly checks: Effect.Effect<readonly ReadinessCheck[]>
  }
>()('@qualy/api-kit/Readiness') {}
export const readinessLayer: Layer.Layer<Readiness> = Layer.sync(Readiness, make)
```

database 插件在自己的 layer 里注册(`ping` 已存在,`withDb` 预绑定):

```ts
const readiness = yield * Readiness
yield * readiness.register({ name: 'database', probe: withDb(ping) })
```

宿主 `health.ts`:`yield* (yield* Readiness).checks` 逐个跑,任一失败 → 503 + 原因进日志;
零探针 = 空 checks 200(冻结语义:ready 只声称已装载的都健康)。`health.ts` 里
「本组合没有 database 建不起来」的注释作废。

宿主在 `runtime.ts` 用 `Layer.provide(readinessLayer)` 供给 —— Readiness 是 api-kit 的,
不算点名插件。

## 3. LoginDrivers 注册表 —— **已实施 2026-08-06**

Tag 与 `LoginDriver` 类型都已在 `@qualy/auth-contract/login`,**位置不动**,值的形状从
`readonly LoginDriver[]` 改为注册表句柄:

```ts
export class LoginDrivers extends Context.Service<
  LoginDrivers,
  {
    readonly register: (driver: LoginDriver) => Effect.Effect<void, never, Scope.Scope>
    readonly list: Effect.Effect<readonly LoginDriver[]>
  }
>()('@qualy/auth-contract/LoginDrivers') {}
```

- **auth 提供**(它是消费方):`Layer.sync(LoginDrivers, make)` 并入 auth 的 layer;
  sign-in 构建期只 yield 句柄,`list` 在各 handler 内请求期调用(sign-in.ts:230 一处改动)。
- **auth-local 注册**:在自己 server layer 里 `yield* drivers.register(localDriver)`;
  driver 定义就近搬进 `src/server/`。auth-local 只依赖 auth-contract,不新增对 plugin-auth
  的包依赖;层序仍由 `qualy.runtime.dependsOn: ['@qualy/plugin-auth']` 保证。
- **删除**:`src/login-driver.ts`、`exports['./login-driver']`、`gen-login-drivers.ts`、
  `login-drivers.gen.ts`、宿主 `loginDriversLayer`。
- 重复 driver id → die(纪律 2)。

## 4. Ui 注册表(cordis `ctx.ui.addPage` 的回归)—— **已实施 2026-08-06**

`@qualy/plugin-ui-registry/server` 定义注册表,方法名与领域对齐 —— 不是一个笼统的
`register`:

```ts
export class Ui extends Context.Service<
  Ui,
  {
    readonly addPage: (surface: PageSurface) => Effect.Effect<void, never, Scope.Scope>
    readonly registerLayout: (surface: LayoutSurface) => Effect.Effect<void, never, Scope.Scope>
    readonly contribute: (item: CollectionContribution) => Effect.Effect<void, never, Scope.Scope>
    readonly fillSlot: (item: SlotContribution) => Effect.Effect<void, never, Scope.Scope>
  }
>()('@qualy/plugin-ui-registry/Ui') {}
```

参数类型全部来自 `@qualy/ui-contract`(已存在的 `PageSurface` 等),`visibility` 显式必填、
注册期 zod 校验、id 命名空间化 —— 三条冻结规则原样保留。ping 的用法回到你熟悉的形状:

```ts
// src/server/index.ts —— ping 的 layer 里
const ui = yield * Ui
yield * ui.addPage(pingPageSurface)
```

**`ui.ts` 保留,但只放两类东西**:`definePage` 的页面身份(客户端 `PageLink` 共用同一引用,
冻结规则),以及**凡是提到客户端组件键的 surface 声明**(`pingPageSurface` 这类)。后者留在
`ui.ts` 是为了静态门禁:组件键 ↔ 客户端 chunk 注册表的比对(component-keys / browser 测试
的加载入口)需要不运行服务端代码就能读到键。不含组件键的贡献(导航项、纯数据 slot)可以
直接在 layer 里内联。

- **UiManifest 改请求期读**:`make` 不再构建期 flatten catalog(manifest.ts:54),改为每次
  manifest 请求时从注册表读再投影(投影本来就按 principal 逐请求算,flatten 是零头)。
- **删除**:`UiCatalog` 服务、`gen-ui.ts`、`ui.gen.ts`、宿主 `uiCatalogLayer`、各插件
  `defineSurfaces` 聚合导出(声明改为逐 surface 常量,由 layer 注册)。
- 重复 page id / path / layout contract → die(gen-ui 的三条校验原样搬进注册方法)。

## 5. permissions:升为 rbac 的能力(不能走注册表的那一个)

时序证据:rbac 构建期 `yield* PermissionCatalog` 并把 catalog 镜像进 permissions 表
(index.ts:63-75「mirrored into the permissions table before anything reads it」),而贡献方
auth/org require Rbac、构建在 rbac 之上 —— 注册表必然空读。加上 seed(CLI)与全局唯一性
校验的静态需求,permissions 与 entities 同类:

- rbac 增加 `./assembly` 子路径(零副作用,CLI 期动态 import,与 database 同型):
  `parseContribution` 校验 `qualy.contributions.permissions.entry`(须与
  `exports['./permissions']` 同文件,规则照旧);`resolve` 做**全局权限码唯一性**(从 gen
  期提前到 resolve 期,比今天更早);`modules()` 产出 `permissions.gen.ts`,
  **`layerExport: 'permissionCatalogLayer'`** —— 生成模块自己
  `import { PermissionCatalog } from '@qualy/rbac-contract/effect'` 并导出
  `Layer.succeed(...)`。
- 旧 `qualy.permissions` 硬拒并指路(同 `qualy.database` 迁移前例);
  `scripts/lib/permission-entries.ts`(seed 用)改读 `qualy.contributions.permissions`。
- 删除:`gen-permissions.ts`、宿主 `permissionCatalogLayer`。
- rbac 缺席的装配:能力不存在 → 模块不生成 → 没人 import 缺失的 Tag。贡献了 permissions
  但装配无 rbac → resolve 硬失败(能力通用规则,免费获得)。

## 6. entities:生成模块导出 layer

契约加一个核心不解释的字段:

```ts
export interface CapabilityModule {
  path: string
  content: string
  /** 该模块导出的 Layer 名;runtime 生成器 import 并并入 assembly */
  layerExport?: string
}
```

database 的 `modules()` 给 `entities.gen.ts` 标 `layerExport: 'entitiesLayer'`,模块尾部
增加:

```ts
import { Entities } from '@qualy/plugin-database/server'
export const entitiesLayer = Layer.succeed(Entities, entities)
```

宿主删 `Entities` 导入与 `Layer.succeed(Entities, entities)`。

## 7. config 通道(`qualy.runtime.config`)—— **auth/web 已实施 2026-08-06**

- 声明:`qualy.runtime.config: true` = 「runtime entry 导出 `config`」。声明不探测。
- 导出形状(以 auth 为例;参数类型由插件自己声明,zod/Schema 校验值):

```ts
export const config = (
  manifest: AuthManifestConfig,
  context: { readonly manifestDir: string },
): Layer.Layer<AuthConfig, ConfigError> => ...
```

- 生成器把清单该插件的 `config:` 节**作为字面量**写进调用 —— yml 形状错 = 生成文件
  typecheck 错(与「缺包挂 build 不挂 boot」同一性质)。核心不解释键;路径类字段
  (database 的 `migrationsFolder`)由插件按 `manifestDir` 自行 resolve,生成器只 emit
  一行 `const manifestDir = fileURLToPath(new URL('<相对>', import.meta.url))` 锚定。
- 搬家名单:`authConfigLayer` → auth;`webConfigLayer` → web;`databaseConfigLayer` →
  database(**生产缺 `DATABASE_URL` 硬失败、开发才允许 localhost fallback** 的审计修复
  随这一步落地);`uiCatalogLayer`/`loginDriversLayer`/`permissionCatalogLayer` 已由
  §3-5 吸收。
- 硬失败:清单给了 `config:` 但插件既无 capabilityProvider 也未声明 `runtime.config` →
  resolve 拒绝(设置静默失效是本仓最恨的失败形态)。
- 测试注入不变:config 是服务,testkit 继续直接 provide。

## 8. 端态

`runtime.gen.ts`(示意):

```ts
import { Layer } from 'effect'
import { fileURLToPath } from 'node:url'
import { layer as pluginAuth, config as authConfig } from '@qualy/plugin-auth/server'
import { layer as pluginDatabase, config as databaseConfig } from '@qualy/plugin-database/server'
// ...其余插件 layer import,分层 provideMerge 不变
import { entitiesLayer } from './entities.gen.ts'
import { permissionCatalogLayer } from './permissions.gen.ts'

const manifestDir = fileURLToPath(new URL('..', import.meta.url))
const pluginLayers = /* 现有 levels 组合,不变 */
export const assembly = pluginLayers.pipe(
  Layer.provide(Layer.mergeAll(
    authConfig({}, { manifestDir }),
    databaseConfig({ migrationsFolder: './db/migrations' }, { manifestDir }),
    entitiesLayer,
    permissionCatalogLayer,
  )),
)
```

宿主:`runtime.ts` import `{ assembly }` + 提供 `readinessLayer`(api-kit);`config.ts`
只剩 `ServerConfig` 与 `apiReferenceEnabled`(端口与文档曝光是宿主事实);`health.ts` 读
Readiness。**宿主零 `@qualy/plugin-*` 导入。**

每插件文件账本(以「有页面有表有 API 的业务插件」为例):

| 文件                                   | 之前                        | 之后                               |
| -------------------------------------- | --------------------------- | ---------------------------------- |
| `src/server/index.ts`                  | layer                       | layer + 各注册调用                 |
| `src/api.ts`                           | 必有                        | 必有(类型)                         |
| `src/db/entities.ts`                   | 必有                        | 必有(CLI)                          |
| `src/ui.ts`                            | 页面身份 + surfaces 聚合    | 页面身份 + 含组件键的 surface 声明 |
| `src/permissions.ts`                   | 有                          | 有(声明搬到 contributions 键)      |
| `src/login-driver.ts` 之类纯运行时贡献 | 一种一个文件 + 子路径 + gen | **消失**                           |
| `client/`                              | 浏览器代码                  | 不变                               |

删除的根脚本:`gen-ui.ts`、`gen-login-drivers.ts`、`gen-permissions.ts`。

## 9. 实施顺序(每步一个绿提交)

1. ~~**Readiness 注册表**~~ **已完成**:api-kit 服务 + database 注册 + health.ts 改读注册表。
   实施中改了一处设计:注册用 `Effect.serviceOption` 而非 require —— 把 Readiness 变成硬需求
   会传染到每一个提供 `context.services` 的测试 harness,而「一个只想要数据库的套件不必知道
   就绪探针这个概念」正是本次要拆的耦合,方向相反而已(与 rbac 可选注册 ui authorizer 同型)。
   新增用例「无任何探针的装配 `/health/ready` 返回 200」——**这个组合在改动前根本无法构建**,
   不是漏测,是不可能。
2. ~~**LoginDrivers 注册表**~~ **已完成**:契约值形状改句柄(`register` / `forType`),auth 用
   `provideMerge(loginDriversLayer)` 连注册表一起发布(它是唯一消费者,而驱动插件要在 auth 建成
   之前有地方注册),auth-local 的整个 layer 就是 `registerLoginDriver(driver)`。删除
   `gen-login-drivers.ts`、`login-drivers.gen.ts`、`src/login-driver.ts`、`exports['./login-driver']`
   与 `qualy.loginDriver` 声明。sign-in 三处消费改请求期读。
   **发现的洞**:把 auth-local 的注册删掉,全套 336 例照绿 —— 从来没有任何测试断言 local 登录
   方式真的被提供(生成器结构性地保证了它,所以没人写)。补了一例:真实 pluginLayers 起服务、
   seed 一行 provider,断言 `/auth/login-methods` 含 local 且 component 正确;删注册即红。
3. ~~**Ui 注册表**~~ **已完成**:`Ui` 四方法(addPage / registerLayout / contribute / fillSlot)
   加批量的 `registerSurfaces`,UiManifest 改请求期读,`UiCatalog`/`gen-ui.ts`/`ui.gen.ts` 删除。
   实施中三处与方案不同:
   ①**component-keys 门禁不需要改** —— 它读的是 client 的 `components` 映射,从来不经 `ui.gen`,
   方案里那条顾虑是多余的;
   ②注册表必须走**无环子路径** `@qualy/plugin-ui-registry/server/registry`:ui-registry 的
   server 入口引用 auth 的 session-contract,贡献方再引用它就成环,TS 把一侧解析成 `any`
   (与 `server/authorizer`、`auth/server/session-contract` 同一前例);
   ③layout-default 从此需要一个 runtime entry(它确实向运行时贡献布局实现),+1 文件、-2 仓库文件。
   **又一个洞**:删掉 ping 或 layout-default 的注册,336 例照绿 —— 与 login driver 同型。补了一例
   断言真实 manifest 含 ping 的页面与 admin-shell 实现(删任一注册即红),外加三例重复声明拒绝
   (页面 id / 路径 / 布局契约),那是被删掉的生成器原来守的三条。
4. ~~**`runtime.config` 面 + auth/web 搬家**~~ **已完成**。`renderRuntimeModule` 多导出一个
   `pluginConfig`,并按需 emit `manifestDir` 锚定行(**只有真有插件收配置时才 emit**)。
   `renderRuntimeModule(resolution, modulePath)` 多一个参数 —— 相对锚点只有调用方知道模块写去哪。
   resolve 期的「config 无人读」硬失败原本只认 capability provider,现在也认 `runtime.config`。
   验收:三例(拿到自己的块且是字面量、无人收配置时生成文件不提 config、给了块但插件不收 → 拒绝)
   加真实启动 —— `login-methods` 需要 `defaultTenantSlug` 才能找到租户,它回来了就说明 auth 的
   config 导出跑通了。**注意**:测试直接注入 AuthConfig 服务(设计如此),所以 config 导出这条路
   只有真实启动会走到。
5. ~~**database config 搬家**~~ **已完成**(含生产禁 fallback)。顺带把 `LOCAL_FALLBACK` 与
   `MIGRATIONS_FOLDER` 收进零依赖的 `src/defaults.ts`——原来 CLI 侧与运行时侧各一份,靠一条
   「断言两者相等」的测试守;实现只有一份之后那条测试就不必存在了。三个 config 导出的清单校验
   一律 `onExcessProperty: 'error'`(默认是 ignore,那正好是「看起来生效、其实没人读」)。
   **教训**:默认 ConfigProvider 只读一次 `process.env`,测试里改环境变量再跑第二遍读到的还是
   第一次的值;改成显式 `ConfigProvider.fromEnv({ env })` 供给。
6. **permissions 升能力**(rbac `./assembly`、resolve 期唯一性、`layerExport`,seed 改读
   contributions,旧键硬拒)。验收:assembly-resolve 加同码冲突用例;seed 测试不变绿。
7. **entities `layerExport`** + 宿主删 `Entities`。
8. **宿主收口**:`runtime.ts` 只剩 `{ assembly }` + registries;capability-boundary 加终局
   用例 —— **纯静态装配 render 出的 runtime 模块可编译、全文不含 database**。

## 10. 风险与已答的问题

- **注册表内容在构建期被读**(时序倒置):唯一的坑,纪律 1 防;发现即 die 不了、只是空读,
  所以每个注册表的拥有方消费点在实施时逐一核对(本方案已核对三处:manifest.ts:54、
  sign-in.ts:230 改请求期;rbac index.ts:63 不能改,故 permissions 走静态)。
- **校验从 gen 期挪到 boot 期**(ui 重复 id 等):dev 常驻启动,立刻暴露;冻结门禁
  (api-surface、client-paths、catalogs)不受影响,它们读的是契约与 client 源码。
- **`Layer.mergeAll` 的并行注册**:JS 单线程,单次注册同步完成,无竞态;顺序无语义由
  纪律 3 承担。
- **hmr**:无 watch 模式,重启即重建全部注册表,无残留。
