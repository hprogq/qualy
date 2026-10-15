# Formula RPC 心跳误断线与长连接计时

2026-10-15 在生产 `v0.1.0-rc.31` 上排查。镜像 revision 为
`8e8f4591bc6470f3289f4584ea2232f01a8d8b00`，Node 为 24.21.0，Effect 为 4.0.4。

## 生产现象与证据边界

北京时间 09:44:36，公式预览返回 503，耗时 11 ms；09:44:44，同一预览端点返回
200，耗时 292 ms。LSP 多次连接成功，在几十秒后关闭，随后两次连接以 7–21 ms
返回 503，再次连通。检查窗口内共有 1 次预览 503、18 次 LSP 503、8 次预览成功和
17 次 LSP 101。

两个沙箱在 09:13:43 已启动，检查时均无容器重启或 OOM；authoring 的 cgroup
`oom`、`oom_kill`、进程上限事件和 CPU throttling 均为 0。服务端、数据库、代理和
备份等 `qualy-deploy doctor` 检查全部通过。这排除了本次观察中可见的容器重启、
内存耗尽和 CPU 配额节流，但普通健康检查不证明长时间 RPC 连接正常。

原始服务日志只有 HTTP 状态行，APM 只保留 `RpcClientError` 的
`SocketReadError: An error occurred during Read`，没有保留嵌套的 `ping timeout`。
因此不能逐条倒推历史 503 的最底层原因；以下对照探测直接确认了同一生产环境中的
心跳误断线机制。

## 只读对照探测

在现有 server 容器内启动两个临时客户端，均连接现有 authoring Unix socket，
开始和结束各读取一次 `GetAuthoringCapabilities`，中间空闲 50 秒。没有编译公式、
创建 LSP 会话、修改文件、改配置或重启服务。

| 客户端          | 心跳间隔 / 超时 | 50 秒内结果                                                           |
| --------------- | --------------- | --------------------------------------------------------------------- |
| Effect 默认配置 | 5 秒 / 5 秒     | 在约 10.023、20.035、30.043、40.052 秒触发 `onPingTimeout` 并断开重连 |
| 带余量的配置    | 5 秒 / 15 秒    | 无超时、无中途断开，结束时能力请求成功                                |

两边最后的断开均发生在探测主动关闭 scope 时，不计为故障。

## Effect 4.0.4 的实际行为

依据与 catalog 同版本的只读上游：

- `repos/effect/packages/effect/src/rpc/RpcClient.ts`：`makePinger`、
  `makeProtocolSocket`、`defaultRetryPolicy`。
- `repos/effect/packages/effect/src/rpc/RpcServer.ts`：收到 `Ping` 后回复 `Pong`。

`pingTimeout` 默认等于 `pingInterval`。每次心跳 tick **先**检查距最后收到帧的时间
是否已经超过超时，再决定是否发送 Ping。定时器晚几毫秒运行，就可能在给对端发送
下一次 Ping 之前主动断开；连接初次空闲时甚至可以一条 Ping 都没发就超时。
本地真实 Unix socket 探测也复现了约 5010 ms 失败、服务端收到 0 条 Ping。

连接被断开后，RPC client 保存 `currentError`，在重连成功前直接返回这个错误，
因此 HTTP 503 可以只花几毫秒。重连退避持续增长，又能解释故障间隔内连续几次
快速失败。公式编译和 LSP 的错误映射将原因丢弃，进一步掩盖了这一过程。

修复采用明确的 5 秒心跳和 15 秒无入站帧超时，给正常调度和往返留出多个心跳周期。
真正没有响应的对端仍会被断开；已经失败的编译、执行和 LSP 请求不自动重放。
传输诊断只记录端点类别、操作及受限原因分类，不记录公式源码、artifact 或任意对端
返回的错误文本。

## HTTP 建连与会话时长

原有 SSE 在响应头建立时结束 server span 和请求时长指标；WebSocket 缺少等价边界，
LSP handler 也覆盖了整段会话，因此生产日志的 `101 28293ms` 与 APM 的约 28 秒
属于连接存活时间，不能作为握手慢的证据。

Node 平台的 `request.upgrade` 只返回惰性的 Socket；实际 upgrade 在获取
`Socket.reader` 时发生。应在 reader 获取成功后记录 101 并结束 HTTP server span、
请求时长指标与访问日志；升级之前失败仍按真实 HTTP 错误处理。连接后续工作进入
通过 span link 关联的 INTERNAL 会话 trace，长时间会话不再作为 HTTP 请求延迟。

依据为 `repos/effect/packages/platform/node/src/NodeHttpServer.ts` 和
`repos/effect/packages/effect/src/socket/Socket.ts`。回归应以真实连接验证握手后、
连接关闭前已导出 HTTP span，并确认关闭连接不会再次记录 HTTP 请求。

`repos/effect/packages/effect/src/internal/effect.ts` 的 `addFinalizer` 捕获注册时的
Context，因此 LSP 会话获取及清理也在独立会话 scope 内运行。否则即使 HTTP span 已结束，
稍后发出的 `CloseLsp` 子 span 仍会延长原 HTTP trace。升级前的 LSP 失败诊断通过
span link 或本地日志 request ID 关联 HTTP 503，不能假定两者的 trace ID 相同。

本地验证覆盖真实 Unix socket 保活、沉默对端超时与重连、失败调用不重放、Formula
远程编译与 LSP 全链路，以及真实 WebSocket 的 OTLP 导出、HTTP 时长指标和访问日志。
类型检查与修改文件的格式、typed lint 检查通过。全仓 lint 和 typed lint 仍被本次
未修改文件中的两处无用导入阻挡，不据此宣称全仓门禁通过。

本次生产操作仅诊断。上述代码修复仍需经过发布流程上线，生产对照探测不代表现有
常驻客户端已采用修复。

## 会话 span 同样在建立时结束（2026-10-15）

上线后 APM 仍有约 196 秒的 `websocket.connection`（INTERNAL）和 `LspEvents`（CLIENT）。
前者覆盖整段会话，后者是 RPC 客户端为流式调用建立的 span，随事件流存活。两者都是
连接存活时间，不是操作耗时。

现行做法：`webSocketSession` 在握手成功时结束 `websocket.connection`，与 SSE 的
server span 取同一时刻；连接未升级时以 handler 的结果结束。会话期间的往来
（每条消息一次 `SendLsp`、整段 `LspEvents`）以 `Effect.withTracerEnabled(false)` 运行，
结束时分离执行的 `CloseLsp` 同样不追踪，失败仍写日志。连接如何结束（时长、关闭或失败
及原因）由访问日志的 connection 行记录。

依据：`repos/effect/packages/effect/src/rpc/RpcClient.ts` 的流式请求用
`makeSpanScoped` 建 span，生命周期等于流；`internal/effect.ts` 的 `makeSpanUnsafe`
在 tracer 关闭时返回 noop span。回归由 api-kit 的真实 WebSocket 测试覆盖：连接 span
在套接字仍打开时已导出且短于 200 ms；去掉提前结束后该测试失败。
