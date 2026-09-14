# Browser Public Surface(最小披露政策)

设计来源 docs/plugin-refactor.md §2.2 / §39 / §112 / §117。本文记录**当前仓库真实成立**的形状,
以及还没收口的部分,随每个阶段更新——不写计划,只写现状与守卫它的那条测试。

## 一句话

> Browser 知道产品语义,Server 知道装配语义。

浏览器需要什么才能完成产品行为,就给什么;「这个页面由哪个包实现」「这套装配启用了哪些插件」
不在其中。

## 这不是安全机制

身份认证、授权、租户隔离、资源授权、限流、Origin/CSRF 检查、输入校验、审计**全部仍在服务端**,
一条都不许换成「浏览器看不见就不会做」。最小披露只回答另一个问题:在安全边界已经成立的前提下,
公开面上还留着多少没人需要的实现信息。

同理,它也不限制运维诊断。服务端日志照常写插件 id、provider、module、trace id、装配哈希;
限制的只是 **public wire、public HTML、public assets、browser console** 四处。

## 浏览器可以知道

```text
当前用户能访问哪些页面、页面路径与产品 ID
某次请求失败了,以及稳定的公开错误码
某个页面组件崩溃了
当前运行的是哪个 opaque release
X-Qualy-Request-Id(与服务端日志对账的唯一把手)
完成上传或上报所必需的公开/临时数据
```

这已经足够从「浏览器出事」走到「RUM → release → source map → requestId → 服务端日志 → trace」。

## 浏览器不应该知道

```text
哪个 npm package 实现了某个页面
本次装配安装/启用了哪些插件,依赖图长什么样
layout 由谁提供
某个组件对应哪个源码文件
被停用插件有什么功能
readiness 失败的是哪个基础设施
服务端内部的 capability / provider 名
resolutionHash、数据库/模块/源码实现细节
```

## 当前各公开面的形状

