# Cordis 4.x 非官方完全手册

> 基于 `cordis@4.0.0-rc.7`（npm `latest` 标签）的类型声明文件与实际运行验证整理。
> 所有标注「实测」的行为均在 Node.js 下运行过验证代码确认；未验证的部分会明确标注。
> 配套包版本：`@cordisjs/plugin-loader@1.0.0-rc.5`、`@cordisjs/plugin-include@1.0.4`。
> 3.x 最终版为 3.18.1；本手册以 4.x 为准，文末附 3.x → 4.x 概念对照。

---

## 1. 心智模型

Cordis 自称 Meta-Framework（元框架）：它不提供 HTTP、数据库等任何业务能力，只提供一套**插件运行时**。理解它只需要四个概念：

- **Context（上下文）**：一切 API 的入口。每个插件拿到的 `ctx` 都是从根上下文派生的、属于自己的上下文。Context 是一个 Proxy——访问 `ctx.foo` 实际上是在服务注册表里查找名为 `foo` 的服务。
- **Plugin（插件）**：一个接受 `(ctx, config)` 的函数/类/对象。系统的一切功能（包括你的业务模块）都以插件形式装载。
- **Fiber（纤程）**：插件的一次加载实例。持有状态机、配置、副作用列表。同一个插件可加载多次，产生多个 Fiber（实测确认）。
- **Service（服务）**：挂在 Context 上的共享对象，是插件之间通信的唯一正道。插件 A 提供 `ctx.database`，插件 B 声明依赖后即可使用。

一句话总结运行模型：**插件通过 inject 声明依赖的服务 → 框架根据服务可用性自动决定插件何时执行、何时回卷 → 插件产生的一切副作用登记为 effect，随 Fiber 销毁自动释放。**

---

## 2. 快速开始

### 2.1 代码内嵌启动（推荐用于测试与理解）

```ts
import { Context } from 'cordis'

const ctx = new Context()
ctx.plugin(myPlugin) // 加载插件
ctx.plugin(myService)
await ctx.plugin(another, { some: 'config' }) // 返回值可 await 至就绪
```

注意：4.x 的 `Context` 构造器不接收配置参数，也没有 `ctx.start()`——插件加载即生效（3.x 需要 `start()` 触发 ready 事件，4.x 已移除该模式）。

### 2.2 CLI + cordis.yml 启动（生产装配方式）

`cordis` 包自带 bin，其源码逻辑（实读）：

```js
const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'
await ctx.plugin(Loader) // @cordisjs/plugin-loader
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml' }, // 从 cordis.yml 装配其余插件
})
```

即：安装 `cordis` + `@cordisjs/plugin-loader` + `@cordisjs/plugin-include`，在项目根写 `cordis.yml`，然后 `npx cordis` 启动。cordis.yml 的条目格式见第 13 节。

---

## 3. Context API

### 3.1 内置服务

`new Context()` 后自带四个服务（见 `context.d.ts`）：

| 属性           | 类型              | 职责                                             |
| -------------- | ----------------- | ------------------------------------------------ |
| `ctx.events`   | `EventsService`   | 事件注册与五种派发模式                           |
| `ctx.logger`   | `LoggerService`   | 日志（可调用：`ctx.logger('name')` 得子 logger） |
| `ctx.reflect`  | `ReflectService`  | 服务注册表：get/set/provide/accessor/mixin       |
| `ctx.registry` | `RegistryService` | 插件注册表：plugin/inject 与 Runtime 管理        |

另有 `ctx.fiber`（当前上下文关联的 Fiber）与 `ctx.root`（根上下文，标注 experimental）。`ctx.effect` 实为 `ctx.fiber.effect` 的委托。

事件方法（`on/once/emit/parallel/serial/bail/waterfall`）通过 mixin 从 `ctx.events` 平铺到 ctx 上（源码实证：`this.mixin("events", [...])`），因此 `ctx.on(...)` 与 `ctx.events.on(...)` 等价。

### 3.2 上下文操作

