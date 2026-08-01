# cordis 4.0.0-rc.7 生态实查结论(2026-07-27)

## logger:默认无控制台输出,用官方 @cordisjs/plugin-logger-console

- 内置 LoggerService 构造时只注册一个内存 buffer exporter,**不打印任何东西**;输出需另挂 exporter。
- 官方 console 插件存在:`@cordisjs/plugin-logger-console@1.0.0`(peer `cordis@^4.0.0-rc.4`),已采用。
- 教训:registry 的 search 端点(`/-/v1/search`)结果不全,当时搜不到该包差点自写一个;**确认包是否存在用直接 GET `registry.npmjs.org/<包名>`**,search 只做发现用。
- 自定义 exporter 的姿势(备查):`ctx.logger.exporter({ colors, levels, export(message) })`;`Logger.format(exporter, message)` 只格式化消息体,前缀自拼;exporter 注册内部走 ctx.effect 且归属调用方 fiber,卸载即移除。

## 插件 Config 与整体缺失:机制与定案(四组对照实测,2026-07-27)

两条机制,记住它们就不需要还原争论现场:

1. **cordis `resolveConfig` 对 yml 缺失的 config 原样传 `undefined`,不做任何预处理**(不会替你变成 `{}`)。默认值填充全部发生在 Standard Schema 校验内部,cordis 只负责调用 validate。
2. **Zod 4 顶层 `.default()` 短路、`.prefault()` 走完整解析**:`.default({})` 在输入 undefined 时直接返回 `{}` 跳过字段解析,字段默认全不生效且无报错(静默半残);`.prefault({})` 把 `{}` 过一遍 schema,字段默认正常填充。插件对象型 Config 顶层默认**必须用 `.prefault({})`**。

由此推出的行为矩阵(全部实测):

- 无 prefault + yml 省略 config → 启动 ValidationError(`expected object, received undefined (at )`)进程退出。
- `.prefault({})` + yml 省略 config → 全默认值正常装载。
- `.prefault({})` + Config 含必填字段 + yml 省略 config → 照样 ValidationError,且报错精确到字段(`(at url)`),比顶层报错更可诊断——prefault 不吞错。
- `.default({})` + yml 省略 config → 装载"成功"但字段默认全部 undefined,无任何报错。**最危险的形态,禁用。**

## ValidationError 的两种呈现(均实测)

- 启动期非法配置:异常传播,进程退出,错误含字段路径(`Invalid input: expected string, received number (at greeting)`)。
- 运行期热应用非法配置:`[E] include ValidationError` 记日志,该条目更新失败,**旧 fiber 继续运行**(心跳不断),修复后自动重载新配置。

## loader / include(1.0.0-rc.5 / 1.0.4)

- 插件模块解包:`unwrapExports = exports.default ?? exports`(两层)。**无 default 导出时模块命名空间整体就是对象插件**——具名导出 `name/inject/Config` + `apply` 即合法插件形态,这是本仓库的统一约定(已实测:装载、hmr 重载、yml 热应用均正常)。default 导出函数则只拿到裸函数,元属性需属性赋值挂回,弃用该形态。Service 类插件维持 `export default class`(静态属性随类走)。
- cordis.yml 是**双向**的:loader 运行期写回并规范化(补 `id:` 字段、单引号)。id 是条目稳定标识,提交进 git,勿手删。
- 修改 yml 中的 config 保存 → 运行中进程热应用(fiber restart),无需重启。

## 函数插件的返回值会被当作 effect 清理函数

插件体(apply)的返回值被 cordis 登记为该 fiber 的 disposal;返回非函数值时抛 `Invalid effect`(装载看似成功后报错)。箭头函数单表达式体的隐式返回(如 `() => out.push(x)` 返回 number)是典型事故源。约定:插件体不要有返回值。

## Service 异步初始化:构造器 effect 拦不住依赖方(实测)

- 依赖门控的开闸时机是「服务实例可见」(构造器同步完成):构造器里注册的 **async effect 不会**推迟依赖方激活,依赖方可能拿到尚未初始化完成的服务字段(undefined)。
- 异步初始化的正确归宿是 `async *[Service.init]()`:init 完成后依赖方才激活;yield 的清理函数登记为 disposal(与 effect 生成器同构)。database 插件的 fail-fast 探活(`await pool.query('select 1')`)即此模式,数据库不可达时依赖它的插件停 PENDING。
- **重载安全检查项**:服务持有的任何缓存,若其内容绑定了会被 disposal 销毁的资源(如 withRelations 的视图缓存包着连接池),必须在**同一个 disposal 里清空**;否则 restart 后新资源就位、旧缓存仍被命中,报错(如 "Cannot use a pool after calling end")离病根十万八千里。将来 sandbox 的编译缓存、queue 的连接同理。
- **寄生副作用不用单独 effect 化**:生命周期与被清理对象同体的副作用(如 `pool.on('error')` 监听器随 `pool.end()` 一起消亡)不需要独立登记清理,这是判断"哪些动作要包 effect"的边界准则。

