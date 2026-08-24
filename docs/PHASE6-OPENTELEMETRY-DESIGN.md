# Phase 6 — OpenTelemetry 实施设计

## 1. 目标

Phase 6 为 Qualy 建立完整但克制的可观测性基础设施。完成后必须能够回答：

1. 一次 API 请求经过了哪些 Effect 业务操作、耗时分别是多少；
2. 某个请求是否慢在数据库、授权、业务逻辑或外部依赖；
3. HTTP 请求率、错误率、p50/p95/p99 延迟如何；
4. 数据库调用和连接池是否成为瓶颈；
5. AuditEvent / SignInEvent 能否通过 `traceId` 回到当时的运行链路；
6. 生产 Telemetry 后端故障时，Qualy 业务是否仍能正常运行；
7. 开发环境完全本地运行，不依赖腾讯云；生产环境通过标准 OTLP 接入腾讯云。

Phase 6 **不是**重做 Audit、登录日志或业务历史。它们是长期业务事实；OpenTelemetry 是运行诊断数据。

---

## 2. 已确定的总体架构

> 2026-08-25 按 6.1–6.5 的落地实现修订:应用侧不引入 `@effect/opentelemetry` 与
> `@opentelemetry/*` SDK 家族,遥测出口是 **Effect 官方内置的 OTLP 实现**
> (`effect/unstable/observability` 的 OtlpTracer/OtlpMetrics/OtlpExporter),
> 输出标准 OTLP/HTTP。这不是自研 exporter:上游 LLMS 明确建议新项目使用这套
> lightweight Otlp modules,`@effect/opentelemetry` NodeSdk 只在需要整合已有
> OpenTelemetry setup 时使用。

```text
Development

Effect tracing / Metric registry
    │
    ▼
effect/unstable/observability
  OtlpTracer / OtlpMetrics / OtlpExporter
  (@qualy/telemetry 从标准 OTEL_* 环境变量装配)
    │ OTLP/HTTP
    ▼
Qualy OTel Collector
    │ OTLP
    ▼
grafana/otel-lgtm
    ├─ Tempo
    ├─ Mimir/Prometheus-compatible metrics
    └─ Grafana (:3001)


Production (Tencent Cloud)

Qualy Server
    │ OTLP/HTTP, localhost/private network
    ▼
Qualy OTel Collector
    ├─ traces  ──────────────► Tencent Cloud APM
    └─ metrics ──────────────► Tencent Cloud Managed Prometheus (TMP)

Qualy JSON stdout/file
    └────────────────────────► Tencent Cloud CLS via LogListener

Audit DB / Sign-in DB
    └─ request_id + trace_id ─► correlate with APM
```

关键边界：

- Qualy 应用只认识标准 OTLP endpoint；
- Qualy 代码不得依赖腾讯云 APM/TMP/CLS SDK；
- 腾讯云 Token、Remote Write Token 和腾讯云 endpoint 只存在 Collector/部署配置；
- Telemetry export 是 best-effort，不能让业务请求因 Collector/APM/TMP 不可用而失败；
- Audit 写入不是 best-effort，仍按业务事务要求执行；
- Logs 第一阶段继续使用 Qualy 现有 Logger，不迁移到 OTel Logs SDK。

---

## 3. 与当前代码的对接点

当前仓库重要事实：

- `apps/server/src/main.ts` 是运行根；
- `apps/server/src/runtime.ts` 组合所有插件和 HTTP server；
- `apps/server/src/logging.ts` 已有 Qualy 自定义 structured logger；
- `apps/server/src/access-log.ts` 已有 HTTP access log middleware；
- `apps/server/src/run.ts` 在真正加载 `main.ts` 前运行；
- `packages/plugins/infra/database/src/server/orm.ts` 集中管理 `entityManager()`、`transaction()`、`query()`；
- `Db.scope(...).query(...)` 是插件查询数据库的统一入口；
- 项目为纯 ESM，开发命令通过 `node --import tsx` 运行；
- 当前 Node.js 要求 `>=24`；
- Effect 生态包必须保持同一 beta/RC 版本策略。

不得绕过这些结构创建第二套 runtime、logger 或数据库连接。

---

## 4. 包与目录设计

新增核心包，而不是普通 Plugin：