```ts
ctx.extend(meta?)                 // 以当前上下文为原型派生新上下文，meta 属性合并进去
ctx.isolate(name, label?)        // 服务隔离：新上下文中名为 name 的服务与外界隔离（多租户/多实例场景）
ctx.intercept(name, config)      // 对某服务注入本上下文生效的拦截配置（如 logger 的 name/level）
Context.is(value)                // 判断是否为 Context
```

`isolate`/`intercept` 本手册未做行为实测，语义以 d.ts 与 Koishi 3.x 经验推断，重度使用前请自行验证。

### 3.3 属性访问的真相

Context 是 Proxy（`ReflectService.handler`）。`ctx.foo`：

- 若 `foo` 是已注册服务 → 返回服务实例（且经 `getTraceable` 包装，服务内部拿到的 `this.ctx` 是**访问方**的上下文，实现调用溯源）。
- 若未注册 → `undefined`（`ctx.get(name, strict)` 的 strict 模式差异见第 11 节）。
- 下划线开头、数字、`prototype`/`then` 等为保留字，不走服务查找（源码 `isSpecialProperty`）。

---

## 4. 插件

### 4.1 三种形态

```ts
// 函数插件
function plugin(ctx: Context, config: Config) {
  /* ... */
}

// 类插件（构造器即入口；Service 子类属于此类）
class MyPlugin {
  constructor(ctx: Context, config: Config) {
    /* ... */
  }
}

// 对象插件
const plugin = {
  apply(ctx: Context, config: Config) {
    /* ... */
  },
}
```

### 4.2 插件元属性（`Plugin.Base`）

```ts
interface Base<T> {
  name?: string // 显示名（日志、调试）
  Config?: StandardSchemaV1<any, T> // 配置校验器（Zod 4 直接可用，见第 5 节）
  inject?: Inject // 依赖声明：['db', 'server'] 或 { db: true, logger: {...配置} }
  provide?: string | string[] // 声明提供的服务名（配合 ctx.provide/Service）
  intercept?: Dict<boolean>
}
```

### 4.3 加载、就绪与卸载

```ts
const fiber = ctx.plugin(plugin, config) // 返回 Fiber & PromiseLike<Fiber>
await fiber // 等待至激活（实测：await 返回时插件体已执行）
await fiber.dispose() // 卸载：释放全部 effect，状态置 DISPOSED(4)
```

实测确认的关键行为：

- **依赖门控**：`inject` 声明的服务未就绪时，`ctx.plugin()` 返回的 Fiber 停在 `PENDING(0)`，插件体**不执行**；服务就绪后自动执行。
- **多实例**：同一插件加载两次 → `ctx.registry.get(plugin).fibers.length === 2`，各自持有独立 config。这是 3.x fork/reusable 机制的 4.x 替代：多实例是原生能力，无需特殊标记。
- **注册表**：`ctx.registry` 提供 `get/has/delete/keys/values/entries/forEach`，以插件函数为 key，值为 `Plugin.Runtime`（含 `fibers` 列表与 `Config`）。

### 4.4 作用域注入：`ctx.inject`

不想写完整插件、只想在某些服务就绪后执行一段代码：

```ts
ctx.inject(['database', 'server'], (ctx) => {
  // database 与 server 均可用时执行；任一消失时整段回卷
})
```

返回同样是 `Fiber & PromiseLike<Fiber>`。它就是匿名插件的语法糖。

### 4.5 `Inject` 装饰器

`registry.d.ts` 导出了 `Inject(name, config?)` 装饰器（TC39 标准装饰器签名，可用于类与类方法），用于在类插件上声明依赖。本手册未实测其行为，装饰器环境配置（TS `experimentalDecorators` 与标准装饰器的差异）请自行验证后再用于生产。

---

## 5. 配置校验：Standard Schema 与 Zod 直连

