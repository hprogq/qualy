# Cordis 使用教程

> 适用版本:cordis 4.0.0-rc.7。
> 本教程综合官方指南(cordis.moe)、Koishi 指南与 4.x 源码整理;官方指南部分内容基于 3.x 语义,与 4.x 存在差异之处均以「版本注记」标出,4.x 行为以实机验证为准。
> 示例以「综测系统」业务为背景。

---

## 第 1 章 · 概述

### 1.1 Cordis 是什么

Cordis 是一个**插件框架**,官方称之为元框架(meta-framework):它不提供 HTTP、数据库等任何具体能力,只解决一个问题——

> 如何把应用拆成许多可以独立安装、卸载、更换的模块,并让这些模块安全协作。

在 NestJS 中,组织单位是 Module,编译期组装、启动后固定;在 Cordis 中,组织单位是**插件**,可以在运行时装载与卸载。

### 1.2 可逆的插件系统

Cordis 的核心设计理念是**可逆性**:插件的加载引入功能,插件的卸载就必须完整撤销这些功能——注册的路由、监听器、定时器、对外提供的服务,全部随卸载自动回收。这依赖两条机制:

- 每个插件拿到的 `ctx` 都是专属上下文,通过它注册的一切都被记录在案;
- 一切副作用以 **effect**(副作用 + 撤销函数)的形式托管。

正因为可逆,才有热重载、运行时启停、依赖联动等高级能力。

### 1.3 四个核心概念

| 概念                    | 一句话解释                                | 类比 NestJS            |
| ----------------------- | ----------------------------------------- | ---------------------- |
| **插件 Plugin**         | 功能模块,形式上是一个函数                 | Module                 |
| **上下文 Context(ctx)** | 插件的"工具箱",注册功能、访问服务都通过它 | DI 容器 + 生命周期句柄 |
| **服务 Service**        | 插件间共享功能的方式,挂在 ctx 上          | Provider               |
| **Fiber**               | 插件的一次装载实例(状态机 + 副作用清单)   | 无对应                 |

运行模型一句话:**插件通过 inject 声明依赖的服务 → 框架据服务可用性决定插件何时执行、何时回卷 → 插件的一切副作用登记为 effect,随 Fiber 销毁自动释放。**

---

## 第 2 章 · 快速开始

### 2.1 安装

```bash
pnpm add cordis@4.0.0-rc.7        # rc 阶段锁定版本,不带 ^
```

### 2.2 最小应用

```ts
import { Context } from "cordis";

function hello(ctx: Context) {
  // 一个插件就是一个函数
  console.log("你好,综测系统");
}

const ctx = new Context();
ctx.plugin(hello); // 装载即生效
```

> **版本注记**:3.x 需要 `ctx.start()` 触发 ready 事件后应用才算启动;4.x 已移除该模式,插件装载即执行。异步初始化见第 7 章。

### 2.3 CLI 启动(生产装配方式)

安装 `cordis` + `@cordisjs/plugin-loader` + `@cordisjs/plugin-include`,在项目根编写 `cordis.yml`,执行 `npx cordis`。CLI 会创建根上下文、装载 loader、读取 cordis.yml 依次装配插件。配置文件详见第 9 章。

---

## 第 3 章 · 插件

### 3.1 什么时候写插件

一块功能满足"可以整体开启/关闭"时,它就该是插件。综测系统中:成绩库、申报审核范式、AI 预检,各是一个插件。

### 3.2 三种形态

```ts
// ① 函数插件(最常用)
function gradebook(ctx: Context, config: Config) {
  /* ... */
}

// ② 类插件(提供服务时用,见第 4 章)
class Gradebook {
  constructor(ctx: Context, config: Config) {
    /* ... */
  }
}

// ③ 对象插件
export default {
  name: "gradebook",
  apply(ctx: Context, config: Config) {
    /* ... */
  },
};
```

