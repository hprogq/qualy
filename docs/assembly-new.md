你再看一下main分支。你就看ping包，感觉每个插件都变得好复杂，本来寻思每个插件都用一个src/index.ts来表示，在Cordis中可以直接：

ctx.ui.addPage(...);
ctx.db.addSchema(...);
ctx.permission.add(...);
ctx.server.addHandler(...);

但是在这里就需要约定每个文件的作用，然后在文件里export。能否尽可能不codegen，这属于曲线救国。既然都按照依赖顺序自动加载了，而且route和handler都是静态的值，而且也不需要cordis那种hmr重载，只在启动时装配一次，我觉得完全可以自动装配吧。我觉得改成Effect之后，插件的装配变得异常复杂，插件本身也变得很复杂，还是看ping插件，我们对比一下：

文件index.ts：

// Effect

import { Config, Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { registerSurfaces, type Ui } from '@qualy/plugin-ui-registry/server/registry'
import { ADMIN_SHELL, PUBLIC, defineSurfaces } from '@qualy/ui-contract'
import { entityManager, kyselyOf, query, withDatabase } from '@qualy/plugin-database/server'
import { pingApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { pingNavigationLabel } from './messages.ts'
import { pingPage } from './pages.ts'

// The plugin. This file is its entry - what the assembly builds - and reads
// as a list of what it puts where: a screen into the shell, an api group's
// handlers, nothing else. Identities that other runtimes need (the page for
// the browser, the entity tuple for the CLI) live in their own leaf modules,
// because importing this one drags in everything above.

// The local API exists so this plugin can implement its group without
// importing the aggregate that contains it; see QUALY_API_ID. It carries the
// same prefix as the aggregate because routes are built from this one.
const local = HttpApi.make(QUALY_API_ID).add(pingApiGroup).prefix(QUALY_API_PREFIX)

const closure = [...entities] as const

export const apiHandlers = HttpApiBuilder.group(local, 'ping', (handlers) =>
Effect.gen(function* () {
// read once while the layer is built, not per request: a greeting that is
// configured wrong should stop the assembly rather than fail requests
const greeting = yield* Config.string('PING_GREETING').pipe(Config.withDefault('hi'))
// taken while the group is built, so the handler carries no requirement
const withDb = yield* withDatabase
return handlers.handle(
'hello',
Effect.fn('ping.hello')(function* ({ query: request }) {
const visitor = request.name ?? 'world'
// the endpoint declares no failure, so a database that is down is a
// defect: a 500 and a logged cause, not a shape the client must handle
yield* withDb(
Effect.gen(function* () {
const em = yield* entityManager<typeof closure>()
yield* query(() =>
kyselyOf(em).insertInto('PingLog').values({ name: visitor }).execute(),
)
}),
).pipe(Effect.orDie)
return { msg: `${greeting}, ${visitor}` }
}),
)
}),
)

/** the screen this plugin puts in the shell; its api is the export above */
export const layer: Layer.Layer<never, never, Ui> = registerSurfaces(
defineSurfaces({
pages: [
{
page: pingPage,
component: 'ping/PingPage',
layout: ADMIN_SHELL,
// the demo endpoint is deliberately open; a real plugin would gate this
visibility: PUBLIC,
navigation: { label: pingNavigationLabel, order: 10 },
},
],
}),
)

// Cordis

import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { z } from 'zod'
import type { ApiContext } from '@qualy/plugin-server'
import type {} from '@qualy/plugin-ui-registry'
import { pingContract } from './contract.ts'
import { pingLogs } from './db/schema.ts'

export const name = 'ping'
export const inject = ['db', 'server', 'ui']

export const Config = z
.object({
greeting: z.string().default('hi'),
})
.prefault({})

export function apply(ctx: Context, config: z.infer<typeof Config>) {
ctx.logger.info('ping plugin loaded: %s', config.greeting)
ctx.effect(() => {
const timer = setInterval(() => ctx.logger.info('heartbeat'), 30_000)
return () => clearInterval(timer)
}, 'heartbeat-timer')

ctx.ui.addPage({
path: '/ping',
component: 'PingPage',
layout: 'admin',
public: true,
nav: { label: 'Ping', order: 10 },
})

const impl = implement(pingContract).$context<ApiContext>()
  ctx.server.contribute(
    'ping',
    impl.router({
      // services are reached through the plugin's own ctx (inject-checked);
      // ApiContext.cordis carries request plumbing, not service access
      hello: impl.hello.handler(async ({ input }) => {
        const visitor = input.name ?? 'world'
        await ctx.db.drizzle.insert(pingLogs).values({ name: visitor })
        return { msg: `${config.greeting}, ${visitor}` }
}),
}),
)
}

我也想做一个装配器，但是它跟我说：我先把 handler 直接并进了各插件的 layer(彻底"插件自带 api")。编译器立刻揪出一个真实的环:ui-registry 的 manifest handler 请求期要 auth 的 viewer 中间件,而 auth 构建期依赖 ui-registry 的注册表。构建图无环、请求图有环。读上游源码确认(HttpApiBuilder.ts 的 HandlerRequirements、HttpRouter.ts:770-795):中间件需求是真实 R 不是幻影标记,group 层必须组合在全部插件服务之上;而 Layer 代数没有不动点,provide(x, x) 会把 x 自己的需求重新并进来,自闭合不成立。

所以聚合有结构性理由存在 —— 但它可以不是独立文件,现在住在 runtime.gen 里,下一步装配器会把它一起吃掉。

我也是没有办法了，你帮我看看有没有什么办法么

你的判断基本正确。当前 `main` 的 ping 已经说明问题：

> 复杂的不是 ping 业务，而是插件作者被迫亲自参与了 Effect Layer 编排、HttpApi 闭合、数据库类型闭包和静态聚合协议。

当前 ping 的实际业务只有三件事：

1. 声明一张 `PingLog` 表；
2. 注册一个 `/ping` 页面；
3. 实现一个 `hello` 接口并写入日志。

但 `src/index.ts` 需要处理：

- 本地 `HttpApi` 重建；
- `HttpApiBuilder.group`；
- `Layer` 输出；
- `Ui` requirement；
- `registerSurfaces`；
- `withDatabase`；
- `entityManager`；
- `kyselyOf`；
- `query`；
- 实体 tuple closure。

package.json 还要重复声明 root、API、DB、client exports，以及 runtime entry、API entry、runtime dependencies 和 database contribution。

这确实不符合“插件入口一眼看出它向系统贡献了什么”的目标。

## 一、对方关于循环的结论：前半句正确，后半句推导过头了

他说：

> handler 不能直接并入插件自己的 Layer，因为 handler 中间件可能需要其他插件提供的服务；必须把 handler 放在所有插件服务之上组合。

这部分正确。

Effect 的 `HttpApiBuilder.group()` 返回的不是一个完全独立的 Layer。它的 requirement 包括：

- handler 本身使用的服务；
- endpoint middleware；
- middleware 提供或要求的服务；
  -构造 handler builder 时使用的服务。

官方源码中的返回类型明确是：

```ts
Layer.Layer<
  HttpApiGroup.Service<ApiId, Identifier>,
  Handlers.Error<Return>,
  Exclude<Handlers.Context<Return>, Scope.Scope>
>
```

而 `HandlerRequirements` 会把 middleware 和 middleware services 纳入 requirement。

所以这种组合确实可能形成：

```text
auth 服务 Layer
  └─ 为了注册 UI，需要 Ui

ui-registry API handler
  └─ 为了 viewer middleware，需要 Auth

Auth → Ui
Ui handler → Auth
```

把 handler 强行塞进 `ui-registry.layer`，Layer 图就无法闭合。

但是，这只能推出：

> handler 的最终构建必须发生在完整服务图之上。

不能推出：

> 必须分别导出 `layer` 和 `apiHandlers`，再用 TypeScript codegen 静态聚合。

“必须有聚合阶段”和“必须生成一个聚合文件”是两件事。

当前实现已经把两者混在一起：`runtime.gen.ts` 静态 import 每个插件的 `layer` 和 `apiHandlers`，先组合 plugin layers，再把 handlers 提到完整服务图上。

**这个分层时序是必要的，但生成文件不是必要的。**

---

# 二、真正合适的模型：两阶段插件描述器

建议不要重新实现 Cordis 的运行时可变 `ctx`，而是实现一个外观接近 Cordis、内部是声明式的插件构建器。

分成两个阶段。

## 阶段 1：声明阶段

加载每个插件的 root entry，但不启动任何服务、不打开数据库、不构建 handler。

插件只提交描述：

```text
实体
权限
UI 页面
API group
API handler factory
配置 schema
运行时 Layer
生命周期 hook
依赖
```

`ctx.ui.addPage()` 在这一阶段不是访问一个 Effect service，而只是向插件描述器里追加一条纯数据。

`ctx.db.addSchema()` 不是修改数据库，而只是记录实体 tuple。

`ctx.server.addHandler()` 不是立即构建 handler Layer，而是记录一个稍后执行的 handler factory。

## 阶段 2：构建阶段

装配器拿到全部描述后：

```text
1. 收集实体、权限、UI、API groups
2. 构造 capability services
3. 按依赖顺序构建插件 service Layers
4. 所有 service Layers 完成后，构建 API handler Layers
5. 把 handlers 提供给 HttpApiBuilder
6. 最后绑定端口
```

这样既符合 Effect 的 requirement 模型，也不要求插件作者了解最终 Layer 如何闭合。

---

# 三、ping 应该可以写成什么样

目标可以接近下面这种形式：

```ts
import { Config, Effect } from 'effect'
import { definePlugin } from '@qualy/plugin-kit'
import { pingApiGroup } from './api.ts'
import { PingLog } from './db.ts'

export default definePlugin('ping', (ctx) => {
  const config = ctx.config({
    greeting: Config.string('PING_GREETING').pipe(Config.withDefault('hi')),
  })

  const db = ctx.db.addSchema([PingLog] as const)

  ctx.ui.addPage({
    path: '/ping',
    component: 'ping/PingPage',
    layout: 'admin',
    public: true,
    navigation: {
      label: 'Ping',
      order: 10,
    },
  })

  ctx.server.addGroup(pingApiGroup, 'ping', (handlers) =>
    Effect.gen(function* () {
      const { greeting } = yield* config

      return handlers.handle(
        'hello',
        Effect.fn('ping.hello')(function* ({ query }) {
          const visitor = query.name ?? 'world'

          yield* db.execute((kysely) =>
            kysely.insertInto('PingLog').values({ name: visitor }).execute(),
          )

          return {
            msg: `${greeting}, ${visitor}`,
          }
        }),
      )
    }),
  )
})
```

表面上与 Cordis 接近：

```ts
ctx.db.addSchema(...)
ctx.ui.addPage(...)
ctx.server.addGroup(...)
```

但内部语义不同：

- `addSchema`：记录数据库声明；
- `addPage`：记录 UI 描述；
- `addGroup`：记录 API group 和 handler factory；
- `db.execute`：在请求时取得 ambient transaction manager；
- 最终 Layer 闭合由装配器完成。

这里最重要的是：

```ts
ctx.server.addGroup(...)
```

不把 group Layer 立即 merge 进插件 service Layer。

它只是保存：

```ts
{
  group: pingApiGroup,
  identifier: "ping",
  buildHandlers: ...
}
```

等全部插件服务都存在后，装配器才运行：

```ts
const handlerLayers = descriptors.flatMap((plugin) => plugin.apiHandlers)

const handlers = Layer.mergeAll(...handlerLayers)

const apiRoutes = HttpApiBuilder.layer(runtimeApi).pipe(
  Layer.provide(handlers),
  Layer.provide(allPluginServices),
)
```

因此中间件需要 Auth，handler 需要 Org、Rbac 或 Database，都不会反向污染插件服务构建图。

---

# 四、这个模型如何消除你现在遇到的环

当前环的根本原因不是“UI 和 Auth 在业务上循环依赖”，而是：

> 静态 UI 声明被实现成了运行时 service registration。

auth 为了注册一个页面，需要 `Ui` service：

```text
Auth service Layer → Ui
```

与此同时，Ui API handler 的 viewer middleware 又需要 Auth：

```text
Ui handler Layer → Auth
```

如果 UI 页面只是插件描述器里的静态声明，auth 的 service Layer 就不需要 Ui：

```text
声明阶段：
Auth descriptor → page declaration

服务阶段：
Auth service 不再要求 Ui

handler 阶段：
Ui handler → Auth
```

环自然消失。

同样的方法可以用于：

- permissions；
- database entities；
- UI surfaces；
- API groups；
  -非 API routes；
- login driver definitions。

这些都是“装配开始前可以收集的静态声明”，不需要先构建插件 Layer 再注册。

当前 `Assembled` barrier 是为了在所有 Layer 注册完成后再读取完整 catalog。

采用描述器后，完整 catalog 在构建任何 Layer 之前就已经存在：

```text
load descriptors
→ complete permission catalog
→ build Rbac
```

`Assembled` 可以只保留给真正的启动后工作，例如：

- 镜像或校验外部状态；
  -预热缓存；
  -执行依赖已绑定的 boot hook。

不再承担静态装配数据收集。

---

# 五、服务器侧可以基本去掉 codegen

当前选择静态生成 `runtime.gen.ts` 的主要理由是：

- 静态 import 能在构建期发现缺包；
- bundler 能看到依赖；
  -组合后的 Layer 能进行全局 TypeScript 检查。

但当前服务器是 Node 进程，通过已安装的 workspace/npm 包运行，并不是打成一个单文件 server bundle。在这个前提下，完全可以：

```ts
const pluginModules = await Promise.all(
  resolution.runtimePlugins.map(async (id) => {
    const url = resolver.resolveModuleUrl(id)
    const module = await import(url)
    return decodePluginDescriptor(id, module.default)
  }),
)
```

项目当前已经在装配 CLI 中动态 import capability provider，所以动态加载插件描述器并不是一个全新的技术方向。

服务器侧可以取消：

```text
runtime.gen.ts
entities.gen.ts
permissions.gen.ts
routes.gen.ts
```

改为运行时收集：

```text
plugin.database.entities
plugin.permissions
plugin.routes
plugin.runtime.layer
plugin.api.handlers
```

迁移 CLI 同样可以加载 descriptor：

```text
qualy generate
→ load plugin descriptors
→ collect retained database declarations
→ MikroORM schema diff
```

不需要生成 `entities.gen.ts` 才能知道有哪些实体。

---

# 六、API 的 codegen 也不是绝对必要

当前 `gen-api.ts` 的理由是：

> 全局 API 类型和客户端方法签名需要编译期 aggregate，因为类型在运行时不存在。

这句话在“整个系统只有一个全局 typed client”的前提下成立。

但更符合插件化的方式是：

```text
每个插件拥有自己的 API group
每个插件客户端使用自己的 typed client
宿主只提供通用 transport
```

例如 ping 客户端只导入：

```ts
import { pingApiGroup } from '@qualy/plugin-ping/api'
```

然后构造 ping client。

宿主 shell 不需要知道 `hello` 方法的类型；只有 PingPage 需要知道。

服务端启动时可以把所有 `HttpApiGroup` runtime value 聚合成一个 API。这里会在装配器内部有一次类型擦除：

```ts
let api: HttpApi.Top = HttpApi.make(QUALY_API_ID)

for (const plugin of plugins) {
  for (const group of plugin.api.groups) {
    api = api.add(group as never)
  }
}
```

这个 cast 被限制在 assembly 内部。插件自己的 group、handler 和 client 仍然保持完整类型安全。

这样可以删除：

```text
packages/api/src/api.gen.ts
全局 @qualy/api-client 方法集合
```

代价是：

- 不再拥有一个能自动列出所有插件 endpoint 的编译期 client 类型；
- 全局 API 类型错误从应用 typecheck 移到插件 descriptor 校验和启动检查。

对于真正的插件平台，我认为这是合理交换：

> 插件边界内强类型，装配边界运行时校验。

Cordis 本来也是这个模型。

---

# 七、仍然很难完全取消的 codegen：浏览器 chunk

前端是唯一真正存在结构性障碍的部分。

Node 可以：

```ts
await import('@qualy/plugin-ping')
```

浏览器经过 Vite 构建后，不能根据服务器返回的任意 npm package name 自动找到一个尚未进入 bundle graph 的模块。

因此以下二选一：

### 方案 A：保留一个很小的前端生成文件

```ts
export const clients = {
  ping: () => import('@qualy/plugin-ping/client'),
  org: () => import('@qualy/plugin-org/client'),
}
```

这是我推荐的。

最终仅保留：

```text
apps/web/src/plugins.gen.ts
```

它只做静态 lazy import，不做业务装配。

### 方案 B：每个插件独立发布浏览器 ESM bundle

服务器返回：

```json
{
  "plugin": "ping",
  "entry": "/plugins/ping/client-a71d.js"
}
```

浏览器通过 URL 动态 import。

这可以彻底去 codegen，但会引入：

- 独立插件前端构建；
- asset manifest；
  -版本和缓存治理；
- CSP；
  -共享 React/Effect 依赖；
  -跨 bundle singleton 问题。

对当前毕设规模不值得。

所以合理目标不是零 codegen，而是：

> **服务器装配零 codegen，浏览器只保留静态 chunk registry codegen。**

---

# 八、一个 `src/index.ts` 能做到什么程度

服务器插件入口完全可以只有一个：

```text
src/index.ts
```

但一个全栈插件仍可能需要少数 leaf module。

推荐最小布局：

```text
ping/
├── src/
│   ├── index.ts       # 完整插件描述
│   ├── api.ts         # 浏览器和服务器共享的纯 API schema
│   ├── db.ts          # 实体；需要被迁移 CLI 或其他插件类型引用
│   └── client/
│       └── index.tsx  # 浏览器组件
└── package.json
```

为什么不是绝对一个文件：

- 浏览器需要 import API contract，但不能因此把 MikroORM、Kysely 和服务端代码拖进 bundle；
  -其他插件可能只需要 import 数据库 entity tuple；
  -前端 chunk 必须有独立浏览器入口。

Cordis 示例本身也有：

```text
index.ts
contract.ts
db/schema.ts
```

所以真正目标应该是：

> 一个入口文件表达插件贡献；仅跨运行环境或跨插件消费的内容拆成 leaf module。

当前 ping 的：

```text
pages.ts
messages.ts
api.ts
db/entities.ts
client/index.ts
index.ts
```

可以收敛为大约四个入口，而不是让每个概念各占一个文件。

---

# 九、package.json 也可以明显缩减

当前 ping 同时维护：

```json
"exports": {
  ".": "./src/index.ts",
  "./pages": "./src/pages.ts",
  "./db": "./src/db/entities.ts",
  "./client": "./src/client/index.ts",
  "./api": "./src/api.ts",
  "./package.json": "./package.json"
}
```

和：

```json
"qualy": {
  "contributions": {
    "database": {
      "entitiesEntry": "src/db/entities.ts"
    }
  },
  "runtime": {
    "entry": ".",
    "api": "./api",
    "dependsOn": [...]
  }
}
```

如果 root default export 是完整描述器，package.json 可以只剩：

```json
{
  "name": "@qualy/plugin-ping",
  "exports": {
    ".": "./src/index.ts",
    "./api": "./src/api.ts",
    "./client": "./src/client/index.ts",
    "./package.json": "./package.json"
  }
}
```

装配信息移回插件代码：

```ts
export default definePlugin('ping', (ctx) => {
  ctx.requires(Database)
  // ...
})
```

这相当于 Cordis 的：

```ts
export const inject = ['db', 'server', 'ui']
```

而不是在 package.json 里维护第二套插件程序。

---

# 十、需要接受的取舍

动态描述器模型会损失一项当前实现很看重的能力：

```text
整个选定插件集合在 TypeScript 构建期完成全局闭合检查
```

动态 manifest 决定插件集合时，TypeScript 不可能从 YAML 字符串推导出一个精确的静态 tuple。当前 codegen 本质上是在把 runtime selection 转成 TypeScript source，使编译器能够看到它。

取消 codegen 后：

- 插件内部仍然强类型；
- handler 与 group 仍然强类型；
  -数据库 closure 仍然强类型；
  -配置仍然用 Schema 校验；
  -装配完整性改在 `pnpm qualy resolve/check` 和启动时验证；
  -缺包、缺 handler、重复 route、未满足 dependency 变成装配错误，而不是 TypeScript aggregate 错误。

这更接近 Cordis，也是插件平台常见的边界。

我认为对于 Qualy，这个交换值得做。现在为了获得“整个装配的编译期证明”，已经让每个插件承担过多框架税。

---

# 十一、建议的最终架构

```text
qualy.yml
  ↓
resolve plugin ids + lock retention
  ↓
dynamic import each plugin default descriptor
  ↓
Declaration phase
  ├── database entities
  ├── permissions
  ├── UI surfaces
  ├── API groups
  ├── route declarations
  ├── config schemas
  ├── service layers
  └── handler factories
  ↓
Capability preparation
  ├── Entities service
  ├── PermissionCatalog
  ├── UiCatalog
  └── plugin configs
  ↓
Topological service Layer build
  ↓
Build every handler Layer above complete services
  ↓
Build HttpApi / HttpRouter
  ↓
Run genuine boot hooks
  ↓
Bind port
```

最终插件作者看到的是：

```ts
export default definePlugin("ping", (ctx) => {
  const db = ctx.db.addSchema([PingLog] as const)

  ctx.ui.addPage(...)

  ctx.server.addGroup(pingApiGroup, "ping", (handlers) => ...)
})
```

而不是：

```text
一个 layer export
一个 apiHandlers export
一份 package.json runtime metadata
一份 database contribution metadata
一个 local HttpApi
一个 closure tuple
四层数据库 helper
多个生成聚合文件
```

## 最终判断

对方说“聚合有结构性理由”是正确的。

但准确表述应是：

> **Effect HttpApi handler 需要在完整服务环境上方进行一次延迟聚合。**

而不是：

> **因此必须 codegen 一个静态组合根，并要求每个插件按多个 export 协议参与。**

你可以回到接近 Cordis 的开发体验。合适的路线不是让 Effect 支持自引用 Layer，而是：

> **用纯描述阶段收集贡献，用 Effect Layer 只负责资源和执行；handler 在最后阶段统一闭合。**

建议先只拿 ping 做一个无 codegen 的 `definePlugin` 原型，同时保留现有系统作为对照。验证四件事即可：

1. ping root 只 default-export 一个 descriptor；
   2.数据库实体能被 migration CLI 动态发现；
2. UI 页面无需要求 `Ui` service 就能进入 catalog；
3. handler 在完整 plugin service Layer 上方成功闭合。

这四点通过后，当前大部分 server-side codegen 都可以逐步删除。

ctx.server.XXX这种语义是Cordis视野下的，主要以ctx、小写服务名为主，且服务名靠Typescript define声明来曲线救国。在Effect下，以Layer为基本组成，名字是Orm、UiRegistry这种，且依赖项是通过模板类型实现的，是强类型的，此时基于Effect强大的能力，你推荐插件的主体函数怎么写更好？而且Cordis实现了每个插件都要有能力注册服务，未来若有更多的数据库、更多的UI（Vue/Svelte）、更多的服务等都需要插件能够声明并提供注册能力，不能仅仅局限于UI、DB这几个服务。认真思考。

你的判断方向是对的：**Effect 下不应该复刻 `ctx.server.xxx` 这种服务定位器接口，但也不应该让插件作者直接处理 `Layer` 的闭合、handler 聚合和扩展点装配。**

更合适的模型是：

> 插件主体是一个不可变的 `Plugin` 描述值，由若干强类型 `Feature` 组成；运行时服务继续使用 `Context.Tag + Layer`，多插件贡献使用可扩展的 `ExtensionPoint`。

不是 `apply(ctx)`，也不是要求每个插件分别导出 `layer`、`apiHandlers`、`entities`、`permissions`。

当前 ping 正是把过多装配细节暴露给了插件作者：插件需要自己构造局部 HttpApi、数据库 closure、handler Layer 和 UI 注册 Layer，package.json 还要重复声明各入口。

## 一、先区分三种完全不同的东西

### 1. Service：单提供者运行时能力

例如：

```ts
Orm
Rbac
CurrentUser
UiRegistry
SearchEngine
ObjectStorage
```

它们是正常的 Effect Service：

```ts
export class SearchEngine extends Context.Tag('@qualy/search/SearchEngine')<
  SearchEngine,
  SearchEngine.Service
>() {}
```

由一个或少数明确插件提供：

```ts
const SearchEngineLive: Layer.Layer<SearchEngine, SearchStartupError, Orm | SearchConfig>
```

语义是：

```text
一个 Tag
→ 通常一个 provider
→ 其他 Layer 通过 requirement 使用
```

### 2. ExtensionPoint：一个拥有者，多个贡献者

例如：

```text
DatabaseEntities
PermissionDeclarations
UiSurfaces
HttpApiGroups
SearchIndexes
EventSubscribers
VuePages
SvelteWidgets
```

它们不是需要 `yield*` 获取的运行时服务，而是插件装配期间的开放贡献通道：

```text
一个 ExtensionPoint
→ 一个 provider 解释它
→ 任意多个插件贡献值
```

这才是 Cordis 中：

```ts
ctx.ui.addPage(...)
ctx.db.addSchema(...)
ctx.permission.add(...)
```

真正对应的抽象。

Cordis 把 Service Lookup 和 Extension Contribution 都放在 `ctx` 下；Effect 版本应该把它们分开。

### 3. Feature：插件放入装配器的一个组成部分

Feature 可以是：

- 提供一个 Service Layer；
- 向某个 ExtensionPoint 贡献；
- 提供某个 ExtensionPoint 的解释器；
- 一个所有服务构建完成后才闭合的 handler；
- 一个启动前 hook；
- 一个普通 raw route。

核心只需要知道 `Feature`，不需要知道数据库、React、Vue、Svelte、搜索引擎分别是什么。

---

# 二、插件主体不建议写成函数式 `ctx`

不建议：

```ts
export function apply(ctx: PluginContext) {
  ctx.db.addSchema(...)
  ctx.ui.addPage(...)
  ctx.server.addHandler(...)
}
```

因为这仍然意味着核心要定义一个不断膨胀的 `PluginContext`：

```ts
ctx.postgres
ctx.mongo
ctx.react
ctx.vue
ctx.svelte
ctx.search
ctx.storage
ctx.queue
ctx.ai
```

最终只是把 Cordis 服务定位器重新实现一遍。

也不建议插件直接导出：

```ts
export const layer = ...
export const apiHandlers = ...
export const entities = ...
export const permissions = ...
```

因为这把装配器的内部阶段泄漏给了插件。

我推荐插件默认导出一个单独的不可变值：

```ts
export default Plugin.define(
  '@qualy/plugin-ping',

  Postgres.entities(entities),

  ReactUi.surfaces(
    defineSurfaces({
      pages: [
        {
          page: pingPage,
          component: 'ping/PingPage',
          layout: ADMIN_SHELL,
          visibility: PUBLIC,
          navigation: {
            label: pingNavigationLabel,
            order: 10,
          },
        },
      ],
    }),
  ),

  HttpApi.group({
    group: pingApiGroup,
    identifier: 'ping',
    handlers: (handlers) =>
      Effect.gen(function* () {
        const greeting = yield* Config.string('PING_GREETING').pipe(Config.withDefault('hi'))

        return handlers.handle(
          'hello',
          Effect.fn('ping.hello')(function* ({ query }) {
            const visitor = query.name ?? 'world'

            yield* PingDatabase.query((db) =>
              db.insertInto('PingLog').values({ name: visitor }).execute(),
            )

            return {
              msg: `${greeting}, ${visitor}`,
            }
          }),
        )
      }),
  }),
)
```

这里没有：

```text
local HttpApi
HttpApiBuilder.group 的外层闭合
apiHandlers export
Layer.empty
Ui requirement
registerSurfaces Layer
entityManager<typeof closure>
kyselyOf
query
withDatabase
```

但这些机制没有消失，只是由对应能力的 Feature 构造器封装。

## 为什么是 `Plugin.define(...features)` 而不是主体函数

Effect 本身的风格更倾向于组合不可变值：

```ts
Effect
Layer
Schema
Config
Context.Tag
```

插件也适合是一个值：

```ts
Plugin<Provides, Requires, Error>
```

而不是执行注册副作用的函数。

也可以提供 pipe 风格：

```ts
export default Plugin.make("@qualy/plugin-ping").pipe(
  Plugin.add(Postgres.entities(entities)),
  Plugin.add(ReactUi.surfaces(surfaces)),
  Plugin.add(HttpApi.group(...)),
)
```

但 `Plugin.define(id, ...features)` 对插件作者更简单。

---

# 三、通用扩展点应允许任何插件定义

核心不能内置：

```text
database
ui
permissions
server
```

应该只内置一个通用协议：

```ts
export interface ExtensionPoint<
  Id extends string,
  Contribution,
  State,
  Phase extends ExtensionPhase,
> {
  readonly id: Id
  readonly phase: Phase
}
```

阶段至少分为：

```ts
type ExtensionPhase = 'prepare' | 'afterServices' | 'boot'
```

## prepare

在任何业务 Service Layer 构建之前收集和解释。

适合：

```text
数据库实体
权限声明
UI 页面描述
API contract
搜索索引定义
消息类型
事件类型
```

例如数据库插件可以定义：

```ts
export const DatabaseEntities = ExtensionPoint.make<
  readonly EntitySchema[],
  readonly EntitySchema[],
  'prepare'
>('@qualy/postgres/entities')
```

数据库插件提供其解释器：

```ts
Postgres.provideEntities({
  compile(contributions) {
    const entities = contributions.flat()
    return Layer.succeed(Entities, entities)
  },
})
```

其他插件只写：

```ts
Postgres.entities(entities)
```

核心完全不知道 `EntitySchema` 是什么。

## afterServices

所有普通 Service Layer 都已构建后才闭合。

适合：

```text
HttpApi handlers
需要完整服务环境的 raw routes
跨插件订阅处理器
RPC implementations
GraphQL resolvers
```

当前 handler 循环问题正应该由这个阶段解决。

Effect 源码确实表明，`HttpApiBuilder.group()` 的 Layer requirement 会包含 handler、endpoint middleware 和 middleware services，因此 handler 不能随意塞进某个普通插件 Layer。

但插件只需要声明：

```ts
HttpApi.group({
  group,
  handlers,
})
```

`HttpApi` 扩展点的 provider 在 `afterServices` 阶段统一执行：

```text
收集 group contracts
→ 构造 runtime HttpApi
→ 所有业务 Layer 建好
→ 构造 group handler Layers
→ 给 handlers 提供完整业务环境
→ 构造 HttpRouter
```

当前 `runtime.gen.ts` 已经在做类似的阶段拆分，只是通过要求插件分别导出 `layer` 和 `apiHandlers` 来实现。

这个阶段应该保留，导出协议不应保留。

## boot

所有服务和 after-services 扩展都准备好后运行一次。

适合：

```text
同步权限目录
预热缓存
校验外部资源
恢复消费者 offset
启动一次性 reconciliation
```

现有 `Assembled` barrier 已经提供了这个语义。

---

# 四、Service Layer 应怎样进入插件

一个插件若只贡献页面、实体和 handler，完全不需要自己的 `layer`。

ping 就是这种情况。

只有插件真正提供一个运行时服务时，才声明：

```ts
Plugin.service(SearchEngine, {
  requires: [Orm, Metrics],
  layer: SearchEngineLive,
})
```

这里的 `requires` 使用实际的 Effect Tag：

```ts
;[Orm, Metrics]
```

而不是：

```ts
;['@qualy/plugin-database', '@qualy/plugin-metrics']
```

这更符合 Effect 语义：

```text
我需要的是 Orm 服务
不是“database 这个 npm 包”
```

装配器可以建立：

```text
Context.Tag key → provider plugin
```

然后按 Tag 依赖拓扑排序。

类型签名可以保证声明与 Layer 类型一致：

```ts
function service<ProvidedTag extends AnyTag, RequiredTags extends readonly AnyTag[], E>(
  provided: ProvidedTag,
  options: {
    requires: RequiredTags
    layer: Layer.Layer<ServiceOf<ProvidedTag>, E, ServiceOf<RequiredTags[number]>>
  },
): PluginFeature
```

于是下面这种错误会在插件自身 typecheck 时被发现：

```ts
Plugin.service(SearchEngine, {
  requires: [Orm],
  // 实际还需要 Metrics
  layer: SearchEngineLive,
})
```

这解决了一个无法绕开的事实：

> TypeScript 可以检查 `Layer` 的 requirement，但运行时无法从擦除后的泛型中反射出 requirement。

动态自动装配若不使用 codegen，就必须在运行时保留一份依赖信息。最好的形式是实际 `Context.Tag` 数组，而不是 package id 字符串。

---

# 五、能力提供者也应该是普通插件

假设以后增加搜索能力。

搜索插件定义：

```ts
export const SearchIndexes = ExtensionPoint.make<SearchIndexDefinition>('@qualy/search/indexes', {
  phase: 'prepare',
})

export class SearchEngine extends Context.Tag('@qualy/search/SearchEngine')<
  SearchEngine,
  SearchEngine.Service
>() {}
```

搜索插件主体：

```ts
export default Plugin.define(
  '@qualy/plugin-search',

  Plugin.provideExtension(SearchIndexes, {
    compile(definitions) {
      return Layer.succeed(SearchIndexCatalog, makeIndexCatalog(definitions))
    },
  }),

  Plugin.service(SearchEngine, {
    requires: [Orm, SearchIndexCatalog],
    layer: SearchEngineLive,
  }),
)
```

其他任意插件：

```ts
export default Plugin.define(
  '@qualy/plugin-articles',

  Plugin.contribute(SearchIndexes, {
    name: 'articles',
    fields: ['title', 'content'],
  }),
)
```

核心不需要加入：

```ts
ctx.search.addIndex
```

也不需要发布新版本。

提供者插件可以再封装领域友好 API：

```ts
Search.index({
  name: 'articles',
  fields: ['title', 'content'],
})
```

其返回值本质上仍是一个通用 `Plugin.Feature`。

这就是开放世界设计：

```text
核心定义 Plugin 和 ExtensionPoint
能力插件定义 Feature 构造器
业务插件组合这些 Feature
```

---

# 六、多数据库、多 UI 框架怎么处理

不要定义一个无所不包的 `Database` 或 `Ui` 全局接口。

可以有：

```text
Postgres.Entities
Postgres.Migrations
Postgres.Orm

Mongo.Collections
Mongo.Migrations
Mongo.Client

ReactUi.Surfaces
ReactUi.Components

VueUi.Surfaces
VueUi.Components

SvelteUi.Surfaces
SvelteUi.Components
```

插件明确贡献给它真正支持的能力：

```ts
Plugin.define(
  "@acme/vue-report",

  VueUi.page(...),

  Postgres.entities(...),
)
```

若将来需要两个 PostgreSQL 实例，可以使用 capability instance：

```ts
export const MainDatabase = Postgres.instance('main')
export const AnalyticsDatabase = Postgres.instance('analytics')
```

得到不同的：

```text
MainDatabase.Orm
MainDatabase.Entities

AnalyticsDatabase.Orm
AnalyticsDatabase.Entities
```

仍然没有字符串服务定位器。

---

# 七、数据库访问自身也应封装成领域 Feature/Handle

当前 ping 的数据库调用暴露了四层机制：

```ts
withDatabase
entityManager
kyselyOf
query
```

这些对于数据库基础设施实现者是合理的，但不该成为每个业务插件的固定样板。

Postgres 能力可以提供一个闭包 handle：

```ts
const PingDatabase = Postgres.scope(entities)
```

然后业务侧：

```ts
yield * PingDatabase.query((db) => db.insertInto('PingLog').values({ name: visitor }).execute())
```

`PingDatabase.query()` 内部负责：

```text
取得 ambient EntityManager
→ 若存在外层事务则加入
→ getKysely()
→ 捕获 QueryFailed
```

跨插件事务语义仍然保留。

一个依赖其他插件表的插件：

```ts
const AuthDatabase = Postgres.scope(authEntities, OrgDatabase.Entities)
```

或者直接由 database contribution 的依赖图生成这个 handle，但它不应再要求插件手写 tuple closure。

---

# 八、推荐的完整装配过程

不依赖服务端 codegen 的流程可以是：

```text
1. 读取 qualy.yml 和 lock
2. 按 manifest 动态 import 每个插件的 default Plugin descriptor
3. 收集所有 ExtensionPoint providers
4. 收集所有 contributions
5. 运行 prepare 扩展点
   ├── Entities
   ├── PermissionCatalog
   ├── UiCatalog
   ├── API contracts
   └── 第三方能力自己的 catalog
6. 建立 Service Tag → provider 映射
7. 按实际 Context.Tag requires 拓扑构建普通 Service Layers
8. 构建 afterServices 扩展
   ├── HttpApi handlers
   ├── raw routes
   └── runtime subscribers
9. 执行 boot hooks
10. 绑定 HTTP 端口
```

当前项目已经动态 import capability provider，因此“装配阶段动态加载纯描述模块”并不违背现有设计。

---

# 九、哪些 codegen 仍然可能保留

服务端 runtime、entities、permissions、handlers 和 routes 都可以通过 descriptor 动态收集，不必生成 TypeScript 文件。

但有两个真正的限制。

## 1. YAML 选择出的“全局精确 TypeScript API 类型”

TypeScript 无法从运行时读取的 `qualy.yml` 推导：

```ts
type QualyApi = PingApi & OrgApi & AuthApi
```

若一定要一个全局、精确、随 manifest 变化的 typed client，则必须二选一：

- codegen；
- 宿主手工静态 import 插件。

更插件化的方案是：

```text
每个插件拥有自己的 typed client
宿主只提供 transport
OpenAPI 在运行时从所有 group value 聚合
```

这样服务器 API codegen 可以删除。

## 2. 浏览器 chunk graph

Vite 必须在构建期知道可能 import 哪些客户端模块。

因此可以只保留很小的一份：

```ts
export const pluginClients = {
  ping: () => import('@qualy/plugin-ping/client'),
  org: () => import('@qualy/plugin-org/client'),
}
```

服务端装配不再 codegen，浏览器只生成 chunk registry。

---

# 十、最终推荐的插件主体

我建议把最终风格定为：

```ts
export default Plugin.define(
  '@qualy/plugin-ping',

  Postgres.entities(entities),

  ReactUi.surfaces(surfaces),

  HttpApi.group({
    group: pingApiGroup,
    identifier: 'ping',
    handlers: pingHandlers,
  }),
)
```

提供服务的插件：

```ts
export default Plugin.define(
  '@qualy/plugin-search',

  Plugin.provideExtension(SearchIndexes, SearchIndexProvider),

  Plugin.service(SearchEngine, {
    requires: [Orm, Metrics, SearchIndexCatalog],
    layer: SearchEngineLive,
  }),

  Plugin.boot({
    name: 'search-warmup',
    run: SearchEngine.warmup,
  }),
)
```

核心原则是：

```text
Context.Tag / Layer
  表示单提供者运行时服务

ExtensionPoint
  表示多插件贡献通道

Plugin.Feature
  表示一个插件参与装配的单位

Plugin
  是 Feature 的不可变集合
```

这样既没有 Cordis 式小写 service locator，也不会要求核心提前知道所有未来能力。

当前 handler 聚合遇到的环是真实的，但解决方式不是让插件理解这条环，而是让 `HttpApi.group(...)` 成为一个 `afterServices Feature`。**阶段复杂度留在装配器里，领域插件只声明自己贡献什么。**