`Plugin.Config` 接受任何实现 [Standard Schema V1](https://github.com/standard-schema/standard-schema) 的校验器。**Zod ≥3.24（含 Zod 4）原生实现该规范**，因此：

```ts
import { z } from 'zod'

function sandbox(ctx: Context, config: SandboxConfig) {
  /* ... */
}
sandbox.Config = z.object({
  timeoutMs: z.number().int().positive().default(1000),
  memoryMb: z.number().int().max(512).default(64),
})
```

实测行为：

- 合法配置：`.default()` 生效，插件收到的是**解析后**的对象（传 `{ timeoutMs: 3000 }` 收到 `{ timeoutMs: 3000, memoryMb: 64 }`）。
- 非法配置：加载时抛 `ValidationError extends TypeError`，携带 Standard Schema 的 `issues` 数组。
- 相关导出：`resolveConfig(runtime, config)` 为内部校验入口；`Plugin.Transform<S, T>`（`schema?: true` + 函数式 `Config`）提供纯函数变换配置的旁路，未实测。

对全 Zod 技术栈的意义：插件配置、oRPC 契约、表单校验共用一套 schema 语言，cordis.yml 里的配置错误在装配期即被拦截。

---

## 6. 依赖注入与服务提供的四种方式

按重量从轻到重：

1. **`ctx.provide(name, value)`**：直接挂一个值/对象为服务。返回释放函数；实测释放后 `ctx.get(name)` 为 `undefined`，依赖它的插件回卷。适合常量、简单对象。
2. **`ctx.set(name, value)` / `ctx.get(name)`**：更底层的读写（provide 内部即 set + 可释放包装）。
3. **`ctx.accessor(name, { get, set? })`**：定义计算属性型服务。
4. **`Service` 抽象类**：见第 7 节，正式领域服务的标准写法。

消费方统一通过 `inject` 声明 + `ctx.名字` 访问。**类型安全靠声明合并**，这是 cordis 工程中最重要的约定：

```ts
declare module 'cordis' {
  interface Context {
    database: DatabaseService
    server: ServerService
  }
  interface Events {
    'batch/settled'(batchId: string): void
  }
}
```

建议每个插件包在自己的入口文件里合并自己提供的服务与事件类型，消费方 import 该包即获得类型。

---

## 7. Service 抽象类

```ts
import { Context, Service } from 'cordis'

export class Gradebook extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gradebook') // 第二参数为服务名：注册为 ctx.gradebook
  }
  async getMajorFirstAttempts(uid: string, term: string) {
    /* ... */
  }
}
```

实测：`ctx.plugin(Gradebook)` 后 `ctx.gradebook` 即可用（构造完成即注册），依赖它的 PENDING 插件被自动唤醒。

`service.d.ts` 上的生命周期与扩展符号（覆写方式为计算属性名 `[Service.init]() {...}`）：

| 符号                    | 作用                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Service.init`          | 异步初始化钩子。生态实证：include 插件的 `[Service.init]` 是一个 **AsyncGenerator**，即初始化过程本身可以 yield 释放函数（与 effect 生成器同构）。**依赖门控在 init 完成后才放行**；构造器里注册的 async effect 不会阻塞依赖方激活（实测，异步初始化必须放这里，见 notes/cordis.md） |
| `Service.check`         | 就绪检查，返回 boolean（loader 实现了它）                                                                                                                                                                                                                                            |
| `Service.config`        | 声明该服务的 Intercept 配置类型（供 `ctx.intercept(name, ...)` 用）                                                                                                                                                                                                                  |
| `Service.invoke`        | 让服务实例本身可调用（LoggerService 借此实现 `ctx.logger('name')`）                                                                                                                                                                                                                  |
| `Service.extend`        | 派生服务实例                                                                                                                                                                                                                                                                         |
| `Service.resolveConfig` | 自定义配置合并逻辑                                                                                                                                                                                                                                                                   |
| `symbols.filter`        | 控制服务在哪些上下文可见（protected 方法）                                                                                                                                                                                                                                           |

---

## 8. Fiber：状态机与热插拔

### 8.1 状态机（`fiber.d.ts`）

```
PENDING(0) → LOADING(1) → ACTIVE(2)
                 ↓            ↓
              FAILED(3)   UNLOADING(5) → DISPOSED(4)
```

实测的状态转换：

- 依赖未满足：停在 `PENDING(0)`，不执行插件体。
- `await fiber` 返回后微任务内可能仍读到 `LOADING(1)`，让出一个宏任务后稳定为 `ACTIVE(2)`。判断就绪请 `await fiber` 或 `fiber.await()`，不要轮询 `state`。
- `fiber.dispose()` 后为 `DISPOSED(4)`。
- **依赖消失的联动（核心特性）**：卸载被依赖的服务插件后，依赖方的全部 effect 被释放、状态**回卷到 `PENDING(0)`**（不是 DISPOSED）；重新提供服务后，依赖方**自动重新执行**插件体、回到 ACTIVE。整个过程无需任何手写协调代码。

### 8.2 Fiber API

```ts
fiber.await(): Promise<this>       // 等待就绪
fiber.restart(): Promise<void>     // 重载（先卸后装）
fiber.update(config, noSave?)      // 更新配置。内部通过 waterfall 派发 'internal/update'，
                                   // 默认行为是替换 config 并 restart()；插件可监听该事件拦截，
                                   // 实现「不重启的配置热更」
fiber.dispose(): Promise<void>
fiber.getEffects(): EffectMeta[]   // effect 树（label + children），调试用
fiber.name / fiber.state / fiber.config / fiber.runtime / fiber.parent
```

`CordisError.Code.INACTIVE_EFFECT`：在非活动上下文上创建 effect 会抛出此错——意味着 effect 只能在插件体或其生命周期内注册，不要在 setTimeout 等游离回调里裸调 `ctx.effect`。

---

## 9. Effect：副作用托管

一切「创建了就需要撤销」的动作——注册路由、启动定时器、往注册中心写入题型、建立连接——都必须包成 effect：

```ts
ctx.effect(() => {
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer) // 返回释放函数
}, 'tick-timer') // 可选 label，出现在 getEffects() 里
```

三种形态（`fiber.d.ts` 的 `Effect` 类型）：

- **同步**：`() => dispose` 返回单个释放函数。
- **生成器**：`function* () { yield d1; yield d2 }` 多段资源逐步创建、逐个登记。实测释放顺序为 **LIFO（后创建先释放）**——与资源依赖的自然顺序一致（先建的最后拆）。
- **异步**：`async () => dispose` 或 async generator。异步 effect 的返回值是 `AsyncDisposable`（PromiseLike 的释放器）。

重要实证：**事件监听本质也是 effect**。源码中 `EventsService.register` 直接调用 `ctx.fiber.effect(...)` 登记监听器，因此插件卸载时其注册的所有监听自动移除（实测确认：dispose 后 emit 不再触发）。同理，Service 的注册、provide 的提供也都是 effect。这就是「插件可以被干净卸载」的机制根基。

---

## 10. 事件系统

### 10.1 注册

```ts
const off = ctx.on('event/name', listener, options?)   // 返回取消函数
ctx.once('event/name', listener)                        // 一次性
// options: boolean（旧式 prepend 简写）或 { prepend?: boolean, global?: boolean }
```

实测：`prepend: true` 的监听器先于普通监听器执行。`global` 未实测（推断为跨 isolate 边界可见）。

### 10.2 五种派发模式（全部实测）

| 方法        | 同步性     | 语义                                                | 实测结果                                                     |
| ----------- | ---------- | --------------------------------------------------- | ------------------------------------------------------------ |
| `emit`      | 同步       | 广播，忽略返回值                                    | 全部执行                                                     |
| `parallel`  | 异步       | `Promise.all` 式并发                                | 全部执行                                                     |
| `bail`      | 同步       | 依次调用，**首个非 undefined 返回值即为结果并停止** | 三个监听器返回 `undefined/'B'/'C'`，结果 `'B'`，第三个不执行 |
| `serial`    | 异步       | bail 的异步版：依次 await，首个非空即停             | 同上，返回 `'S2'`                                            |
| `waterfall` | 同步调用链 | **洋葱中间件**，详见下                              | 见下                                                         |

**waterfall 的真实语义（源码 + 实测）**：

```ts
ctx.waterfall(name, ...args, inner)
```

- 最后一个实参 `inner` 是「最内层默认实现」（函数）。
- 每个监听器的签名是 `(...args, next)`——原始参数原样传入，末尾追加 `next()` 续体。
- 监听器可以在调用 `next()` 前后加逻辑、改参数（args 是共享数组）、或干脆不调 `next()` 实现拦截。
- 框架自身的用法即范本：`fiber.update()` 内部执行
  `ctx.waterfall(fiber, 'internal/update', config, noSave, () => { 替换配置并 restart })`，
  插件监听 `'internal/update'` 即可拦截配置变更、实现免重启热更。

注意：waterfall **不是**「返回值接力」——不要按 reduce 的直觉使用它。

### 10.3 thisArg 重载

五种派发方法均支持首参传入 thisArg：`ctx.emit(someObj, 'name', ...args)`，监听器内 `this` 即为该对象（`Events` 接口里用 `this:` 标注）。`internal/update` 的 `this` 就是 Fiber。

### 10.4 内部事件（`events.d.ts`）

| 事件                            | 触发时机                                             |
| ------------------------------- | ---------------------------------------------------- |
| `internal/plugin`               | Fiber 创建/注销时                                    |
| `internal/status`               | Fiber 状态变更（参数含旧状态）——做插件管理面板就靠它 |
| `internal/service`              | 服务上线/下线                                        |
| `internal/update`               | `fiber.update()` 时（waterfall，可拦截）             |
| `internal/get` / `internal/set` | 服务读写兜底（waterfall 式 next）                    |
| `internal/listener`             | 新监听器注册时                                       |
| `internal/dispatch`             | 任意事件派发时（做事件追踪/调试器）                  |

### 10.5 事件类型扩展

```ts
declare module 'cordis' {
  interface Events {
    'submission/created'(submission: Submission): void
    'review/intercept'(task: ReviewTask, next: () => void): void // waterfall 用
  }
}
```

---

## 11. Reflect 服务

```ts
ctx.get(name, strict?)      // strict=true 时仅返回「已实现」的服务（check 通过），否则宽松返回
ctx.set(name, value)
ctx.provide(name, value?)   // 返回释放函数（本质是登记为 effect）
ctx.accessor(name, { get, set? })
ctx.mixin(source, ['method1', 'method2'])   // 把服务方法平铺到 ctx；官方注释警告勿滥用（命名冲突）
```

内部还有 `trace/bind/notify` 等方法（服务变更通知、可追溯包装），属框架内部机制，业务不直接用。

---

## 12. 内置 Logger

```ts
ctx.logger.info('hello %s', name) // error / info / warn / debug 四级
const log = ctx.logger('gradebook') // 命名子 logger（Service.invoke 机制）
log.warn('...')
```

- 默认无输出——需要挂 exporter。开发期直接用 `@cordisjs/plugin-logger-console` 插件（注意不是 `@cordisjs/logger-console`，后者不存在；`@cordisjs/logger` 是 3.x 旧包）；或自定义：`ctx.logger.exporter({ export(message) { ... } })`（返回释放函数）。
- `ctx.intercept('logger', { name, level })` 可在子上下文里改写日志名与级别（LoggerService.Intercept）。
- `Message` 结构含 `sn/ts/name/type/level/args` 与产生日志的 fiber 弱引用——按插件聚合日志就靠它。

---

## 13. 生态包与 cordis.yml

| 包                                | 用途                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@cordisjs/plugin-loader`         | 配置驱动的插件装载（EntryTree：条目树、增删改、写回）                                                       |
| `@cordisjs/plugin-include`        | 读取 cordis.yml/JSON 并交给 loader；支持 `initial`（首次生成的默认配置）与 `patches`                        |
| `@cordisjs/plugin-hmr`            | 开发期热重载：文件变更 → 对应 Fiber restart（配合依赖联动，改一个服务全链路自动重載）                       |
| `@cordisjs/group`                 | 插件分组（组内可整体启停）                                                                                  |
| `@cordisjs/plugin-timer`          | `ctx.setTimeout/setInterval/debounce` 等托管定时器（自动随 fiber 清理；注意 `@cordisjs/timer` 是 3.x 旧包） |
| `@cordisjs/plugin-logger-console` | 控制台日志 exporter                                                                                         |
| `create-cordis`（`create` 包）    | 脚手架                                                                                                      |