三种形态能力等价。约定:默认函数插件,提供服务时用类插件继承 `Service`。

### 3.3 装载与卸载

```ts
const fiber = ctx.plugin(gradebook, { someOption: true });
await fiber; // 返回值可直接 await 至就绪
await fiber.dispose(); // 卸载:该插件注册的一切自动撤销
```

`ctx.plugin()` 的返回值是 **Fiber**——本次装载的句柄,可 `dispose()` 卸载、`restart()` 重启、`update(config)` 更新配置。业务代码很少直接操作 Fiber,装配交给配置文件。

### 3.4 多次装载与多实例

同一插件可装载多次,传入不同配置,产生多个互不干扰的 Fiber:

```ts
ctx.plugin(notifier, { channel: "email" });
ctx.plugin(notifier, { channel: "sms" });
```

> **版本注记(重要)**:3.x 中重复装载同一插件默认只执行一次,需声明 `reusable: true` 或使用 `fork` 事件才能多实例;官方指南「生命周期」一节对此有大量论述。**4.x 已移除 reusable 与 fork 机制,所有插件天然可多实例**——每次 `ctx.plugin()` 即产生新 Fiber。若需要"全局仅一份"的语义(如注册中心),应将其实现为服务(第 4 章),而非依赖装载去重。

---

## 第 4 章 · 服务

### 4.1 为什么需要服务

申报审核插件需要查成绩,成绩数据归成绩库插件管。插件之间不能互相 import(否则耦合死,谈不上可插拔),而是通过**服务**协作:成绩库把能力挂到 `ctx.gradebook`,谁需要谁使用。服务是一种 IoC 实现,配合 TypeScript 的**声明合并**获得类型化访问。

### 4.2 服务的三种类型

按官方分类,结合本项目:

1. **框架自带的服务**:`ctx.events`(事件)、`ctx.logger`(日志)、`ctx.reflect`(服务注册表)、`ctx.registry`(插件注册表)。有 ctx 即可用。
2. **约定名称、由可替换插件实现的服务**:如本项目的 `ctx.db`(database 插件实现)、`ctx.sandbox`(可在 QuickJS 与 isolated-vm 实现间切换)。实现插件的包名以服务名为前缀是推荐惯例(如 `plugin-sandbox-quickjs`)。
3. **由插件定义并实现的服务**:如 `ctx.gradebook`、`ctx.ui`。使用者需将其声明为依赖。

### 4.3 提供服务:继承 Service

```ts
import { Context, Service } from "cordis";

export class Gradebook extends Service {
  constructor(ctx: Context) {
    super(ctx, "gradebook"); // 服务名,即 ctx.gradebook
  }
  async getTermScores(uid: string, term: string) {
    /* ... */
  }
}
```

```ts
ctx.plugin(Gradebook); // Service 子类本身就是插件;装载后全局可用 ctx.gradebook
```

卸载提供服务的插件,服务即从所有上下文移除,依赖它的插件联动回卷(第 5 章)。

### 4.4 声明合并(必做)

服务是运行时挂载的,需告知 TypeScript:

```ts
declare module "cordis" {
  interface Context {
    gradebook: Gradebook;
  }
}
```

约定:每个提供服务的插件包在自己的入口文件集中声明。

### 4.5 轻量方式:ctx.provide

不值得写类的简单共享:

```ts
const dispose = ctx.provide("appConfig", { schoolName: "大连外国语大学" });
// 其他插件:ctx.appConfig.schoolName;调用 dispose() 可提前移除
```

### 4.6 服务方法如何替调用方清理副作用(关键模式)

服务的方法常被其他插件调用并产生登记类副作用(如 ui-registry 的 `addPage`)。调用方卸载时,这笔登记必须撤销——但代码写在服务里,怎么知道该跟随谁?

4.x 的机制:**通过 ctx 代理访问服务时,服务方法内的 `this.ctx` 指向调用方的上下文**。因此标准写法是在 `this.ctx` 上登记 effect:

