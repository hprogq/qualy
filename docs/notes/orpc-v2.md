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