```text
packages/core/telemetry/
├── package.json
└── src/
    ├── config.ts
    ├── context.ts
    ├── resource.ts
    ├── sdk.ts
    ├── metrics.ts
    └── index.ts
```

建议包名：

```text
@qualy/telemetry
```

理由：Telemetry 必须包在 Plugin assembly 外层，观测 HTTP server、Plugin service、Database、Scheduler，而不是作为其中一个普通业务插件存在。

另外增加部署配置：

```text
ops/observability/
├── collector.local.yaml
├── collector.production.yaml
└── README.md
```

开发环境 compose 增加 profile：

```text
observability
```

不要把腾讯云专属逻辑放入 `packages/core/telemetry`。

---

## 5. 依赖策略（2026-08-25 按 6.1 裁决修订）

### 5.1 Effect

**默认不引入 `@effect/opentelemetry`，也不引入任何 `@opentelemetry/*` 包。**
遥测栈整体来自 `effect/unstable/observability`（与 effect 同包、同版本、同 vendor
校验），零新增依赖面，版本对齐问题在结构上不存在。

`@effect/opentelemetry` 从「Phase 6 必选依赖」改为「出现明确 interoperability
requirement 时才重新评估的方案」——例如必须与一个已存在的 OpenTelemetry setup
（外部 TracerProvider、第三方 instrumentation 生态）共存时。届时仍按 vendor/version
policy 处理：与 effect 同版本、同步 vendored 源码、全门禁。

### 5.2 OTel JS

第一阶段实际引入的 OTel JS 包：**零个。** OTLP trace/metric export、resource、
标准环境变量解析全部由 effect 内置模块承担。

`@opentelemetry/instrumentation-pg` 的裁决见 §12.1（已拒绝，含重评条件）。
禁止为了“方便”引入 auto-instrumentations-node 一类整套 instrumentation 的包。

---

## 6. TelemetryConfig（2026-08-25 按 6.1 实现修订）

优先使用 OpenTelemetry 标准环境变量，不重复创造 Qualy 专属变量。

**应用侧实际支持的标准变量集合**（即 rc.111 的 `Otlp*.layerFromConfig` 真实读取的
集合，加 @qualy/telemetry 的少量兜底；这不等价于完整 OTel JS SDK 的配置面，列表
之外的 OTEL_\* 变量设了也不起作用）：

```text
OTEL_SDK_DISABLED
OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION
OTEL_RESOURCE_ATTRIBUTES
OTEL_EXPORTER_OTLP_ENDPOINT（及 _TRACES_ / _METRICS_ 信号级变体，信号级是完整 URL）
OTEL_EXPORTER_OTLP_PROTOCOL（http/protobuf 缺省 | http/json；grpc 是启动拒绝）
OTEL_EXPORTER_OTLP_HEADERS（及信号级变体）
OTEL_TRACES_EXPORTER / OTEL_METRICS_EXPORTER（未设按 OTel 规范缺省 otlp）
OTEL_EXPORTER_OTLP_TIMEOUT（及信号级变体）
OTEL_BSP_SCHEDULE_DELAY / OTEL_BSP_MAX_EXPORT_BATCH_SIZE / OTEL_BSP_EXPORT_TIMEOUT
OTEL_METRIC_EXPORT_INTERVAL（Qualy 缺省 60000）/ OTEL_METRIC_EXPORT_TIMEOUT
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE
```

**明确不支持**：`OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`（effect 内置
OTLP tracer 不读取，见 §20）；`OTEL_LOGS_EXPORTER`（Logs 不走 OTel，见 §14）。

Qualy 自有信息只允许少量补充：

```text
QUALY_VERSION
QUALY_INSTANCE_ID
```

推荐默认（@qualy/telemetry 已内置的兜底）：

```text
OTEL_SERVICE_NAME=qualy-server
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_METRIC_EXPORT_INTERVAL=60000
```

开发环境如果没有启动 observability profile：

- 推荐 `OTEL_SDK_DISABLED=true`；
- 不应持续刷 exporter connection error；
- `pnpm dev` 必须仍能正常工作。

---

## 7. Resource 规范

所有 traces/metrics 必须至少携带：

```text
service.namespace = qualy
service.name = qualy-server
service.version = <build/git version when available>
deployment.environment.name = development | staging | production
service.instance.id = <stable per process/instance id>
```