```ts
export class UiRegistry extends Service {
  private pages = new Map<string, PageDecl>();

  addPage(p: PageDecl) {
    // this.ctx 是调用 addPage 的那个插件的上下文
    return this.ctx.effect(() => {
      this.pages.set(p.path, p);
      return () => this.pages.delete(p.path); // 调用方卸载时自动执行
    }, `page:${p.path}`);
  }
}
```

调用方于是可以完全无感:

```ts
function ping(ctx: Context) {
  ctx.ui.addPage({ path: "/ping", component: "PingPage", layout: "admin" });
  // 无需任何清理代码;ping 卸载时页面登记自动消失
}
```

> **版本注记**:3.x 通过 `this[Context.current]` 获取调用方上下文并监听其 `dispose` 事件;4.x 由 `this.ctx` 直达调用方,配合 effect 完成同一目标。

### 4.7 判断服务归属的标准

会被多个插件使用的能力才做成服务。本项目的服务清单:`ctx.db`、`ctx.server`、`ctx.storage`、`ctx.queue`、`ctx.ai`、`ctx.sandbox`、`ctx.gradebook`、`ctx.questionTypes`、`ctx.ui`。

---

## 第 5 章 · 依赖注入:inject

### 5.1 为什么不能直接判断服务存在

一段来自官方指南的"标准错误答案"(改编为本项目场景):

```ts
// 错误示范!不要这样写
export function apply(ctx: Context) {
  if (!ctx.db) return; // ① 装载顺序不可控,此刻 db 可能尚未就绪
  ctx.server.contribute("review", router);
  if (ctx.storage) {
    // ② db/storage 所在插件运行时被重载后,
    /* 使用对象存储 */
    //    这里的副作用无法清理,也不会重新执行
  }
}
```

问题的根源:服务的可用性是**随时间变化**的,一次性的 if 判断既不能等待,也不能响应变化。

### 5.2 正确答案:声明依赖,框架编排

```ts
function reviewPlugin(ctx: Context) {
  // 执行到这里,db 与 server 一定就绪
  ctx.server.contribute("review", buildRouter(ctx.db));
}
reviewPlugin.inject = ["db", "server"];
```

`inject` 数组声明必需依赖,语义(实测):

- 依赖未齐:插件体**不执行**,Fiber 停在 PENDING;
- 依赖到齐:自动执行;
- 运行中依赖消失(如 db 插件被卸载):本插件**自动回卷**——effect 全部释放、回到 PENDING;
- 依赖恢复:自动重新执行。

装载顺序因此完全不需要关心,包括 cordis.yml 中的条目顺序。

### 5.3 部分功能依赖某服务:ctx.inject 子插件

整个插件不依赖、但某段功能依赖时,把那段功能注册为匿名子插件:

```ts
function dialogue(ctx: Context) {
  ctx.server.contribute("dialogue", router); // 主体功能

  ctx.inject(["ui"], (ctx) => {
    // 仅这一段依赖 ui
    ctx.ui.addPage({
      path: "/dialogue",
      component: "DialoguePage",
      layout: "admin",
    });
  });
}
dialogue.inject = ["server"];
```

> **注意:这里出现了两个 `ctx`**,它们属于不同插件。子插件回调内务必使用**参数**的 ctx 而非外层 ctx——否则热重载时子插件的副作用会被记到外层账上,造成清理错位与泄漏。这是官方指南特别强调的陷阱,4.x 同样适用。

### 5.4 可选依赖

> **版本注记(危险差异)**:3.x 官方指南的可选依赖写法为
> `inject = { required: ['db'], optional: ['storage'] }`。
> **该写法在 4.x 失效且有害**——`required`/`optional` 会被当成两个服务名,插件将因等待名为 "required" 的服务而**永久 PENDING**(实测)。请勿照搬。

