# oRPC 2.0.0-beta.21 实查结论(2026-08-01,会话 4 开场仪式)

四条导出探针实录(`node -e "import('包').then(m=>console.log(Object.keys(m)))"`,在 server 插件包内执行):

- `@orpc/server`:含 `implement`、`os`、`onError`(及 onStart/onSuccess/onFinish)、`ORPCError`、`call`、`createRouterClient`、`defineMeta`、`type` 等;`Router`/`Context` 为类型导出。
- `@orpc/server/plugins`:`CORSHandlerPlugin`、`BatchHandlerPlugin`、`CSRFGuardHandlerPlugin`、`RequestLimitHandlerPlugin`、Request/ResponseCompression、Request/ResponseHeaders、`RethrowHandlerPlugin`。
- `@orpc/server/node`:`NodeHttpHandler`、`RPCHandler`、`CompositeNodeHttpHandlerPlugin`。
- `@orpc/openapi/node`:`OpenAPIHandler`(唯一导出)。
- 追加:`@orpc/openapi` 根含 `openapi`(路由元数据助手)、`OpenAPIGenerator`、序列化器等。

## 与 PLAN §4.8-4.10 的对照

- `OpenAPIHandler` 在 `@orpc/openapi/node` ✓;`RPCHandler`/`NodeHttpHandler` 在 `@orpc/server/node` ✓。
- 路由声明 `oc.meta(openapi({ method, path }))` ✓(`openapi` 助手实测在 `@orpc/openapi` 根;文档同款,未设 meta 的过程默认 `POST /<路由路径>`)。
- **CORS 插件 v2 名为 `CORSHandlerPlugin`**(v1 教程的 `CORSPlugin` 已亡);`onError` 在 `@orpc/server` 根,作为 `interceptors` 数组元素使用。

## 关键 API 语义(文档 + 类型实查)

- `new OpenAPIHandler<T>(router: Router<T>, { plugins, interceptors, routingInterceptors })`;`handle(req, res, { prefix, context })` 返回 `{ matched }`,未匹配自答 404。
- `interceptors` 只跑匹配后的请求(可 rethrow 为 ORPCError);`routingInterceptors` 跑全部请求(含未匹配)。日常用 interceptors。
- prefix 类型是 `` `/${string}` `` 模板字面量。
- Blob/流场景跨域需在 CORS allowHeaders/exposeHeaders 加 `Content-Disposition`、`Standard-Server`(暂未用,备忘)。

## 客户端侧实查(会话 5,beta.21 与新版文档漂移全录)

- **`@orpc/openapi/client` 子路径不存在**(ERR_PACKAGE_PATH_NOT_EXPORTED);`OpenAPILink` 在 **`@orpc/openapi/fetch`**。beta.21 的 openapi exports:`. /helpers /plugins /standard /fetch /node /extensions/route`。
- **独立包 `@orpc/openapi-client` 在 v2 已死**(registry 停在 1.14.13,无任何 2.x):v1 教程的 `@orpc/openapi-client/fetch` 若照抄会把 1.x 混进 2.x 体系、类型当场崩。api-client 的依赖清单就是 `@orpc/client + @orpc/openapi + @orpc/contract` 三件,全部钉 2.0.0-beta.21。
- **beta 标签已漂到 beta.23**:`pnpm add @orpc/xxx@beta` 现在装的不是 .21。oRPC 一律精确版本,**禁用 @beta 标签**(已入 CLAUDE.md);升级 .22/.23 的评估放 P0 收官后单独做,不在会话中途做。
- **类型导出是运行时探针的盲区**:`RouterContractClient` 是 `@orpc/contract` 的纯类型导出、`JsonifiedClient` 是 `@orpc/openapi` 的纯类型导出——`Object.keys(module)` 看不见它们,差点误判不存在。探针纪律补一条:值探针失败后再查 d.mts 的 `export type`。
- 客户端定稿写法:`createORPCClient(link)`(自 `@orpc/client`)+ 显式标注 `JsonifiedClient<RouterContractClient<AppContract>>`。
- **弃用 `createContractJsonifiedClientFactory`**:它要求每个 procedure 带 `meta['~path']` 位置印章(`meta.path([...])` 手工盖,oc.router/augment/populate/minify 都不自动盖),对插件聚合契约不友好;classic client 完全不需要。
- `populateRouterContractOpenAPIPaths(contract)`:给**没有**显式 openapi path 的 procedure 按路由位置补 HTTP path(已有显式 meta 的原样返回);聚合契约喂给 OpenAPILink 前过一遍,向后兼容将来省写 path 的过程。
- `OpenAPILink` 选项:`origin`(可选,`http(s)://` 绝对源)与 `url`(**`StandardUrl` 模板类型,必须 `/` 开头的纯路径**,须与 handler prefix 一致)分离;浏览器同源只传 url,脚本侧把完整地址拆成 origin + pathname。
- 裸多字节字符直接塞查询串会 400(input 校验前的解码失败),客户端侧规范百分号编码即可(curl 用 --get --data-urlencode)。

## server 插件落地要点(全部实测)