原则：

- `service.name` 不带机器编号；
- `service.instance.id` 才区分多个实例；
- 不把 tenant/user/org 等业务 ID 放进 Resource；
- 腾讯云 APM 的 `token`、`host.name` 由 Collector 的 production trace pipeline 注入，Qualy 应用不设置。

---

## 8. 启动顺序

Telemetry 初始化必须早于应用主体，但不得破坏现有 root logger。

推荐：

```text
apps/server/src/run.ts
    │
    ├─ parse mode / NODE_ENV
    ├─ preload/initialize telemetry instrumentation if enabled
    ▼
apps/server/src/main.ts
    ├─ existing logging layer
    ├─ verify assembly
    └─ makeApplication()
```

`run.ts` 是正确的 bootstrap 位置，因为它当前就在动态加载 `main.ts` 之前运行。

Telemetry shutdown 必须作为 scoped/finalized resource 关闭，确保正常 SIGINT/SIGTERM 时 flush；但是 flush 超时不能无限阻塞 Qualy 退出。

建议 telemetry shutdown deadline <= 5s，并服从现有总体 graceful-shutdown timeout。

---

## 9. HTTP tracing

### 9.1 Root span

每一个 API 请求应有一个 server span。

Span name 必须使用低基数路由模板：

```text
POST /api/assessment/entries/:entryId/submit
```

禁止：

```text
POST /api/assessment/entries/019.../submit
```

标准属性优先使用 OpenTelemetry HTTP semantic conventions，例如：

```text
http.request.method
http.route
http.response.status_code
server.address
url.scheme
```

不要自行发明 `httpMethod`、`statusCode` 等重复字段。

### 9.2 Effect HTTP 自带 tracing（2026-08-25 按 6.3 实现修订）

已核实并复用：`HttpEffect.toHandled` 无条件套 `HttpMiddleware.tracer`，server span
继承 W3C `traceparent`、回填全套 semconv 属性与 status；router 在命中时把模板路径
写进 `http.route` 属性。**没有第二个 HTTP root span。**

span 名的路由模板化由 api-kit 的 `routeSpanNames` serve 中间件完成：响应结束后按
`http.route` 把 span 的 `name` 赋成 `{method} {route}`。这是对 `Tracer.Span` 声明
接口（无 rename 操作）的一处已知越界，被三个条件圈住：隔离在 api-kit 一处；依据
rc.111 vendored 源码逐条核实（两种 span 实现的 `name` 都是运行时可写属性且 end 后
才读）；**api-kit request 套件里的真 OTLP export pinning test 是 load-bearing
upgrade gate**——每次 Effect 升级它红了就意味着这个 seam 需要重新裁决。上游若出现
正式 rename API，换掉此越界。不要为追求接口纯洁改回第二个 root span。

### 9.3 Access log

当前 `access-log.ts` 保留，但增强：

```text
requestId
traceId
```

生产 JSON 示例（2026-08-25 按 6.8 落地修订：关联字段是**顶层键**，由 logger 在
发射点从当前 fiber 注入，任何一行都带、不只 access log；无请求/无 trace 时缺席，
不伪造）：

```json
{
  "timestamp": "...",
  "level": "Info",
  "source": "http",
  "request_id": "...",
  "trace_id": "...",
  "span_id": "...",
  "message": "POST /api/... 200 81ms",
  "annotations": {}
}
```

不要把完整 URL query string 直接作为 span name 或 metric label。

---

## 10. RequestContext 与 TraceContext

Phase 1 已规划/实现的 `RequestContext` 应与 OTel 对接，而不是被替代。

目标结构：

```ts
interface RequestContext {
  requestId: string
  clientIp?: string
  userAgent?: string
  sessionId?: string
  traceId?: string
}
```

规则：

- `requestId` 为 Qualy 请求 ID；
- `traceId` 来自当前 OTel span；
- 两者同时保留；
- Audit/Sign-in 只通过 Context 获取，不直接 import OpenTelemetry API；
- `traceId` 为空是合法状态，例如 telemetry disabled 或非请求后台任务；
- 后台任务若有 span，也可以拥有 traceId，但没有 requestId。

---

## 11. Effect 业务 Span 策略

