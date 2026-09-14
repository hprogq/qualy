# Web Release Protocol(已实现)

实施方案见 docs/version.md;本文记录落地后的形态与操作要点,是运维与后续改动的依据。

## 三个身份

| 身份             | 含义                                    | 来源                                                         | 用途                            |
| ---------------- | --------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `resolutionHash` | bundle / 进程用的是哪一套插件装配       | `qualy.lock.json`                                            | 装配指纹校验,启动硬失败         |
| `releaseId`      | 一次具体 Web build 或一次 dev Vite 会话 | `qualyRelease()` 插件铸造(`QUALY_RELEASE_ID` 或自铸不透明名) | 只比较相等:更新检测、诊断、日志 |
| `clientProtocol` | 浏览器与 API 的兼容代际(小整数)         | `@qualy/release-contract`                                    | 兼容窗口 `min..max`,不兼容 409  |

契约包 `@qualy/release-contract`:常量、四种文档的 Effect Schema(私有的 `WebReleaseIdentity` / `WebBuildMetadata` / `InstalledWebRelease`,公开的 `ReleaseProbe`)、`RELEASE_ID_PATTERN`、跨 tab 消息 schema。

**公开 id 与私有 revision 分开**(2026-09-15):不给 `QUALY_RELEASE_ID` 时,production build 自铸 `r_` + 22 位 base64url(16 字节随机)——没有时钟、没有顺序,浏览器唯一能做的是比较相等;`QUALY_BUILD_REVISION`(commit / 构建号)只写进 `dist/.qualy-web-build.json` 与 store 的 `.qualy-release.json`,不进 bundle、不进探针。

## 构建与安装

- `pnpm build` = `vite build`(`qualyRelease()` 写 `virtual:qualy/release` 与 `dist/.qualy-web-build.json`)+ `packages/build/web/src/stage.ts` 调 `installWebRelease` 装进 `packages/plugins/infra/web/client-dist`。
- Store 布局:`current.json`、`assets/`(所有保留 release 的 hashed 资源共存)、`releases/<id>/`(shell、public 文件、`.qualy-release.json`)。安装顺序 assets → shell(临时目录整体 rename)→ pointer;同名 asset 字节不同硬失败;同 release 重装幂等;`current` 永远指向完整的 release。
- 保留策略:最近 `QUALY_WEB_RELEASE_RETAIN_COUNT`(默认 5)个 ∪ 最近 `QUALY_WEB_RELEASE_RETAIN_HOURS`(默认 72)小时;current 永不删;任何 release 的 metadata 读不出来则整个不 GC。
- `node tools/quality/check-staged-web.ts [store]`:校验 current release 完整(index.html、所有 declared assets、resolutionHash = lock)并打印 releaseId;CI 在 build 后跑它。
- 未来部署:CI 产出 `apps/web/dist`,部署侧对持久化的 store(host volume,例如 `/var/lib/qualy/web`)调用同一个 `installWebRelease`,再启动新进程;asset 历史不得只放在容器可写层。

## 生产服务(`@qualy/plugin-web`)

- boot 读一次 `current.json` → 校验 release metadata、index.html、`resolutionHash == AssemblyInfo` → **pin 到进程生命周期**;之后 pointer 改变不影响本进程。
- `/assets/*` 从共享目录服务,`public,max-age=31536000,immutable`,缺文件 404 绝不回 shell;其余从 pinned release 目录服务(SPA fallback),`Cache-Control: no-cache`,仅 html 导航带 document-only 头(X-Frame-Options / COOP / CSP / Reporting-Endpoints);favicon 等 public 文件 no-cache。两套都逐请求查盘(sirv `dev: true`),asset 在运行期被 GC 后是 404 而不是进程崩溃;隐藏路径(`/.`)一律 404。
- `GET /__qualy/release`:pinned release 的 `ReleaseProbe`(`{schema: 2, releaseId}`,只有身份),`no-store`,不鉴权,在 `/api` 之外。开发态由 `qualyRelease()` 的 Vite 中间件答同一端点,后端不实现。**探针不再答 `mode` 与 `serverProtocol` 窗口**(2026-09-15,最小披露,见 docs/browser-public-surface.md):页面在这里只问「服务端换 release 了吗」,能不能继续通话由 API 在第一个真实请求上回答。因此探针文档有自己的代次(`RELEASE_PROBE_SCHEMA = 2`),私有三份文档仍是 `RELEASE_SCHEMA = 1`。