| 公开面                           | 现在的形状                                                         | 守卫                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /api/app/manifest`          | 只有产品身份:page id / path / layout contract / slot key + item id | ui-registry effect-manifest.test「names product surfaces and never what implements them」(三种 viewer) |
| `GET /api/auth/login-methods`    | `{code, type, name, mode}`,renderer 按 `type` 找                   | effect-sign-in.test / effect-api.test                                                                  |
| `GET /__qualy/release`           | `{schema: 2, releaseId}`                                           | release-contract.test / release-vite.test / effect-web.test / apps/web release.browser.test / smoke    |
| `GET /health/ready` 失败         | `{_tag: "NotReady"}`,503                                           | apps/server/tests/effect-shell.test「readiness with a probe that fails」                               |
| `/api/docs`、`/api/openapi.json` | 生产默认 404(`QUALY_API_DOCS=public` 才开)                         | apps/server/tests/api-docs.test + smoke                                                                |
| API 错误                         | `{_tag, 公开字段}`,诊断只进 header 与日志                          | tools/tests/error-codes.test、effect-error-shape.test                                                  |
| 浏览器 console / RUM 上报        | surface 地址(`page:assessment/review`),不含模块路径                | apps/web/tests/rum.browser.test「the seams the runtime reports at」                                    |
| public HTML                      | 只有产品描述,不宣告架构                                            | 人工:`apps/web/index.html`                                                                             |
| SourceMap、surface→模块映射      | 生成 → 留在构建产物 → **不进 release store**                       | check-staged-web、release-store.test                                                                   |

## 浏览器按 surface 寻址

这是本轮最关键的一处结构改动。浏览器拿到的是**产品身份**,解析出的是渲染器:

```text
manifest: { id: "assessment/batches", path, layout: "workspace-shell/v1" }
browser:  pageComponents["assessment/batches"]      → import(...) → 组件
```

四个地址空间各一张表(page id / layout contract / slot key + item id / login driver type),
由 collector 从描述器直接生成并逐个查重(build 拒绝重复认领,不依赖 server 先启动)。
`ClientComponentRef`(`./client/X.tsx`)仍在,但**只活在构建期**。

以前 manifest 发的是 `componentKey(pluginId, ref)` 派生的 `<插件>/<源文件名>`——
`assessment/ReviewPage`、`auth-local/LoginMethod`——那是把包布局和源码文件名变成了公开协议,
而且两个插件同名组件会无谓相撞。`componentKey()` 已删除。

诊断同步改成 surface:console 打 `page:assessment/review failed`,RUM 上报
`{surface: {kind, id}}`,缺组件的诊断码从 `component-missing` 改为 `surface-missing`。

这是一次 **client protocol 破坏性变更**(1 → 2):manifest 是每个页面都读的文档,服务端无法同时
服务两种形状,所以旧 tab 在第一个 API 请求上收到 409 并被要求刷新——那正是这套机制存在的理由。

### 私有的另一半

surface 不再说出实现,但实现不能因此消失,否则 `surface-missing` 和「这个页面落在哪个 chunk」
都无从回答。构建把答案写在 `apps/web/dist/.qualy-browser-surfaces.json`:

```json
{
  "page:assessment/review": {
    "owner": "@qualy/plugin-assessment",
    "module": "./client/review/ReviewPage.tsx",
    "export": "default"
  }
}
```

规则与 sourcemap 完全相同:随构建产物归档,**不进 release store、不服务**;
`check-staged-web` 递归扫描 store 并拒绝任何 `PRIVATE_BUILD_FILES`。

## 两个发布标识,一公一私

```text
QUALY_RELEASE_ID      公开、不透明的 release 身份
QUALY_BUILD_REVISION  私有,这次构建对应的 commit / 构建号
```

不给 `QUALY_RELEASE_ID` 时,production build 自己铸一个 `r_` + 22 位 base64url(16 字节随机):
**没有时钟、没有顺序、没有 revision**,浏览器唯一能对它做的事是比较相等。

私有映射写在两处,都不对外服务:

```text
apps/web/dist/.qualy-web-build.json        构建产物旁(安装器读,不进 release store)
<store>/releases/<id>/.qualy-release.json  安装后(dotfile,静态服务对 /. 一律 404)
```

因此「r_xxx 是哪个 commit」有答案,而答案不在浏览器手里。部署侧若自己命名 release,
同样应当给不透明值,并把 commit 放进 `QUALY_BUILD_REVISION`。

## 报告端口属于平台,不属于插件

浏览器侧的上报词汇——`captureException` / `captureDiagnostic` / `setObservedPage`——在
`@qualy/browser-observability`(`packages/web/observability/`)。调用它的是组件边界、路由观察器
和组合根,这些都是平台;平台 import 一个可选插件,那个插件就不再可选。插件那边只剩「哪个 provider」:
`@qualy/plugin-rum` 持有注册表与 `startBrowserRum`,vendor 代码全在 `@qualy/plugin-rum-tencent`。

这条现在由门禁守:`tools/tests/plugin-isolation.test.ts` 的「the platform depends on no plugin
implementation」逐文件扫 `packages/web` / `packages/core` / `packages/contracts` 的 import 与
package.json 依赖。`@qualy/plugin-kit`(写插件用的 kit)与 capability facade
(`@qualy/plugin-x/plugin`)不算;**剩下的边逐条具名**——一条 import(文件 + specifier)加一条
package.json 依赖,都是同一条边的两面:`packages/web/runtime/src/index.tsx →
@qualy/plugin-ui-registry/api`,Phase F 移进 `@qualy/app-contract` 后删掉这两条例外。

清单是**逐边**而不是逐包:按包豁免会让任何 platform 文件 import 该插件的任意子路径都静默通过,
而清单看上去仍然「只有一条例外」。第三条用例把两条边的字面量钉死,所以清单只会变短。

## 已知仍未收口(各自属于后续阶段)

- **409 响应体仍带服务端协议窗口**:`QUALY_CLIENT_PROTOCOL_UNSUPPORTED` 的 `supported: {min,max}`
  (Phase D1 §43 会连同 assembly 兼容一起重做)。
- **生产 JS chunk 名仍带组件名**:`assets/<chunk.name>-[hash].js`(§23)。
- **生产 Web artifact 仍是 installed 超集**:停用插件的浏览器代码仍进产物(Phase D1)。

## 明确不做

不靠加密 manifest、API 路径哈希、整体 JS 混淆、隐藏 HTTP status、删 requestId、停 SourceMap
上传来实现「最小披露」。这些要么没有真实安全收益,要么直接破坏可观测性与可维护性。
Gate 的目标不是「攻击者看不懂 JS」,而是「我们没有主动发布不必要的实现元数据」。