当前大量代码使用 `Effect.fn('...')`。这些 span 由 effect 内置的 OTLP tracer 直接
导出（6.1 起即生效，无需任何桥接包），应尽量利用现有 Effect tracing，而不是手写
每个 span。

### 11.1 应保留/创建 span 的操作

```text
Iam.users.create
Iam.users.update
Iam.users.setEnabled
Iam.users.delete
Iam.users.restore

Rbac.require
Rbac.grants.create
Rbac.grants.revoke

Assessment.entry.submit
Assessment.review.process
Assessment.result.publish

Storage.signUpload
Storage.commitUpload

Scheduler.run / boundary processing
Audit.record
```

### 11.2 不应创建 span 的纯函数

```text
toDto
normalizeIdentifier
isBlank
formatDate
buildFingerprint
sorting/mapping helpers
```

Trace 是业务执行图，不是 profiler。

### 11.3 Span attributes

允许的低风险属性示例：

```text
qualy.operation = submit
qualy.entity.kind = assessment.entry
qualy.outcome = success | failure
```

高基数 ID 只在确实有排障价值时放 trace，默认不要放：

```text
user.id
tenant.id
entry.id
batch.id
organization.id
```

Audit 已经可以通过 traceId 关联具体业务对象，不需要把所有 PII/IDs 再复制到遥测系统。

---

## 12. PostgreSQL tracing

### 12.1 裁决：不采用 pg auto-instrumentation（2026-08-25，6.5 落地）

`@opentelemetry/instrumentation-pg` 已评估并拒绝：它要求 §5 裁决不引入的
`@opentelemetry/*` SDK 家族（TracerProvider + context manager）；被 patch 的驱动
span 只能 parent 进 OTel context，与 Effect tracer 桥接又需要
`@effect/opentelemetry`；且其 ESM loader hook 在 Node 24 + tsx 下的可靠性正是
§12.2 自己标记的风险。§12.3 的手动边界 span 是**当前正解**，不是权宜。

**重新评估 pg auto-instrumentation 仅当**：

- 驱动级连接获取 span 成为排障必需；
- 需要安全的按操作/查询摘要，而现有 DB 抽象边界拿不到；
- Qualy 因其他独立理由已引入 OTel JS SDK；
- Effect/OTel 提供了干净的官方 context bridge；
- ESM instrumentation 已可靠，并被生产启动路径的 out-of-process
  integration test（真 server + 真 PostgreSQL + collector 收到 db client span）
  证明。

注意：**DB pool 可观测性不因此延期，它属于 Phase 6.6**（从现有数据库基础设施层
以稳定 API 导出，见 §13.3）。

### 12.2 ESM / Node 24 风险（历史背景，支撑 12.1 的裁决）

Qualy 是 TypeScript + ESM + Node >=24 + `tsx`。OpenTelemetry 对第三方模块 ESM
patching 依赖 loader/import hook，历史上 Node 24 存在兼容性问题。若未来按 12.1
的条件重启评估，必须以生产入口的 out-of-process integration test 证明，不得仅凭
“package 已安装”判定成功。

### 12.3 手动边界 span（已落地，是正解而非 fallback）

已在 `packages/plugins/infra/database/src/server/orm.ts` 落地（全部查询的唯一漏斗）：

```text
db.query        kind=client, db.system.name=postgresql
db.transaction  仅真 BEGIN 分支；join 分支零新 span（加入不是开启）
```

SQL text/parameters/rows 一律不采集——此边界只见 opaque thunk，这是当前更适合
Qualy 的默认安全边界，不是暂缺。`TransactionManager` 的 JOIN-EXISTING 事务传播
语义与 span 层次由同一条真 PostgreSQL 测试（tracing.test.ts）钉住。

非阻塞增强（评估后再做）：当 `QueryFailed.cause` 能稳定安全取得 SQLSTATE 时，给
失败 span 加 `db.response.status_code` 与 `error.type`——只放 SQLSTATE/稳定错误
类别，不放 error message、constraint payload 或 SQL 数据；若需要碰 brittle
driver internals 就不做。

---

## 13. Metrics 设计

第一阶段只做基础设施 + 少量业务指标。

### 13.1 HTTP RED

必须可以得到：

- Request rate；
- Error rate；
- Duration histogram；
- 按 `http.route`、method、status class 聚合。

如果 Effect HTTP/OTel instrumentation 已产生标准 server metrics，复用，不重复创建。