- 监听放 `async *[Service.init]()`:`listen` 以 Promise 包装,`error` 事件 reject(端口占用 = init 失败,依赖方保持 pending);disposal `closeAllConnections()` + `close()` 回调 resolve——**实测 hmr 重载序列 `closed → listening` 无 EADDRINUSE**。
- `contribute(ns, router)` 全 effect:ns 冲突抛错;卸载即摘除片段并原子 rebuild(handler 整体替换,请求闭包读 `this.handler` 拿到最新实例)。
- 每请求 context 注入 `{ cordis: ctx }`,`ApiContext`/`ApiRouter` 类型自本包导出,s5 的 implement 侧消费。
- 空 fragments 下 handler 对一切路径不匹配 → 404(验收链路)。

## Scalar / OpenAPI 文档接入(2026-08-02,全部实测于 beta.21)

- 插件名是 `OpenAPIReferenceHandlerPlugin`(`@orpc/openapi/plugins`),不是外部资料所称的 `OpenAPIReferencePlugin`。构造项:`spec`(静态文档或函数值,函数每次命中 specPath 时调用)、`specPath`(默认 `/spec.json`)、`docsPath`(默认 `/`)、`docsTitle`;两个 path 都相对 handler prefix 解析(挂 `/api` 下即 `/api/docs`)。
- **不需要 `@orpc/zod`**:Zod 4 原生实现 Standard JSON Schema,`@orpc/json-schema` 的 `StandardJsonSchemaConverter` 直接转出(minLength、format: uuid 等探针全通过),生成 OpenAPI 3.1.2。`@orpc/json-schema` 本就是 `@orpc/openapi` 的传递依赖,显式声明进 catalog 即可。
- `OpenAPIGenerator.generate(router, options)` 的 `info` 不是顶层选项,走 `base: { info: {...} }`(`base` 是 `Partial<OpenAPIDocument>` 整体合并)。
- Scalar 页把生成的 spec **内联**进 HTML(`content: stringifyJSON(spec)`),不引用 specPath URL;断言文档页应查 `Scalar.createApiReference` 标记。脚本默认走 jsdelivr CDN(dev-only 可接受,离线需 `providerScriptUrl` 自托管)。
- 生成器对 handler prefix **零感知**:paths 恒为前缀相对,Try-it 会按页面 origin 打根路径 404。修法是文档级 `servers: [{ url: prefix }]`(经 `base` 注入,Scalar 与一切 spec 消费者按相对 server URL 解析到 origin+prefix)——**不要**把前缀写进 contract path(handler 匹配前先剥 prefix,会变双前缀;契约必须部署无关)。prefix 真源在 server 插件 config,由扩展点 factory 参数带出。
- orpc handler plugin 是单 init 实例,handler 每次路由变更整体重建——扩展点必须注册 **factory** 而非实例(server.contributeOpenApiPlugin 每次 rebuild 以当前 router 快照造新实例,spec 缓存随实例自然失效)。

## 从 contract 推导 typed error(2026-08-03,beta.21 实测)

- contract → client 类型是 `RouterContractClient<C>`(`@orpc/contract`)。**没有** `ContractRouterClient`(外部资料所称的名字在 beta.21 不存在)。
- `InferClientError<Client>`(`@orpc/client`)返回 `Error | ORPCErrorFromErrorMap<TErrorMap>`。那个裸 `Error` 成员是陷阱:`AllErrors extends { code: infer C } ? C : never` 这类**非分布式**写法(被检查类型不是裸类型参数)会因为 Error 不含 code 而整体塌成 `never`。必须写成裸类型参数的分布式 helper,逐成员过滤:
  ```ts
  type Defined<E> = E extends { defined: boolean; code: string } ? E : never
  type CodesOf<E> = E extends { code: infer C } ? C : never
  type DataOf<E, Code> = E extends { code: Code; data: infer D } ? D : never
  ```
  实测:未声明的 code 被拒、data 字段写错名被拒、无 data 的 code 推出 `undefined`。
- **contract 侧的字面量必须活着**:用计算键构造 `.errors({...})` 的辅助函数如果参数不是泛型,返回类型会退化成 `{ [x: string]: ... }`,整条错误联合随之失效(codes 变成 `string`)。辅助函数要泛型化 `<Code extends ...>(code: Code, ...)` 并把返回类型写成 `{ [K in Code]: ... }`,才能保住字面量键。

## 从已构建 router 反读契约错误状态(2026-08-03,beta.21 实测)

`walkProcedureContractsSync(router, cb)`(`@orpc/server`)可遍历 `implement(contract).router({...})` 的产物,回调**第一参就是 procedure contract 本身**(不是 `{contract}` 解构对象,嵌套 router 自动递归)。procedure 的 `~orpc.errorMap` 保有契约声明的 `{status, message, data}`,因此 beta.21 「handler 忽略契约 status、只认 errorStatusMap」这一适配可以完全收进宿主:宿主自己走一遍 router 取状态,插件不必第二次交出同一张表。实测 `{ALPHA:409, BETA:422}` 精确提取,含嵌套。