## 浏览器

- `main.tsx` 从 `virtual:qualy/release` 取 `webRelease`,创建一个 `ReleaseCoordinator`(`@qualy/web-runtime/release`)并 `start()`;`<html data-release>` 标记当前 release(公开诊断)。
- 探测时机:回到可见且距上次 ≥ 5 分钟、`pageshow.persisted`(bfcache)、`online`、`vite:preloadError`、其他 tab 的 `BroadcastChannel('qualy:release')` 广播。只以 `releaseId` 相等与否判断;探测失败静默,绝不误报「已更新」。
- 状态:`current` / `update-available`(右下角通知:稍后 / 刷新,「稍后」记住该 release)/ `reload-required`(整屏接管,原因 `release-skew` / `asset-load-failed` / `client-protocol`,阻断态不被后续探测降级)。**永不自动 reload**。
- API 传输:`RuntimeProvider clientIdentity={webRelease}` → `clientFor()` 在每个请求加 `X-Qualy-Web-Release` / `X-Qualy-Client-Protocol`;原始响应为 409 且带 `X-Qualy-Client-Unsupported: 1` 时通知 coordinator(`client-protocol`),原请求照常失败。
- `index.html` 的 boot 脚本:20 秒 watchdog 与「入口 script / stylesheet 加载失败」立即恢复共用一个幂等的 `showRecovery(kind)`;文案来自构建注入的 `#qualy-boot-copy` 数据块(`bootstrapMessages` 裁出的三行),脚本静态、CSP hash 不随文案变。

## 服务端兼容检查(`apps/server/src/client-compatibility.ts`)

只看 `/api/*`。无 `X-Qualy-Client-Protocol` 通过(CLI、外部集成、测试 client);在 `min..max` 内通过;否则 409 + `X-Qualy-Client-Unsupported: 1` + `no-store` + `{ code: 'QUALY_CLIENT_PROTOCOL_UNSUPPORTED', received, supported }`,不进入 handler。顺序:request context → access log → metrics → response headers → origin guard → client compatibility → router(测试证明:跨站请求先被 403,得不到窗口信息)。`releaseId` 不做兼容门槛。

## Breaking change 的发布顺序

**2026-09-15:`CURRENT_CLIENT_PROTOCOL` 已升到 2**,窗口同为 `min = max = 2`。原因是 manifest 去掉了
每个 surface 背后的模块名(见 docs/browser-public-surface.md),那是每个页面都要读的文档、服务端
无法同时服务两种形状——所以下面的 expand → contract 顺序**不适用于这一类改动**:它适用于服务端
能同时服务新旧两种形状的变更。形状本身破坏时只能一次到位,旧 tab 在第一个 API 请求上收到 409,
被阻断屏要求刷新。

以下是能同时服务时的顺序:

1. Expand:server 窗口 `min..max+1`,部署 server。
2. 发布 Web(`CURRENT_CLIENT_PROTOCOL` = max+1)。
3. 等旧 tab 自然淘汰(通知 + 刷新)。
4. Contract:server `min` 提升,旧客户端此时才收到 409 并被阻断屏要求刷新。

禁止:同时删旧字段 + 发新 Web + 假设所有浏览器立刻刷新。

## 明确不做

Service Worker / PWA 预缓存;每 30 秒轮询;`vite:preloadError` 无条件自动刷新;给 hashed asset `no-cache` 或给 favicon `immutable`;每个请求重读 `current.json`;把 `releaseId` 当兼容门槛;把 `resolutionHash` 当 build id。