### 13.2 Runtime

建议：

- process CPU；
- RSS / heap；
- event loop lag；
- GC（如果当前 OTel Node runtime instrumentation 稳定）。

### 13.3 PostgreSQL

- `db.client.operation.duration`（**stable** 语义约定）：在 `query()` 漏斗直接记录；
- pool 指标（`db.client.connection.count` / `db.client.connection.pending_requests`
  等）：**当前仍是 Development 状态的语义约定**，使用时明确这一点，不当作永不变化
  的 stable contract；
- pool 数据源必须是 MikroORM 7.1.13 + pg 8.22.0 的稳定/足够可靠 API（pg.Pool 的
  `totalCount`/`idleCount`/`waitingCount` 是文档化公开属性）。只能靠很深的
  private field / undocumented object graph 取到的指标**不做**，明确记录哪些无法
  安全获取，由 PostgreSQL/云侧监控补充。

### 13.4 第一批 Qualy 业务指标

保持很少：

```text
qualy.auth.sign_in
  attributes: outcome, provider_type

qualy.assessment.entry.submit
  attributes: outcome

qualy.assessment.review.decision
  attributes: decision

qualy.scheduler.run.duration
qualy.scheduler.run.failure

qualy.storage.operation.duration
qualy.storage.operation.failure
```

命名必须在实现时按当前 OTel metric naming guidance 校准。

### 13.5 Cardinality 硬规则

任何 Metric label 禁止包含：

- UUID；
- userId；
- tenantId；
- entryId；
- batchId；
- orgNodeId；
- email / businessNo；
- user-controlled arbitrary string；
- URL path 实例值；
- error message 文本。

允许：

```text
operation=submit
outcome=success
provider_type=oauth
http.route=/api/.../:id
http.request.method=POST
```

建议新增测试/静态 helper，限制业务 metrics 只能通过预定义 attribute key/type 构造。

---

## 14. Logs correlation

第一阶段不启用 OTel Logs exporter。

保留 `apps/server/src/logging.ts`。不换 Pino/Winston，不启用 OTel Logs SDK。

目标不止 access log：**请求范围内的重要 structured logs 都要能与当前 trace/span
关联**。实现位置是 Qualy 自定义 Logger 的 renderer/emission 边界——从当前 fiber
context 读 `RequestContext.requestId`、`Tracer.ParentSpan` 的 traceId/spanId,
调用方不必手动 `annotateLogs`,业务 child span 内产生的日志拿到的是当时真正的
child `spanId`,而不是永远写 HTTP root 的。

生产 JSON 的关联字段标准化为顶层键(便于 CLS 直接建 JSON key index,对齐腾讯云
APM ↔ CLS 按 TraceID/SpanID 关联的查询方式):

```json
{
  "request_id": "...",
  "trace_id": "...",
  "span_id": "..."
}
```

其他普通 annotations 保留原结构。没有可靠 span 时不要伪造或长期固定 root spanId。

禁止日志写入：

- Authorization header；
- Cookie；
- session token；
- OAuth code/access_token/refresh_token；
- CAS ticket；
- password；
- Client Secret；
- 申报正文；
- 大块 request/response body。

Telemetry correlation 不改变 AuditEvent / SignInEvent 的数据模型，只负责填充已有/规划的 `traceId`。

---

## 15. Collector — 本地开发配置

应用永远向统一 endpoint 发：

```text
http://127.0.0.1:4318
```

本地 Collector 再发给 `grafana/otel-lgtm`。

推荐 `collector.local.yaml`：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 192
    spike_limit_mib: 48
  batch:
    timeout: 2s
    send_batch_size: 512

exporters:
  otlp/local_lgtm:
    endpoint: otel-lgtm:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/local_lgtm]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/local_lgtm]
```

Collector 和 LGTM 镜像必须 pin 版本或 digest，不提交 `latest`。

### 15.1 Docker Compose profile

建议添加：

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:<PINNED>
    profiles: [observability]
    command: ['--config=/etc/otelcol/config.yaml']
    volumes:
      - ./ops/observability/collector.local.yaml:/etc/otelcol/config.yaml:ro
    ports:
      - '127.0.0.1:4317:4317'
      - '127.0.0.1:4318:4318'
    depends_on:
      - otel-lgtm

  otel-lgtm:
    image: grafana/otel-lgtm:<PINNED>
    profiles: [observability]
    ports:
      - '127.0.0.1:3001:3000'
```