## 服务访问受 inject 声明约束(实测,会话 5)

- rc.7 的 Context 代理对服务访问做**声明检查**:经某插件的 ctx 取它未声明 inject 的服务,直接抛 `cannot get property "db" without inject`——不是 undefined,是硬错误。
- 由此定案 API handler 的服务访问约定:**handler 闭包使用所属插件自己的 ctx**(它的 inject 声明过);`ApiContext.cordis`(server 插件的 ctx)只作请求管道用途(日志溯源/事件),不作服务访问入口。教程早期的 `context.cordis.db` 写法已被此实测推翻。

## 信号处理与优雅关闭(定案:自建入口 packages/app/src/main.ts)

- cordis 核心与 bin.js **零信号处理**:Ctrl+C 走 Node 默认行为,退出码 130(pnpm 报 ELIFECYCLE "Command failed"),所有 effect 清理不会执行(HTTP close、pg 池 end 等全部跳过)。
- 根上下文 `ctx.fiber.dispose()` **级联释放所有插件(含嵌套子插件)的 effect**(实测)。注意特例:根 fiber dispose 后状态仍显示 ACTIVE,不进 DISPOSED;判断关闭是否干净看各插件清理行为与退出码,勿断言根 fiber 状态值。
- main.ts 复刻 bin 四行逻辑 + SIGINT/SIGTERM 处理(5s 超时强退、二次信号强退、成功 exit(0))。实测 Ctrl+C 后退出码 0,无 ELIFECYCLE 噪音。SIGTERM 同路径,对应 docker stop(PLAN §2.7 部署形态)。

## 声明文件与 NodeNext 不兼容(定案:base 用 module Preserve)

- rc.7 的 d.ts(index.d.ts 及内部各文件)全部使用无扩展名相对重导出(`export * from './context'`),按 bundler 解析习惯发布。NodeNext 严格要求 ESM 相对引用带扩展名,解析失败 + skipLibCheck 吞错,最终呈现为误导性的 `TS2305: Module '"cordis"' has no exported member 'Context'`(已实测,TS 6/7 一致)。@cordisjs 全家同风格,逐个 pnpm patch 不值得。
- 定案:tsconfig.base 用 `module: "Preserve"`(bundler 解析);`types: ["node"]` 补回 Node 全局(web 侧 tsconfig 覆写清空);相对导入带 `.ts` 扩展名降为软约定。
- 重评条件:4.0 stable 发布时检查 index.d.ts 是否改为 `./context.js` 风格,是则可切回 NodeNext。**优先级低**,Preserve 跑通后切换收益很薄。

## package.json 的 `cordis` 字段:私有插件不需要

- cordis 核心与 plugin-loader 的产物对 `services`/`description`/`manifest` 零引用,运行时依赖门控**只认代码里的 `inject`**。
- 该字段是插件市场/webui 生态元数据(@cordisjs/registry 扫 npm 用,承袭 Koishi `koishi` 字段惯例)。本项目插件私有不进市场,不写。真正的清单是 exports 映射(`./contract`、`./schema`、`./client`),gen 脚本读的是它。

## TypeScript 版本定案:只用 6.x 一套

- P2 类型门禁链路(@typescript/vfs 虚拟项目 + getSemanticDiagnostics)需要完整 Strada 程序化 API,TS6 必须在场;TS7 唯一卖点是大仓检查提速,本仓规模无感,双版本共存纯增复杂度。catalog 锁 `~6.0.3`。
- 重评条件:TS 7.1 稳定 API 发布且 vfs 生态适配。
- P2 补充定案:计分函数语法收敛为可擦除子集(禁 enum/namespace/class 参数属性,已入 PLAN §6.1),为转译层降级到 Node 原生 stripTypeScriptTypes 留退路。

## Traceable proxy pitfall: mutable service state

Service methods invoked through a caller context (`child.server.fallback(...)`) receive a
traceable-proxied `this`. Closures created there must not rely on `this.prop = value`
reassignment or `this.prop === capturedFn` identity checks: the proxy wraps function-valued
properties on get, so the identity check fails and stale state survives disposal. Verified
on rc.7 with a minimal repro (fallback handler stayed registered after fiber dispose).

Rule: keep per-service mutable slots in a stable container captured once
(`const slot = this.fallbackSlot` before `ctx.effect`), and mutate the container.
Map-based state (`this.fragments.set/delete`) is safe for the same reason.
`Service.init` and its yielded disposers run on the real instance, so `this.pool = ...`
there is fine.
