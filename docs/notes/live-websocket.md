# 批次实时通道：从 SSE 迁到 WebSocket

2026-10-28 用户要求把 `/api/assessment/batches/:batchId/events` 从 SSE 迁为原生 WebSocket（同源 WSS）。迁移只替换传输：事件仍是不带业务数据的唤醒，收到后由页面经既有授权端点重读；过滤、突发合并、query invalidation 和轮询降级保持不变。数据读写继续走 HTTP，通道上没有 RPC，也没有业务写能力。

## 为什么换

EO 主站默认 15 秒回源应答超时曾在首个 25 秒心跳前切断已返回 200 的事件流（见 [EO 切换记录](edgeone-rollout.md#主站-sse-空闲超时修复)）。规则改为 60 秒后恢复，但 SSE 在 CDN 上始终是一个“长时间不结束的 HTTP 响应”，受应答超时约束；EO 对 WebSocket 的约束是 300 秒空闲超时（不是总寿命）。迁移后，应用 25 秒心跳远小于该空闲上限，不再依赖主站规则上的应答超时覆盖。是否可以撤销那条 60 秒覆盖，需要生产验收后另行决定，本次不改 EO。

## 实现位置

| 部分                                             | 位置                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 协议常量、关闭码、页面对关闭码的处理             | `packages/core/api-kit/src/live-socket.ts`                                                                      |
| 服务端连接泵（心跳、存活、入站校验、寿命、复核） | `packages/core/api-kit/src/live-socket-server.ts`                                                               |
| HTTP 与 WS 共用的客户端兼容判断 `clientRefusal`  | `packages/core/api-kit/src/client-assembly.ts`                                                                  |
| 批次通道的鉴权、配额、受众过滤、指标与日志       | `packages/plugins/assessment/core/src/live/watch.ts`                                                            |
| 配额账本（作用域内占位，释放恰好一次）           | `packages/plugins/assessment/core/src/live/connections.ts`                                                      |
| 会话是否仍有效（只读，不续期）                   | `SessionPresence`：契约 `@qualy/auth-contract/session`，实现 `packages/plugins/base/auth/src/server/session.ts` |
| 标签页内共享连接、状态机、退避                   | `packages/web/runtime/src/live-channel.ts`                                                                      |
| React 接入 `useLiveChannel`                      | `packages/web/runtime/src/live-channel-context.tsx`                                                             |
| 测试用假服务器                                   | `@qualy/testkit/browser`（`packages/testkit/browser/src/live.ts`）                                              |

服务端 socket 使用 Effect 自带的 `HttpServerRequest.upgrade` 与 `effect/socket` 的 reader/writer（`repos/effect/packages/effect/src/socket/Socket.ts`、`repos/effect/packages/platform/node/src/NodeHttpServer.ts`）；浏览器端用 `Socket.makeWebSocket` 加 `WebSocketConstructor`，测试注入假构造器。握手、跟踪 span 与连接作用域沿用 formula LSP 已有的 `webSocketSession`。

## 握手与身份

浏览器 WebSocket 不能设置请求头，HTTP 传输在头里说的内容改为：

- **通道版本**：子协议 `qualy.live.1`。未提供或不一致时，升级后以 4409 `protocol` 关闭。
- **API 代际与 release**：查询参数 `protocol`、`release`，与 HTTP 头使用同一个 `clientRefusal` 判断；同名参数出现多次按无效处理。两者都不是秘密（release id 本来就在页面 HTML 里）。
- **会话**：同源 cookie，和所有请求一样；URL、日志、关闭原因中都没有会话或令牌。
- **语言**：不传。通道上没有任何面向读者的文字。
- **Origin**：沿用 formula 的严格同源判断（经可信代理解析出的公开 origin）。跨站页面在握手前得到 403，不需要可读的关闭码。

端点用 `Viewer`（解析会话但不拒绝），因为浏览器读不到被拒绝握手的状态码，只能看到与断网相同的 1006。所有页面需要区别处理的拒绝都在升级完成后以关闭码表达。判断顺序为兼容 → 会话 → 批次可见性 → 配额；前面任一步拒绝的连接都不占配额。

`x-qualy-activity` 语义保持：升级请求不带该头，会话中间件不续期；心跳是 WebSocket 帧，不经 HTTP，也不续期。

## 帧与关闭码

服务端 → 浏览器：每帧一个 `{"kind": ...}`，首帧总是 `sync`（在订阅总线之后发送，订阅与 sync 之间不会漏事件），之后是过滤后的唤醒；每 25 秒一个 `heartbeat`。

浏览器 → 服务端：只允许文本 `pong`，用于回应心跳。非 `pong` 文本 1008，二进制 1003，超过 64 字节 1009，单批超过 4 帧 1008。服务端 60 秒（两次心跳加余量）没听到回应则以 4408 关闭；浏览器同样在 60 秒没收到任何帧时自行关闭并重连。

| 关闭码                                 | 含义                                 | 页面动作                                   |
| -------------------------------------- | ------------------------------------ | ------------------------------------------ |
| 4000 `renew`                           | 连接寿命到期（10 分钟 ±10%）         | 0–1 秒内重连并重新鉴权，不显示“断线”       |
| 4401                                   | 无会话，或复核发现会话已结束         | 不再重连，交给运行时的会话丢失流程         |
| 4403                                   | 不能观看该批次，或复核发现权限已撤销 | 不再重连，页面自身读取会各自报错           |
| 4409 + `protocol`/`assembly`/`release` | 页面与服务器不兼容                   | 不再重连，交给 release 协调器提示刷新      |
| 4429 + `session`/`capacity`            | 会话 6 个席位或进程 2000 个席位已满  | 进入“等待席位”，抖动退避重试，页面继续轮询 |
| 4408、1001、1006、1008、1009、1011 等  | 无响应、服务端停机、断网、协议错误   | 有上限的抖动退避重连                       |

## 连接生命周期

**服务端。** 每 2 分钟（±20%）复核一次：会话是否仍有效（`SessionPresence`，只读、不续期），批次是否仍可见，并刷新用于过滤的粗站位；复核本身失败按 1011 关闭，不当作通过。寿命与复核间隔都带随机偏移，进程重启后大量页面不会在同一秒续期。

**浏览器（每个标签页一份注册表）。**

- 按“身份 + 通道地址”共享：同一批次的多个屏幕共用一条连接，不同批次各一条，不做多批次复用、站点级总线或 SharedWorker。
- 引用计数加 3 秒宽限：最后一个持有者释放后保留 3 秒，宽限内重新持有直接复用（StrictMode 双挂载、同批次页面切换）。释放函数幂等。
- 每次拨号是一代。被替换、已释放或身份已变的连接，其回调一律丢弃，不能关闭或覆盖新连接。
- 运行时看到 manifest 换人（登出、切换身份）时，立即关闭其他身份的全部连接，不等宽限。
- 断网重连：1 秒起翻倍、上限 30 秒，从上半区间随机取值；连接稳定（同步后存活 15 秒）后归零。等待席位：4 秒起翻倍、上限 60 秒，同样取上半区间随机值。本标签页内一个已获准的连接结束后，等待席位最久的另一个通道在 0.25–1 秒内提前重试；其他标签页靠各自的抖动错开。
- `online`、`visibilitychange` 回到可见、`pageshow` 时：处于断网退避的通道提前重试；仍开着但超过静默上限的连接立即重连（睡眠唤醒）。
- 每次重连都以服务端 `sync` 为准，页面按 `sync` 重读；没有事件回放。

## 界面

`LiveMark` 增加 `waiting` 状态：文案“正在恢复实时更新”，提示“实时连接暂时已满，正在自动重试”；只有页面在断线时确实按自己的节奏轮询（我的申报、我的成绩）才追加“数据仍会定期更新”。提示通过悬停/聚焦显示，并作为状态的可读描述，不弹窗、不 toast、不阻塞操作。收到 `sync` 即清除。即使页面从未连上（第 7 个连接一开始就被拒），等待状态也会显示，因为占满席位的可能是读者自己的其他标签页。没有加手动重试按钮。

## 可观测性

- `qualy.assessment.live.admission{outcome}`：admitted、quota-session、quota-capacity、unauthenticated、forbidden、unsupported。
- `qualy.assessment.live.close{ending}`：renew、client-normal、client-abnormal、unresponsive、refused、revoked、ended。
- `qualy.assessment.live.open`：当前进程持有的席位数（gauge）。
- `qualy.assessment.live.lifetime{ending}`：连接存活秒数。
- 拒绝和非正常结束记 Info 日志，带 batchId、原因、关闭码、存活秒数；正常结束为 Debug；心跳不记日志。日志不含 cookie、令牌或查询串。升级请求的访问日志和 `websocket.connection` span 在握手完成时结束，长连接不计为慢请求；连接期间不追踪。

## 兼容与取舍

- 不扩大配额，也不在 WebSocket 失败后回退 SSE；SSE 端点与 `useApiStream` 已删除，不长期维护两套。
- 升级前打开的旧标签页仍会以普通 GET 请求该地址，现在得到 426；它们的旧代码会退避重试并继续轮询，刷新后使用新通道。客户端协议代际没有提升，数据读写不受影响。
- 服务端拿不到 `ws` 的发送缓冲量（Effect `Socket` 不暴露），慢客户端由“停止回应心跳即在 60 秒内断开”兜底；期间最多积压一分钟的唤醒，每帧几十字节。
- 复核间隔是撤权生效的上限。同一标签页内的登出和切换身份即时生效；其他标签页登出后，本页下一次 HTTP 读取或下一次复核（以先到者为准）关闭连接。

## 验证

2026-10-28 本地执行，全部通过：`pnpm typecheck`；改动文件的 oxfmt、oxlint 与 type-aware oxlint；涉及包的 Node 测试（232 个文件、1843 个测试，含 PostgreSQL）；全量 Chromium（134 个文件、1797 个测试，其中一项为本次引入的回归，修复后该套件 24 项通过）。WebKit 套件不含这些文件，未运行。分项如下：

- Node：`live-socket.test.ts`（服务端泵：首帧 sync、心跳、无回应 4408、非法帧 1008/1003/1009、寿命 4000、复核拒绝与复核失败）、`live-channel.test.ts`（共享、宽限复用、幂等释放、释放未打开的连接后静默、身份隔离与即时关闭、URL 与子协议、续期不显示断线、未稳定即断显示断线、稳定后断线与重拨未应答、退避递增、席位等待与恢复、席位等待后转为网络失败时不再显示“已满”、本页释放席位后提前重试、30 个标签页同时被拒后错开重试、4401/4403/4409 停止拨号、心跳回应与静默重连、非法帧）、`live-connections.test.ts`、`backoff.test.ts`。
- 真实端口与 PostgreSQL：`live-watch.test.ts`（跨站 Origin 与缺 Origin 握手前 403、普通 GET 得 426、无会话 4401、无权批次 4403、协议/release/子协议/重复参数 4409、第 7 个连接 4429 且空出席位后恢复、非法帧关闭并归还席位、会话删除后在一次复核内 4401、所有用例结束后账本归零）、`live-audience.test.ts`。
- Chromium：`live-channel.browser.test.tsx`（StrictMode 下两个屏幕一条连接、宽限后关闭、换人立即关闭、4401 触发会话丢失流程且不再重连）、`live-mark.browser.test.tsx` 及原有六个使用批次通道的页面套件。

## 未验证的生产验收项

以下需要在部署后用真实已登录浏览器经 EO 确认，本次没有部署，均未验证：

1. 经 `wss://qualy.hprogq.cn` 的升级成功，响应子协议为 `qualy.live.1`，首帧 `sync`。
2. 连续观察超过 300 秒，期间多轮 `heartbeat`/`pong`，EO 不因空闲关闭；观察到 10 分钟左右的 4000 续期后自动重连并再次 `sync`。
3. EO 转发的 `Origin` 与 `X-Forwarded-*` 使同源判断通过；伪造 Origin 被 403。
4. 同一会话打开 7 个批次页面时第 7 个显示等待状态、继续轮询，关闭一个后自动恢复。
5. 蓝绿切换时旧色关闭（1001）后页面自动重连到新色，不整页重载。
6. EO 日志或控制台中 WebSocket 连接不计入异常；主站 60 秒应答超时覆盖是否还需要保留另行评估。