只把 Grafana/Collector 暴露给 localhost。

启动：

```bash
docker compose --profile observability up -d
pnpm dev
```

Grafana：

```text
http://localhost:3001
```

普通业务开发不需要 observability 时：

```bash
docker compose up -d postgres
OTEL_SDK_DISABLED=true pnpm dev
```

---

## 16. Collector — 腾讯云生产配置

生产 Collector 只做 traces + metrics 路由。

腾讯云 Token 不进入 Qualy 应用进程。

示意：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317
      http:
        endpoint: 127.0.0.1:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 192
    spike_limit_mib: 48

  batch:
    timeout: 5s
    send_batch_size: 1024

  resource/tencent_apm:
    attributes:
      - key: token
        action: upsert
        value: ${env:TENCENT_APM_TOKEN}
      - key: host.name
        action: upsert
        value: ${env:QUALY_INSTANCE_ID}

exporters:
  otlp/tencent_apm:
    endpoint: ${env:TENCENT_APM_OTLP_ENDPOINT}
    # TLS settings must match the endpoint returned by Tencent console.

  prometheus_remote_write/tencent_tmp:
    endpoint: ${env:TENCENT_TMP_REMOTE_WRITE_URL}
    headers:
      Authorization: 'Bearer ${env:TENCENT_TMP_TOKEN}'
    external_labels:
      service: qualy-server
      environment: production
    resource_to_telemetry_conversion:
      enabled: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource/tencent_apm, batch]
      exporters: [otlp/tencent_apm]

    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus_remote_write/tencent_tmp]
```

注意：最终配置必须以所 pin Collector 版本（当前 0.159.0）的实际 schema 为准，
**不要照旧文档复制字段**——0.159 已推荐把 `prometheus_remote_write` 的
endpoint/headers 等 HTTP client 配置放进 `http:` block。必须在 pinned 镜像内执行：

```bash
docker compose --profile observability run --rm --no-deps \
  otel-collector validate --config=...
```

初期不上 tail sampling（见 §20），但生产 pipeline 结构上保留未来插入
`tail_sampling` processor 的位置。

不要在文档/仓库中提交真实 Token。

---

## 17. 腾讯云 Trace 路由

生产 trace：

```text
Qualy → Collector → Tencent APM
```

APM 要求 OpenTelemetry Resource 中携带业务系统 Token，腾讯云文档示例使用：

```text
token=<APM token>
host.name=<instance identifier>
service.name=qualy-server
```

Qualy 应用不设置 `token`；Collector 的 trace pipeline 注入。

优先使用同地域内网 APM endpoint；只有部署环境无法连内网 endpoint 时才使用公网 endpoint。

---

## 18. 腾讯云 Metrics 路由

生产 metrics：

```text
Qualy → Collector → Prometheus Remote Write → TMP
```

TMP 控制台提供：

- Remote Write URL；
- Token；
- HTTP API / Grafana datasource 信息。

Collector 使用 Remote Write，不需要在生产再自建 Prometheus server。

初始存储：15 天。

初始 export interval：60 秒。

成本保护目标：初期总 series 尽量 <= 1000。

---

## 19. 腾讯云 Logs 路由（2026-08-25 修订：CLS 原生 OTLP，LogListener 不再需要）

CLS 已原生支持标准 OTLP/HTTP 上报，日志走与 traces/metrics 同一个 collector：

```text
Qualy（OTEL_LOGS_EXPORTER=otlp 显式开启；stdout JSON logger 照常是主日志面）
    ↓ OTLP
Collector logs pipeline
    ├─ 本地 Loki（LGTM 原生吃 OTLP logs）
    └─ otlp_http → CLS 公网 endpoint（Basic Auth = SecretId/SecretKey，
       basicauth extension；topic 经 `topic_id` header）
