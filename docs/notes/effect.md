# effect(v4 beta)实查笔记

## Schema 对多余对象键的行为(2026-08-31,rc.111)

`Schema.decodeUnknownEffect(schema)(value, options)` 的 `ParseOptions.onExcessProperty`
默认 `"ignore"`(未声明的键**静默剥除**),`"error"` 才失败,另有 `"preserve"`。
依据:repos/effect/packages/effect/src/SchemaAST.ts:445(文档)与 :484(类型),
:2229-2243(实现:仅当 `"error"`/`"preserve"` 时逐键比对 index)。

因此任何「未知键必须 fail closed」的持久化 envelope(如 ScoringPlan V2 的
persistedPlanShapeV2)必须显式传 `{ onExcessProperty: 'error' }`,不能依赖默认行为。
该 option 作用于整棵 decode 树的每个 TypeLiteral;`Schema.Unknown` 位置(config、
schema 体)不做对象结构解析,不受影响——恰好实现「envelope 严格、owner 语言自治」。
仓库先例:database/web/storage 的 config loader 已用 `onExcessProperty: 'error'`。

## 空 Struct 对多余键不报错(2026-09-17,rc.115)

`Schema.decodeUnknownEffect(Schema.Struct({}))(value, { onExcessProperty: 'error' })` 对
`{ migrationsFolder: 'x' }` **Success**;同一 option 下 `Schema.Struct({ a: Schema.optional(Schema.String) })`
才 Failure(node -e 实查)。多余键的比对只在 TypeLiteral 的 `fallback` parser 里做
(repos/effect/packages/effect/src/SchemaAST.ts:2905-2925,`onExcessPropertyError` 分支),
一个没有任何 property/index signature 的 TypeLiteral 走的不是这条路,于是「任意对象」都通过。

后果:`decodePluginConfig(Schema.Struct({}), block)` 不能表达「这个插件不读任何清单配置」——
它会把整块静默放行,正是该 helper 要防的失败。database 插件的 `server/config.ts` 因此在 decode 之后
自己检查 `Object.keys(block)` 非空即拒绝并指路。其他想声明「零配置」的插件照此办理,不要依赖空 Struct。

## rc.115 → rc.118(2026-09-30)

实查过的破坏面与本仓库的对应处理,依据是 `repos/effect`(tag `effect@4.0.0-rc.118`)与 changelog:

- **模块路径**:`effect/unstable/*` 整体移到 `effect/*`,旧导出删除;`httpapi` 另改名 `http-api`。
  本仓库 122 个源文件机械替换(`effect/unstable/httpapi` → `effect/http-api`,其余去掉 `unstable/`),
  注释里指向上游源码的路径同步改为 `repos/effect/packages/effect/src/<模块>/…`(上游 `src/unstable/` 已不存在;
  注释里的行号是旧版本的,读时以当前源码为准)。
- **`Scope.close` 只收 `Scope.Closeable`**:13 处测试与 database testkit 把会被关闭的 scope 声明成了
  `Scope.Scope`,值本来就来自 `Scope.make()`,收窄声明即可。
- **`HttpRouter.serve` 用分叉的 MemoMap**(`src/http/HttpRouter.ts` serve;`Layer.CurrentMemoMap.forkOrCreate`,
  `src/Layer.ts` `MemoMapImpl.get` 先查本表再查 parent):外面已建好的 layer 复用,serve 里**首次**建的 layer
  私有。apps/server 的运行时图同时给启动屏障与 serve,只建一次靠的是屏障先建(`server.pipe(Layer.provide(booted))`)。
  `apps/server/tests/runtime-memo.test.ts` 按同一形状计数;把顺序反过来(先建 serve)即建两次、测试失败(实测)。
- **`HttpServer.address`** 变成 `NetAddress.SocketAddress`(`src/net/NetAddress.ts`:`InetAddressV4` /
  `InetAddressV6` 带 `port`,`UnixPathAddress`),不再有 `TcpAddress` 标签。生产代码没有读它。
- 顺带确认(非本次变化):`HttpRouter.add` 的处理函数在**请求时**才从上下文取服务,`Layer.provide` 给路由 layer
  的依赖不进请求上下文,会 `Service not found`;插件的 handler 在构建期取服务并捕获,不受影响。
- 全量 node 套件 403 个文件 3049 条通过,含 effect-source-policy 点名的两条承重测试(OTLP span 改名、
  数据库追踪与事务传播)和冻结 OpenAPI 的全量比对,均未改动。

## rc.118 API 错误装配检查的内部辅助导出(2026-10-01)

- 实查 `node -e "import('effect/SchemaAST').then(m=>console.log(Object.keys(m).filter(x=>/entinel|onstruct/.test(x))))"`
  得到 `collectSentinels`, `getConstructorDescriptor`, `withConstructorDefault`;`effect/http-api/HttpApiEndpoint`
  实际导出 `getErrorSchemas`。前两项与后一项均在源码标 `@internal`,发布的 `.d.ts` 去掉了这些声明。
- 实读 `repos/effect/packages/effect/src/SchemaAST.ts` 的 collectSentinels/getConstructorDescriptor,
  `repos/effect/packages/effect/src/http-api/HttpApiEndpoint.ts` 的 getErrorSchemas:
  HttpApi response encoding 保留 TaggedError 类的 constructor descriptor;middleware 错误也须按 endpoint 收集。
- 适配仅放在 `packages/core/api-kit/src/error-codes.ts` 的装配边界,不把内部 API 暴露给插件。
  `tools/tests/error-codes.test.ts` 真正走 response encoding,断言同一类跨 endpoint 可复用、不同类同码必拒绝,
  同时检查实际 selected assembly。升级 Effect 时必须随这些测试核对内部导出。