**cordis.yml 条目结构**（实读 loader 的 `EntryOptions` + isolate 扩展）：

```yaml
- id: a1b2c3 # 条目唯一 id（loader 生成/维护，手写可省略让其补全）
  name: '@qualy/plugin-server' # 插件包名或路径（经模块解析加载）
  config:
    port: 3000
  disabled: false # 停用但保留配置
  inject: null # 覆写注入声明（可选）
  group: false # 是否为分组节点
  intercept: null # 可选：注入拦截配置
  isolate: null # 可选：服务隔离映射 Dict<true | string>
- id: d4e5f6
  name: '@qualy/plugin-gradebook'
```

要点：loader 是**双向**的——`loader.write()` 会把运行期对条目的修改写回配置文件（Koishi 控制台在线装卸插件即基于此）。对「启动前选装插件组装系统」的方案而言，cordis.yml 就是装配清单：选装 = 增删条目。

---

## 14. 3.x → 4.x 概念对照（Koishi / Hydro 背景读者）

| 3.x                                  | 4.x                                             | 说明                          |
| ------------------------------------ | ----------------------------------------------- | ----------------------------- |
| `ctx.using(deps, cb)` / `using` 属性 | `inject`（属性或 `ctx.inject()`）               | 语义相同                      |
| `EffectScope` / `ctx.scope`          | `Fiber` / `ctx.fiber`                           | 状态机重设计（六态）          |
| fork 事件 / `reusable` 标记          | （移除）多次 `ctx.plugin()` 天然多实例          | Runtime.fibers 列表           |
| `ctx.lifecycle`                      | `ctx.events`                                    | 派发模式增加 waterfall        |
| `ctx.start()` / ready 事件           | （移除）加载即生效                              | 异步初始化用 `[Service.init]` |
| Schema（schemastery）配置            | Standard Schema（Zod 等直连）                   | 重大改进                      |
| `Service` 的 `start()/stop()`        | `[Service.init]`（支持 AsyncGenerator）+ effect | 生命周期统一到 effect 模型    |
| `ctx.plugin` 返回 fork               | 返回 `Fiber & PromiseLike<Fiber>`               | 可直接 await                  |