```

不装 LogListener、不建机器组、不经 APM 上报日志。OTLP LogRecord 原生携带发射
fiber 的 TraceId/SpanId（effect OtlpLogger 实测），APM↔CLS 关联按这两个字段。
`request_id` 只在 stdout JSON 的顶层键里（OTLP record 的 attributes 来自 log
annotations，request_id 不在其中）——CLS↔审计暂经 trace_id 关联。

CLS 键值索引仅开启必要字段（6.8 落地后的顶层键名）：

```text
timestamp
level
source
message
request_id
trace_id
span_id
```

默认不要开全量全文索引，控制成本。

日志保留初始 15 天。

---

## 20. Sampling（2026-08-25 修订：应用侧无 sampler 配置面）

**事实**：rc.111 的 `OtlpTracer.layerFromConfig` 不读取 `OTEL_TRACES_SAMPLER` /
`OTEL_TRACES_SAMPLER_ARG`。不要留下一个看起来可配置、实际完全不起作用的环境变量。
当前策略：

```text
application:
  Effect native tracing
  initial sampling = 全部正常 sampled 的 Effect span（实际 100%）

production Collector:
  初期不做 sampling

future:
  Collector tail_sampling
    errors   = 100%
    slow     = 100%
    ordinary = 10~20%
```

理由：腾讯云 APM 中国大陆普通地域当前每天前 100 万 Span 上报和存储有免费额度，Qualy 初期没有必要过早采样。采样归 Collector（tail sampling），不为支持一个
sampler 环境变量把 runtime 换成 OTel JS SDK。若未来确需在 span 产生前做 head
sampling，那是重新评估 full OTel SDK / Effect sampling capability 的触发条件之一。

### 后续触发条件

只有当：

- Span/day 明显增长；
- APM 成本接近预算；
- Collector/网络负载有实际压力；

才引入 Collector tail sampling。

未来策略目标：

```text
error traces       100%
slow traces        100%
ordinary traces     10%~20%
```

Sampling 只能影响 Telemetry，不得影响 Audit/Sign-in history。

---

## 21. 隐私与安全硬约束

以下内容禁止进入 trace/log/metric：

```text
password
credentialHash
clientSecret
Authorization
Cookie
session token
OAuth authorization code
OAuth access/refresh token
OIDC token
CAS ticket
完整 SAML assertion
申报正文
审核长文本
附件内容
```

默认不记录 request body / response body。

SQL：

- 参数化 SQL text 可接受；
- bind values 禁止；
- query results 禁止。

Metrics 不允许高基数字段。

Collector 的 APM/TMP Token：

- 仅 production secret/env；
- 不进入 `.env.example` 的真实值；
- `.env.example` 只写空 placeholder；
- 不打印到启动日志；
- 不作为 resource export 到非对应 backend。

---

## 22. Failure semantics

必须建立明确区别：

### Audit

```text
Audit write fails
→ sensitive business transaction fails/rolls back
```

### Telemetry

```text
Collector/APM/TMP unavailable
→ business request still succeeds
→ exporter retries/buffers within bounded limits
→ eventually telemetry may be dropped
```

因此：

- 业务 Effect 不得 `yield* exporter.send()`；
- OTLP export 由 SDK batch processor 异步完成；
- Collector 内必须有 batch + memory_limiter；
- 不允许无限 queue/memory growth；
- Collector 自己需要 healthcheck。

---

## 23. Dashboard / Query 目标

第一阶段至少建立：

### HTTP Overview

- request rate；
- 4xx/5xx rate；
- p50/p95/p99 latency；
- 按 route 排序的 slow endpoints；
- 按 route 排序的 errors。

### Runtime

- RSS/heap；
- CPU；
- event-loop lag（若可用）。

### Database

- query duration；
- pool active/idle/waiting；
- query errors。

### Qualy business

- sign-in success/failure；
- assessment submit success/failure；
- review decisions；
- scheduler failures。

APM Trace UI 用腾讯云 APM；Metrics UI 可先使用 TMP 自带能力，后续自建 Grafana 作为统一 metrics dashboard。

---

## 24. 测试策略

### 24.1 Unit tests

测试：

- Telemetry disabled config；
- Resource attributes；
- requestId/traceId extraction；
- metric attribute allowlist/cardinality guard；
- sensitive attribute helper 拒绝危险字段。

### 24.2 Integration — OTLP

在 test 中启动 in-memory/fake OTLP receiver 或真实 Collector，断言：

```text
API request
→ server span emitted
→ service.name = qualy-server
→ trace id valid
```

### 24.3 Integration — Audit correlation

执行一个会写 AuditEvent 的操作：

```text
HTTP request
→ AuditEvent.traceId
→ equals emitted trace traceId
```

### 24.4 Integration — Sign-in correlation

成功登录与失败登录分别断言：

```text
SignInEvent.traceId == current traceId
```

不要把 password/identifier secret 写入 span/log fixture。

### 24.5 Integration — PostgreSQL

真实 PostgreSQL：

```text
HTTP → Effect service → DB
```

断言 trace 至少包含数据库边界 span。

如果使用 pg auto-instrumentation，则测试必须证明 Node 24 + ESM + tsx/production entrypoint 都有效。

### 24.6 Failure test

关闭 Collector：

```text
POST business endpoint
→ still succeeds
```

并确认：

- 不无限等待；
- 不出现 unhandled rejection；
- shutdown 不被 exporter 永久卡住。

---

## 25. CI / Quality gates

新增 gate：

1. `pnpm typecheck`；
2. `pnpm test`；
3. `pnpm vendor:check`；
4. collector config validate；
5. observability integration test；
6. grep/lint 防止 committed Tencent token；
7. metric label policy test。

如果 observability backend Docker 镜像只用于 integration，可把慢测试放入明确的 integration suite，而不是每次极轻量 unit test 都启动 LGTM。

---

## 26. 开发任务拆解

### 6.1 — Core telemetry package

- 创建 `@qualy/telemetry`；
- Effect OTel layer；
- trace + metric OTLP exporter；
- resource metadata；
- disabled mode；
- graceful shutdown。

### 6.2 — Local observability stack

- `otel-collector` container；
- `grafana/otel-lgtm` container；
- compose profile；
- pinned image tags；
- healthchecks；
- local README。

### 6.3 — HTTP / RequestContext correlation

- server span；
- W3C trace propagation；
- route template；
- requestId；
- access log `requestId/traceId`；
- Audit/SignIn traceId propagation。

### 6.4 — Effect business spans

- 验证 `Effect.fn` export；
- 清理不合理 span name；
- 为缺少关键边界的操作加 span；
- 不给纯函数加 span。

### 6.5 — PostgreSQL

- 尝试 pg instrumentation；
- Node 24/ESM integration test；
- fallback database spans；
- 禁止 query params/results。

### 6.6 — Metrics

- HTTP RED；
- process/runtime；
- DB pool；
- 第一批 Qualy metrics；
- cardinality guard。

### 6.7 — Production Collector

- Tencent APM trace exporter；
- Tencent TMP remote write exporter；
- resource token injection；
- secrets-only config；
- config validation。

### 6.8 — CLS log correlation

- JSON fields standardized；
- requestId/traceId；
- production file/stdout collection contract；
- no OTel Logs SDK yet。

### 6.9 — Verification / dashboards

- local walkthrough；
- Tencent staging verification；
- cost/series/span count dashboard；
- docs finalized。

---

## 27. 验收标准

Phase 6 只有满足以下条件才完成：

1. `docker compose --profile observability up -d` 后，本机 Grafana 能看到 Qualy trace 与 metrics；
2. 普通 `pnpm dev` 在 telemetry disabled 时无需腾讯云也正常运行；
3. 一个真实 API trace 能看到 HTTP root + Effect 业务 span + DB boundary；
4. span name 不含 UUID/动态 URL；
5. Metric labels 没有 UUID/用户输入；
6. AuditEvent / SignInEvent 可保存当前 traceId；
7. Qualy JSON log 包含 requestId/traceId；
8. Collector 关闭时业务 API 不失败；
9. 腾讯云生产 Collector 能把 trace 发到 APM；
10. metrics 能通过 Remote Write 进入 TMP；
11. CLS 可以按 `traceId` 检索到相关日志；
12. 不存在 secret/body/token 泄漏；
13. 所有 image/package version 已 pin；
14. 全部 repository quality gates 通过。

---

## 28. 明确非目标

Phase 6 不做：

- 前端 Browser RUM；
- Session Replay；
- 自建 Tempo/Loki/Prometheus production cluster；
- 腾讯云托管 Grafana；
- OTel Logs SDK 全量替换 Qualy logger；
- 每个函数自动建 span；
- request/response body tracing；
- 全量用户级 metrics；
- 一开始就做复杂 tail sampling。

这些以后可以按实际需要增量增加。