4.x 中表达"可选依赖"的可靠方式是运行时探测,配合 `internal/service` 事件响应变化,或直接用 `ctx.inject` 子插件(推荐,见 5.3):

```ts
function precheck(ctx: Context) {
  ctx.on("submission/created", (s) => {
    const storage = ctx.get("storage"); // 运行时探测,可能为 undefined
    if (storage) {
      /* 附件走对象存储 */
    }
  });
}
precheck.inject = ["queue"]; // 必需依赖仍用数组
```

`inject` 的对象形式(`{ db: true }` 等)在 4.x 类型上存在,但其布尔值语义与 3.x 文档不符且未稳定,教程建议:**必需依赖一律用数组,可选依赖一律用 ctx.inject 子插件或运行时探测。**

### 5.5 综合示例(官方"正确答案"的 4.x 版)

```ts
export default function dialogue(ctx: Context) {
  // 部分功能依赖 → ctx.inject 子插件
  ctx.inject(["ui"], (ctx) => {
    ctx.ui.addPage({
      path: "/dialogue",
      component: "DialoguePage",
      layout: "admin",
    });
  });

  // 可选增强 → 运行时探测
  ctx.on("dialogue/answer", (content) => {
    ctx.get("storage")?.transform(content);
  });

  // 主体逻辑直接使用必需依赖
  ctx.server.contribute("dialogue", buildRouter(ctx.db));
}
dialogue.inject = ["db", "server"]; // 整体必需依赖
```

---

## 第 6 章 · 插件配置

### 6.1 用 Zod 声明配置

将 Zod schema 赋给插件的 `Config` 属性,装载时自动校验并填默认值:

```ts
import { z } from "zod";

const SandboxConfig = z.object({
  timeoutMs: z.number().int().positive().default(1000),
  memoryMb: z.number().int().max(512).default(64),
});

function sandbox(ctx: Context, config: z.infer<typeof SandboxConfig>) {
  // config 一定合法且默认值已填
}
sandbox.Config = SandboxConfig;
```

```ts
ctx.plugin(sandbox, { timeoutMs: 3000 }); // 收到 { timeoutMs: 3000, memoryMb: 64 }
ctx.plugin(sandbox, { memoryMb: 4096 }); // 抛 ValidationError,插件不装载
```

类插件将 Config 声明为静态属性:`static Config = z.object({...})`。