---

## 15. 实践守则

1. **effect 纪律**：任何有「撤销」概念的操作必须走 `ctx.effect`；review 代码时看到裸 `setInterval`、裸路由注册就是 bug。
2. **版本锁定**：rc 阶段精确锁 `"cordis": "4.0.0-rc.7"`（不带 `^`），升级手动验证。
3. **声明合并集中**：每个插件包在入口统一 `declare module 'cordis'`，杜绝散落。
4. **单测模式**：每个插件配一个最小测试——`new Context()` → 装依赖桩（`ctx.provide` 假服务）→ 装被测插件 → 断言 → `dispose()` → 断言资源释放。Context 天然隔离，无需 mock 框架。
5. **不要轮询 state**：就绪判断用 `await fiber`；状态展示才读 `fiber.state`。
6. **服务命名即契约**：`inject` 按名字匹配，跨包重名即冲突；建议统一前缀规划（如业务域名作为服务名）。

## 16. 附录：本手册的验证方法

- 类型面：解包 `cordis-4.0.0-rc.7.tgz`，通读 `lib/*.d.ts`（context/events/fiber/logger/reflect/registry/service/utils 共 8 个文件，全部 API 面均已覆盖于上文）。
- 行为面：Node 22 下运行 4 组冒烟测试，覆盖：服务注册与依赖门控、热插拔联动（卸载回卷 PENDING/恢复自动重载）、Zod Config 校验与默认值、五种派发模式语义、waterfall 洋葱链、prepend、provide 释放、生成器 effect LIFO 释放、多实例 fibers 计数、监听器随 fiber 自动清理、dispose 后状态码。
- 生态面：解包 plugin-loader 与 plugin-include，实读 `EntryOptions`、`Include.Config`、`Loader` 类签名与 `cordis` bin 源码。