> **版本注记**:3.x 使用 schemastery(`Schema.object()`)描述配置;4.x 改为 [Standard Schema](https://standardschema.dev) 规范,Zod ≥3.24(含 Zod 4)原生兼容,无需任何适配层。官方 3.x 指南「插件配置」一节的 schemastery 写法不适用于 4.x。

### 6.2 运行时更新配置

`fiber.update(newConfig)` 更新配置,默认行为是重新校验并重启插件;插件可监听 `internal/update` 事件拦截,实现免重启热更(见 8.5 waterfall)。

---

## 第 7 章 · 生命周期与资源清理

### 7.1 effect:创建资源时登记撤销

一切"创建了就需要撤销"的动作——注册路由、启动定时器、写入注册中心、建立连接——包进 effect:

```ts
function reminder(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => checkDeadlines(), 60_000);
    return () => clearInterval(timer); // 撤销函数
  }, "deadline-timer"); // 可选标签,便于调试
}
```

插件卸载或因依赖消失被回卷时,框架自动执行所有撤销函数。

判断心法:**这个动作有没有反动作?** 有,就包 effect。

| 动作         | 反动作        |
| ------------ | ------------- |
| setInterval  | clearInterval |
| 注册路由     | 摘除路由      |
| 登记题型范式 | 注销范式      |
| 打开连接池   | 关闭连接池    |

`ctx.on()` 监听事件**不需要**手动包 effect——框架已代劳,监听器随插件卸载自动移除。自己封装服务时应效仿此设计(见 4.6),让调用方无需关心清理。

### 7.2 多段资源:生成器 effect

按顺序创建多段资源时用生成器,撤销时自动按**相反顺序**(后创建先释放)执行:

```ts
ctx.effect(function* () {
  const conn = openConnection();
  yield () => conn.close();
  const sub = conn.subscribe();
  yield () => sub.cancel();
});
```

异步初始化可用 `async` effect 或 async 生成器。

### 7.3 与 3.x 生命周期事件的对照

官方指南「生命周期」一节围绕 `ready` / `dispose` / `fork` 三个事件展开,4.x 的对应关系:

| 3.x 写法                                       | 4.x 写法                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ctx.on('ready', cb)` 等待启动后执行异步初始化 | 无 ready 事件;插件体可直接 async,或 Service 覆写 `[Service.init]`(支持 async generator,yield 即登记撤销) |
| `ctx.on('dispose', cb)` 清理副作用             | `ctx.effect(() => { 创建; return 撤销 })`                                                                |
| `ctx.on('fork', cb)` / `reusable` 实现多实例   | 已移除;多次装载天然多实例(见 3.4)                                                                        |
| `fork.dispose()`                               | `fiber.dispose()`                                                                                        |

第 7.1 的 HTTP 服务器例子,3.x 官方版本用 ready+dispose 两个监听,4.x 只需一个 effect:

```ts
function server(ctx: Context, config: { port: number }) {
  ctx.effect(() => {
    const srv = createServer(handler);
    srv.listen(config.port);
    return () => srv.close();
  });
}
```

---

## 第 8 章 · 事件:插件之间如何对话

服务解决"我要用你的功能"(点对点、强依赖);事件解决"发生了一件事,谁关心谁处理"(广播、松耦合)。Cordis 的事件在 EventEmitter 之上增加了多种"收集回答"的派发模式。按使用场景记忆:

### 8.1 emit —— 通知一声,不需要回复

```ts
// 提交模块:材料提交成功后广播
ctx.emit("submission/created", submission);

// AI 预检插件:
ctx.on("submission/created", (s) => ctx.queue.add("precheck", s.id));
```

提交模块无需知道预检的存在;日后新增"提交后发站内信"插件,提交模块零改动。

### 8.2 parallel —— 通知所有人,等大家做完

```ts
await ctx.parallel("batch/settled", batchId); // 等全部异步监听器完成
// 之后才标记批次归档
```

### 8.3 bail —— 问一圈谁能处理,第一个应答的算

```ts
// 题型中心:这道题由哪个范式处理?
const paradigm = ctx.bail("paradigm/resolve", questionType);

// 申报审核范式:
ctx.on("paradigm/resolve", (qt) => {
  if (qt.paradigm === "declaration") return declarationHandler;
  // 不是自己的就不返回(undefined),框架继续问下一个
});
```

按注册顺序依次询问,**第一个返回非 undefined 的监听器胜出**并短路后续。实现注册中心/责任链的标准姿势。

### 8.4 serial —— 异步版 bail,常用于投票否决

```ts
const veto = await ctx.serial("submission/check", draft);
if (veto) throw new BadRequestError(veto);

// 黑名单插件:
ctx.on("submission/check", async (draft) => {
  if (await ctx.db.isBlacklisted(draft.uid)) return "该用户已被限制提交";
});
```

### 8.5 waterfall —— 有一套默认做法,允许别的插件拦截或加工

场景:审核链分派任务的默认逻辑是按角色找人;"回避插件"希望在审核人与提交人存在利益关系时换人,而默认逻辑不应知道回避规则的存在。

```ts
// 审核链插件:把默认做法作为最后一个参数传入
const assignee = ctx.waterfall("review/assign", task, () => {
  return findByRole(task.node.role); // 默认分派
});

// 回避插件:
ctx.on("review/assign", (task, next) => {
  const assignee = next(); // 放行给下一层(或默认实现)
  if (isConflicted(assignee, task)) return findAlternate(task);
  return assignee;
});
```

规则:

- 调用形式 `ctx.waterfall(事件名, ...参数, 默认实现)`,最后一个参数是函数;
- 监听器签名 `(...参数, next)`:调 `next()` 放行、不调即拦截、改返回值即加工;
- 与 Koa 中间件的洋葱模型同一思想。**不是**"返回值 reduce 接力",勿按直觉误用。

框架自身的 `fiber.update()` 即通过 waterfall 派发 `internal/update`,插件借此拦截配置变更实现免重启热更。

**bail 与 waterfall 的选择**:多个候选人里选一个来干 → bail;事情有默认干法、允许层层包装 → waterfall。

### 8.6 定义事件类型

```ts
declare module "cordis" {
  interface Events {
    "submission/created"(s: Submission): void;
    "submission/check"(d: Draft): string | void; // serial:返回否决理由
    "review/assign"(t: ReviewTask, next: () => Reviewer): Reviewer; // waterfall
  }
}
```

### 8.7 监听选项

`ctx.on(name, fn, { prepend: true })` 使监听器排到队首。监听返回的函数可手动取消,不调用则随插件卸载自动清理。

---

## 第 9 章 · 用配置文件装配应用

### 9.1 三件套与启动

```bash
pnpm add cordis @cordisjs/plugin-loader @cordisjs/plugin-include
pnpm add -D @cordisjs/plugin-hmr
npx cordis            # 读取 ./cordis.yml 依次装配
```

### 9.2 cordis.yml 基本形态

```yaml
- name: "@qualy/plugin-server"
  config:
    port: 3000
- name: "@qualy/plugin-database"
- name: "@qualy/plugin-gradebook"
- name: "@qualy/plugin-ai-precheck"
  disabled: true # 保留配置但停用
```

条目字段:`name`(包名或相对路径,均可为 TS 文件)、`config`、`disabled`、`id`(loader 维护的唯一标识,可省略)、`group`、`isolate`、`intercept`。loader 是双向的:运行期对条目的修改可写回文件。

### 9.3 插件组

`loader:group` 将若干插件组织为一组,可整体启停,并作为 isolate 等配置的作用域:

```yaml
- name: loader:group
  config:
    - name: "@qualy/plugin-paradigm-declaration"
    - name: "@qualy/plugin-paradigm-import"
```

### 9.4 服务隔离(isolate)

多个插件依赖同一服务名、但希望各用各的实例时使用。典型场景:两组插件分别使用不同的数据库实例。

```yaml
- name: loader:group
  isolate:
    database: true # 匿名隔离域:组内自成一体
  config:
    - name: driver-mysql
    -  # 该组其他插件

- name: driver-sqlite
  isolate:
    database: sqlite # 具名隔离域
- name: custom-plugin
  isolate:
    database: sqlite # 引用同名隔离域,与上一条共享 SQLite 实例
```

### 9.5 服务拦截(intercept)

多个插件依赖同一服务、但各需不同定制时使用。经典例子是 http 服务的按插件代理与超时:

```yaml
- name: plugin-a
  intercept:
    http: { proxy: "http://localhost:7890" }
- name: plugin-b
  intercept:
    http: { timeout: 60000 }
```

服务作者通过 `Service.config` 符号声明可拦截的配置类型;使用侧也可在代码中 `ctx.intercept('logger', { name, level })`。

### 9.6 模块热替换

开发期启用 `@cordisjs/plugin-hmr`:文件变更时仅重载对应插件(及依赖它的插件),进程不重启。配合第 5 章的依赖联动,改动一个服务插件,整条依赖链自动完成"回卷 → 重载"。

---

## 第 10 章 · 测试插件

`new Context()` 即全新隔离环境,依赖用 `ctx.provide` 打桩,无需 mock 框架:

```ts
import { describe, it, expect } from "vitest";
import { Context } from "cordis";
import { declarationParadigm } from "../src";

describe("申报审核范式", () => {
  it("装载后注册,卸载后清理", async () => {
    const ctx = new Context();
    const registered: string[] = [];

    ctx.provide("questionTypes", {
      register: (name: string) =>
        ctx.effect(() => {
          registered.push(name);
          return () => registered.splice(registered.indexOf(name), 1);
        }),
    });

    const fiber = ctx.plugin(declarationParadigm);
    await fiber;
    expect(registered).toContain("declaration");

    await fiber.dispose();
    expect(registered).not.toContain("declaration");
  });
});
```

每个插件配一个"装载 → 断言注册 → 卸载 → 断言清理"的测试,即可持续验证可逆性。

---

## 第 11 章 · 常用 API 速查

| 我想……               | 写法                                                               |
| -------------------- | ------------------------------------------------------------------ |
| 写插件               | `function p(ctx, config) {}`                                       |
| 装载 / 卸载          | `const f = ctx.plugin(p, config)` / `await f.dispose()`            |
| 声明必需依赖         | `p.inject = ['db', 'gradebook']`                                   |
| 部分功能依赖         | `ctx.inject(['ui'], (ctx) => { ... })`(用参数 ctx!)                |
| 可选依赖探测         | `ctx.get('storage')` 判空                                          |
| 声明配置             | `p.Config = z.object({...})`                                       |
| 提供服务(正式)       | `class X extends Service { constructor(ctx) { super(ctx, 'x') } }` |
| 提供服务(轻量)       | `ctx.provide('x', value)`                                          |
| 服务方法替调用方清理 | 方法内 `this.ctx.effect(...)`(this.ctx 即调用方上下文)             |
| 登记清理             | `ctx.effect(() => { 创建; return 撤销 })`                          |
| 广播                 | `ctx.emit('name', ...args)`                                        |
| 广播并等待           | `await ctx.parallel('name', ...args)`                              |
| 找第一个应答者       | `ctx.bail(...)` / `await ctx.serial(...)`                          |
| 可拦截的默认行为     | `ctx.waterfall('name', ...args, 默认实现)`                         |
| 监听                 | `ctx.on('name', fn)`(随卸载自动清理)                               |
| 日志                 | `ctx.logger.info(...)` / `ctx.logger('模块').warn(...)`            |
| 补类型               | `declare module 'cordis' { interface Context/Events {...} }`       |

---

## 附录 · 阅读旧版文档(cordis.moe / koishi.chat)的注意事项

官方指南内容基于 Koishi 时代的 3.x 语义,以下写法**不适用于 4.x**,阅读时注意甄别:

| 旧版文档写法                                    | 4.x 现实                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `using: ['database']`                           | 改名 `inject`                                                                |
| `inject = { required: [...], optional: [...] }` | **失效且有害**:键被当作服务名,插件永久 PENDING。改用数组 + ctx.inject 子插件 |
| `ready` / `dispose` / `fork` 事件               | 均移除;分别由「装载即执行 / [Service.init]」「effect」「天然多实例」取代     |
| `reusable` 属性、`Fork` 对象                    | 移除;`ctx.plugin()` 返回 Fiber,多次装载即多实例                              |
| `Context.service('name')` 定义服务              | 用 `ctx.provide` 或 Service 子类                                             |
| `this[Context.current]` 获取调用方上下文        | 服务方法内直接 `this.ctx`                                                    |
| `Schema.object()`(schemastery)配置              | Standard Schema(Zod 直连)                                                    |
| `ctx.start()` / `app.start()`                   | 移除,装载即生效                                                              |

仍然完全适用的章节:服务的三分类与依赖关系思想、`ctx.inject` 子插件模式与"两个 ctx"陷阱、cordis.yml 的插件组/服务隔离/服务拦截、模块热替换、"可逆的插件系统"设计理念。
