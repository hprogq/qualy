# Sandbox 进程隔离、Formula 编译服务与 LSP 开发设计

> 实施基线：Formula 4a.1 收口后的 `main`
>
> 本文是后续 Sandbox 容器化与 Formula 4b 的实施规范。不得借此重构 assessment 业务、UI 平台、audit、telemetry 或 dev supervisor。

## 1. 目标

当前 Formula 已完成严格类型 Schema、TS7 typecheck、esbuild deterministic bundle、QuickJS-WASM 执行、不可变 FormulaVersion 发布与测试闭环。

下一步将所有会处理管理员提供代码的计算迁出 Qualy 主业务进程。

最终要求：

```text
管理员 Formula 源码
        │
        ▼
┌──────────────────────────┐
│ Qualy Server             │
│                          │
│ Auth / RBAC / DB / Audit │
│ 不解析、不编译、不执行源码 │
└───────────┬──────────────┘
            │ Unix Domain Socket
            ▼
┌──────────────────────────┐
│ Authoring Sandbox        │
│                          │
│ TS6 AST source policy    │
│ TS7 authoritative check  │
│ esbuild                  │
│ TS7 LSP                  │
└──────────────────────────┘

最终 artifact
        │
        ▼
┌──────────────────────────┐
│ Runtime Sandbox          │
│                          │
│ Worker                   │
│ QuickJS-WASM             │
│ fresh Runtime + Context  │
└──────────────────────────┘
```

Qualy Server 保留一切可信业务决策：

```text
FormulaFunction / FormulaVersion
权限检查
draftRevision CAS
发布幂等
Schema/Profile validation
ScoreAmount assignability
Audit
数据库事务
```

Sandbox 永远不知道 tenant、user、role、item、review、FormulaFunction 或 FormulaVersion。

---

# 2. 必须保持的核心不变量

第一条：

> Qualy Server 进程不得把管理员提交的 Formula source 交给本机 TypeScript compiler、esbuild 或 QuickJS。

第二条：

> Sandbox 不得拥有数据库、会话、对象存储或业务凭据。

第三条：

> Authoring Sandbox 只负责“源码 → artifact”；Runtime Sandbox 只负责“artifact + JSON input → JSON output”。

第四条：

> Sandbox 的输出永远是不可信输入。Qualy Server 必须重新做长度检查、Schema decode、Profile 验证、ScoreAmount proof 和数据库权限检查。

第五条：

> Production 不存在 local fallback。Sandbox 不可用时操作失败，不得退回主进程执行。

第六条：

> Docker 是额外隔离层，不替代现有 Formula language policy 和 QuickJS sandbox。

即使 Runtime container 中的 QuickJS 发生逃逸，攻击者最多首先获得 Runtime container 中的 Node 权限；但 QuickJS 仍然承担 Formula 执行正确性的第一层边界。

---

# 3. 新的代码边界

目标目录：

```text
packages/core/
  value-schema/                 # existing
  formula/                      # existing

  sandbox-rpc/                  # NEW
  sandbox-engine/               # NEW
  formula-compiler/             # NEW

packages/plugins/infra/
  sandbox/                      # MODIFY: 只剩 remote adapter / service contract

packages/plugins/assessment/
  formula/                      # MODIFY: publish orchestration，不再运行 compiler

apps/
  sandbox-runtime/              # NEW
  sandbox-authoring/            # NEW
```

其中 `packages/core/*` 和 `apps/*` 仍按照当前 workspace/tsconfig 约定接入，不建立新的 package-level tsconfig，除非已有工具链要求。

---

# 4. `@qualy/sandbox-rpc`

这是两个安全域之间唯一的协议定义。

依赖只允许：

```text
effect
```

不得依赖：

```text
assessment
org
auth
rbac
database
storage
quickjs
typescript
esbuild
```

协议使用当前仓库冻结版本的：

```ts
effect / unstable / rpc
```

底层使用 Unix Domain Socket。

Effect rc.111 当前已经有 socket RPC server/client、stream response、interrupt、ACK/backpressure 等完整机制；实现必须以 `repos/effect` 当前 vendored rc.111 源码和测试为准，不凭新版文档猜 API。

Node socket implementation 本身支持 Unix-domain `path`。

---

# 5. RPC 序列化

使用：

```ts
RpcSerialization.makeNdjson(...)
```

明确配置 `maxBufferSize`。

不要使用默认的 16 MiB。Effect 本身已经实现 incomplete-frame ceiling；Qualy 必须提供自己的预算。

第一版：

```ts
export const SANDBOX_RPC_MAX_FRAME_BYTES = 2 * 1024 * 1024
```

如果现有 artifact 上限证明 2 MiB 不够，可以提高，但必须保证：

```text
RPC transport ceiling
>
任意合法业务 payload ceiling
```

而不能使用 `"unbounded"`。

RPC payload 内仍有自己的字段级预算。

---

# 6. Runtime RPC

定义：

```text
RuntimeSandboxRpcs
```

至少两个 RPC：

```text
GetRuntimeCapabilities
Invoke
```

概念模型：

```ts
interface RuntimeCapabilities {
  rpcApiVersion: number

  sandboxAbiVersion: number
  quickjsEngineVersion: string
  runtimeBuildId: string

  maxArtifactBytes: number
  maxArgumentsBytes: number
  maxOutputBytes: number

  defaultSoftDeadlineMs: number
  defaultHardDeadlineMs: number
}
```

`runtimeBuildId` 必须表示真实 sandbox-engine 实现，而不是 Docker container 名字。

建议构建时生成：

```text
SHA256(
  sandbox-engine source identity
  + bootstrap identity
  + quickjs variant identity
)
```

---

## 6.1 Invoke 协议

现有业务抽象保持：

```ts
Sandbox.invoke({
  artifact,
  artifactHash,
  entrypoint,
  arguments,
  limits,
})
```

RPC wire 使用明确 JSON string：

```ts
interface InvokeRequest {
  artifact: string
  artifactSha256: string
  entrypoint: string
  argumentsJson: string
  limits: SandboxLimits
}
```

不要通过 RPC transport 引入另一种 number representation。

Formula Decimal 仍是：

```text
canonical decimal string
```

integer 仍受 safe-integer contract 约束。

成功：

```ts
interface InvokeSuccess {
  output: string
}
```

失败使用 typed internal error，例如：

```text
SandboxTimeout
SandboxMemoryExceeded
SandboxStackExceeded
SandboxInputTooLarge
SandboxOutputTooLarge
SandboxArtifactTooLarge
SandboxEvaluationFailed
SandboxWorkerLost
```

这些是内部错误，不直接作为 HTTP wire error 暴露。

---

# 7. `@qualy/sandbox-engine`

把当前 `@qualy/plugin-sandbox` 中真正运行 QuickJS 的代码移进这个包：

```text
pool
worker
QuickJS module loading
bootstrap
resource limits
invoke
error extraction
worker retirement
```

不得出现 Plugin、DB、HTTP 或 assessment 概念。

当前经过验证的模型继续保持：

```text
worker thread
    ↓
每次 invocation
    ↓
new QuickJSRuntime
    ↓
new QuickJSContext
    ↓
invoke
    ↓
dispose context/runtime
```

不得因为外面多了一层 container 就复用 QuickJS Runtime。

---

# 8. Runtime dynamic-code lockdown

继续完成现有 escape suite。

不仅禁止：

```js
globalThis.eval
globalThis.Function
```

还必须实测并封闭 constructor 链：

```js
;(() => {})
  .constructor(function* () {})
  .constructor(async function () {})
  .constructor(async function* () {}).constructor
```

目标不是防止它逃出 Docker，而是确保 Formula 的真实运行语言与 TS7 检查的语言一致：

```text
没有 eval
没有 Function constructor
没有动态生成另一段未经 TS7 检查的 JS
```

QuickJS 0.32 对不同 Function kind 的 prototype chain 必须由测试确定，不凭 V8 行为假设。

---

# 9. `apps/sandbox-runtime`

这是一个非常薄的进程。

允许的依赖：

```text
effect
@qualy/sandbox-rpc
@qualy/sandbox-engine
QuickJS packages
```

禁止：

```text
typescript
esbuild
MikroORM
pg
assessment
auth
rbac
storage
```

启动流程：

```text
process start
    ↓
准备 Effect Layer
    ↓
监听 runtime.sock
    ↓
Capabilities 可立即响应
    ↓
QuickJS worker pool 按当前策略 lazy acquire
```

正常 shutdown 必须：

```text
停止接受 RPC
interrupt in-flight requests
terminate workers
关闭 UDS
删除 socket 文件
```

---

# 10. `@qualy/formula-compiler`

把目前 Formula plugin 中所有 compiler 相关代码迁到这里：

```text
source policy
temporary workspace
TS7 spawning
diagnostic parsing
esbuild virtual resolver
trusted wrapper/prelude
toolchain identity
deterministic artifact generation
```

这个 package 只由：

```text
apps/sandbox-authoring
tests
```

使用。

Qualy Server dependency graph 中不能再通过 Formula plugin 获得 esbuild/compiler runtime。

---

# 11. Source policy 改成 AST

加入 TypeScript 6 Compiler API compatibility package，只用于 AST。

TypeScript 7 继续承担：

```text
authoritative typecheck
LSP
```

TypeScript 6 不参与 type inference、assignability 和 output correctness。

定义：

```ts
export const FORMULA_SOURCE_POLICY_VERSION = 1
```

---

## 11.1 Source policy pipeline

在启动 TS7 之前：

```text
UTF-8 byte limit
    ↓
TS6 parse AST
    ↓
Qualy source policy
    ↓
TS7 strict typecheck
```

当前 regex/lexical module scanner 删除。

AST policy 至少遍历：

```text
ImportDeclaration
ExportDeclaration
ImportEqualsDeclaration
ImportTypeNode
dynamic import CallExpression
AnyKeyword
type assertion / as-expression
```

另外用 TypeScript 官方 preprocessing/scanner 能力处理：

```text
/// <reference ...>
@ts-ignore
@ts-nocheck
@ts-expect-error
```

不要继续用全文 regex 猜 TypeScript syntax。

---

# 12. Formula module policy

第一版只允许正常：

```ts
import { Schema, defineFormula } from '@qualy/formula'
```

允许等价的 type-only named import。

拒绝其他 module dependency。

因此以下全部失败：

```ts
import fs from 'node:fs'

import x from '../../x.ts'

import type X = require('/tmp/x')

type X = import('/tmp/x').X

await import('/tmp/x')

export { x } from '/tmp/x'
```

`import = require()` 第一版一律拒绝，即使 target 是 `@qualy/formula`。

`ImportTypeNode` 第一版同样全部拒绝，避免无必要扩大语言表面。

---

# 13. Type escape policy

继续保持现有严格规则。

拒绝显式 `any`：

```ts
let x: any
;(foo as any) < any > foo
```

拒绝 suppression：

```text
@ts-ignore
@ts-nocheck
@ts-expect-error
```

不要拒绝字符串、注释中恰好出现 `"any"` 的合法内容。

这也是迁 AST parser 的主要原因之一。

---

# 14. Authoring workspace

container image 内置只读：

```text
/opt/qualy/formula-sdk
```

临时工作目录：

```text
/work/<job-id>/
    formula.ts
    tsconfig.json
    node_modules/
        @qualy/formula/
```

不要把整个 Qualy workspace 放进去。

不要 bind mount：

```text
仓库根目录
node_modules 根
.env
.git
用户 home
```

TS7 的 module resolution 即使发生漏洞，也只能看到 authoring container 的最小 filesystem。

---

# 15. TS7 配置

权威 compiler 仍使用当前实际 workspace 的 TS7 toolchain。

固定 Formula tsconfig，不继承 Qualy 根 tsconfig：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": [],
    "lib": ["ES2020"],
    "noEmit": true
  },
  "files": ["formula.ts"]
}
```

具体 flags 以当前已经通过的 Formula staging config 为基准迁移，**不得趁迁移改变现有 Formula TypeScript semantics**。

尤其不启用：

```text
@effect/language-service
```

Formula authoring 与 Effect 无关。

---

# 16. esbuild

当前已经建立的 deterministic virtual namespace 设计保持不变。

最终 build graph：

```text
qualy-internal:entry
    ↓
qualy-user:formula
    ↓
@qualy/formula
    ↓
固定 trusted SDK graph
```

用户 namespace 只允许：

```text
@qualy/formula
```

SDK namespace 允许固定内部依赖。

所有 sourcefile/name 使用稳定虚拟路径。

任何 OS temp path 不得进入 artifact。

迁移 compiler 到 container 后有一个硬门禁：

> 同一 source、同一 tests、同一工具链，迁移前后的 `runtimeJs` 必须逐字节相同。

如果不同，停止施工并解释差异，不能直接更新 golden。

---

# 17. `apps/sandbox-authoring`

允许依赖：

```text
effect
@qualy/sandbox-rpc
@qualy/formula-compiler
@qualy/formula
@qualy/value-schema
typescript 7
TS6 Compiler API
esbuild
```

禁止：

```text
assessment plugin
database
auth
rbac
audit
storage
QuickJS
```

Authoring Sandbox 不运行 Formula artifact。

---

# 18. Authoring RPC

定义：

```text
FormulaAuthoringRpcs
```

本阶段需要：

```text
GetAuthoringCapabilities
CompileFormula
```

4b 增加：

```text
OpenLsp
SendLsp
LspEvents
CloseLsp
```

Capabilities：

```ts
interface AuthoringCapabilities {
  rpcApiVersion: number

  sourcePolicyVersion: number
  sourcePolicyParserVersion: string

  typescriptVersion: string
  esbuildVersion: string

  formulaAbiVersion: number
  formulaRuntimeSha256: string

  authoringBuildId: string

  maxSourceBytes: number
}
```

---

# 19. CompileFormula

输入只需要：

```ts
{
  source: string
}
```

不要传：

```text
tenantId
functionId
userId
draftRevision
tests
```

tests 是发布业务的一部分，不属于 compiler。

成功：

```ts
interface CompiledFormula {
  artifact: string

  sourceSha256: string
  runtimeSha256: string
  formulaRuntimeSha256: string

  sourcePolicyVersion: number
  sourcePolicyParserVersion: string

  typescriptVersion: string
  esbuildVersion: string
  formulaAbiVersion: number

  authoringBuildId: string
}
```

拒绝：

```text
SourceRefused
TypecheckFailed
BundleFailed
```

diagnostic：

```ts
interface CompilerDiagnostic {
  line?: number
  column?: number
  code: string
  message: string
}
```

diagnostics 数量和总 bytes 必须有 ceiling，并保留：

```ts
truncated: boolean
```

---

# 20. `@qualy/plugin-sandbox`

业务 API 不变。

仍然暴露：

```ts
export class Sandbox ...
```

外部 consumer 不知道 remote transport。

实现改成：

```text
Sandbox
    ↓
RuntimeSandbox RPC client
    ↓
runtime.sock
```

不能把：

```text
socketPath
RpcClient
Docker
container
```

泄漏进 assessment。

---

# 21. Production 不允许 Local Layer

可以保留：

```text
SandboxLocalLayer
```

用于 unit test。

但 production assembly 中不得有：

```text
sandbox.mode = local
```

或者：

```ts
remote.catchAll(() => local)
```

Runtime socket 不可达时：

```text
SandboxUnavailable
```

Formula publish 失败。

以后 ScoreRun 也必须失败。

---

# 22. Formula plugin 新增 Authoring service

在 `@qualy/plugin-assessment-formula` 内定义业务无关的：

```ts
FormulaAuthoring
```

或者等价 Context Service。

production implementation：

```text
Authoring RPC client
```

测试 implementation：

```text
local formula-compiler
```

Formula service 不直接：

```text
spawn('tsc')
import esbuild
```

---

# 23. Formula publish 最终流程

冻结为：

```text
HTTP publish request
        ↓
Qualy Server
        ↓
读取 FormulaFunction
RBAC canAt
draftRevision check
        ↓
Authoring Sandbox
        ↓
source policy
TS7
esbuild
        ↓
artifact
        ↓
Qualy Server
        ↓
Runtime Sandbox
        ↓
__qualyContract()
        ↓
Qualy Server
        ↓
validateInputProfile
validateOutputProfile
RE2 pattern/profile checks
output ⊆ ScoreAmount
        ↓
Runtime Sandbox
        ↓
逐个运行 examples
        ↓
Qualy Server
        ↓
构造 publish fingerprint
        ↓
短事务
lock FormulaFunction
重新 canAt
重新 draftRevision
幂等 fingerprint lookup
INSERT FormulaVersion
Audit.record
commit
```

这是唯一发布路径。

---

# 24. Contract 必须从最终 artifact 提取

不要让 Authoring Sandbox直接提供“可信 contract”。

原因是最终实际执行的是：

```text
runtimeJs
```

因此：

```text
runtimeJs
→ Runtime Sandbox
→ __qualyContract
→ JSON
→ Host validation
```

仍然保持。

不能出现：

```text
TS source 得出 schema A
artifact 中实际 schema B
```

的双真相。

---

# 25. FormulaVersion 增补 provenance

当前 FormulaVersion 已经保存 TypeScript、esbuild、Formula ABI、Formula runtime hash、QuickJS、Value Schema、Regex Profile、Sandbox ABI 等冻结信息。

此次应再增加：

```text
source_policy_version integer not null
source_policy_parser_version varchar(...) not null
authoring_build_id varchar(...) not null
sandbox_runtime_build_id varchar(...) not null
```

其中：

`sourcePolicyVersion` 是 Qualy Formula source language policy 的版本。

`sourcePolicyParserVersion` 记录 TS6 parser 实际版本。

`authoringBuildId` 用于审计发布使用的是哪一版 compiler service。

`sandboxRuntimeBuildId` 记录发布 examples/contract extraction 时使用的 runtime implementation。

这些字段主要用于 provenance/audit。

真正 replay compatibility 继续由：

```text
formulaAbiVersion
valueSchemaProfileVersion
regexProfileVersion
sandboxAbiVersion
quickjsEngineVersion
```

控制。

不要因为 build ID 不同就自动拒绝历史 FormulaVersion。

---

# 26. Publish fingerprint

保持现有幂等语义，并确保至少覆盖：

```text
source
tests
最终 runtimeSha256
TypeScript identity
esbuild identity
Formula ABI
Formula runtime hash
source policy version
value-schema profile
regex profile
sandbox ABI
QuickJS engine identity
```

最终 artifact 的 `runtimeSha256` 必须直接参与 fingerprint。

`draftRevision` 只继续承担编辑 CAS，不承担 executable identity。

---

# 27. Unix socket 布局

开发机：

```text
<repo>/.qualy/run/sandbox/runtime/runtime.sock
<repo>/.qualy/run/sandbox/authoring/authoring.sock
```

`.qualy/run` 必须 gitignore。

Production container：

```text
/run/qualy-sandbox/runtime/runtime.sock
/run/qualy-sandbox/authoring/authoring.sock
```

两个目录完全独立。

Runtime container 看不到 authoring socket。

Authoring container 看不到 runtime socket。

---

# 28. Socket ownership

Sandbox app 自己负责：

```text
创建 socket
chmod
删除 stale socket
shutdown unlink
```

Qualy Server 只 connect，不管理 server socket 文件。

Production 中建议：

```text
directory 0770
socket    0660
shared GID
```

如果 Qualy Server 自身运行在 container 中：

```text
runtime volume
  server: read-only
  runtime sandbox: read-write

authoring volume
  server: read-only
  authoring sandbox: read-write
```

Qualy Server 不需要向 socket directory 创建文件。

---

# 29. Dev 模式

当前 Qualy Server 是 host process，因此不能使用只有 Docker 内部可见的 named-volume socket。

开发环境采用 dedicated host bind directory：

```text
.qualy/run/sandbox/
```

Docker 只 bind：

```text
.qualy/run/sandbox/runtime
.qualy/run/sandbox/authoring
```

不得 bind 整个仓库。

建议增加：

```text
pnpm sandbox:build
pnpm sandbox:up
pnpm sandbox:down
```

`pnpm dev` 如果发现 Sandbox socket 不可用，可以给出明确错误：

```text
Sandbox unavailable.
Run pnpm sandbox:up.
```

不要自动启动 local execution fallback。

---

# 30. Docker Runtime Sandbox

配置最低要求：

```yaml
network_mode: none
read_only: true
init: true

cap_drop:
  - ALL

security_opt:
  - no-new-privileges:true

pids_limit: 64

tmpfs:
  - /tmp:size=32m,noexec,nosuid,nodev
```

non-root UID/GID。

初始：

```text
memory 256 MiB
CPU 1
```

具体数值用现有 benchmark 验证后调整。

---

# 31. Docker Authoring Sandbox

同样：

```yaml
network_mode: none
read_only: true
init: true

cap_drop:
  - ALL

security_opt:
  - no-new-privileges:true

pids_limit: 128
```

tmpfs：

```text
/tmp
/work
```

`/work`：

```text
noexec
nosuid
nodev
```

初始：

```text
memory 512 MiB
CPU 2
```

TS7/esbuild executable 必须来自只读 image filesystem，不从 `/work` 执行。

---

# 32. 两个 container 都绝对禁止

```text
Docker socket
host network
host PID
host IPC
privileged
CAP_SYS_ADMIN
repository root mount
.env mount
SSH directory
用户 home
Postgres socket
Redis socket
COS credential
server secret
```

Sandbox container env 只允许自己的基础配置：

```text
socket path
worker/session limits
log level
build identity
```

---

# 33. 仍然存在的逃逸风险

完成 container 化后仍不能宣称“绝对无法逃逸”。

威胁仍包括：

```text
QuickJS/WASM → Node sandbox process
TS7/esbuild vulnerability → Authoring Node process
Node/container runtime vulnerability
Linux kernel/container escape
```

所以失败模型要分层理解。

Runtime container compromised：

```text
攻击者可能：
伪造 Invoke 结果
DoS runtime service
攻击 RPC client parser

攻击者不应能够：
访问 DB
访问 session
访问 COS
访问公网
访问 authoring socket
读取 Qualy source tree
```

Authoring container compromised：

```text
攻击者可能：
伪造 artifact
伪造 diagnostics
DoS compiler service

攻击者不应能够：
访问 DB
访问 runtime socket
访问公网
访问 Qualy source tree
```

因此 Host 对所有 RPC response 继续做 runtime Schema decode 和业务验证。

---

# 34. RPC peer 视为不可信

必须专门测试恶意 RPC server：

```text
invalid NDJSON
oversized incomplete frame
wrong RPC tag
invalid success schema
unexpected error shape
connection reset mid-frame
大量小 frame flood
frame 长时间不结束
```

Qualy Server 必须：

```text
不 crash
不无限 buffer
不反序列化 arbitrary class
不打印对端 stack
```

---

# 35. 4b：LSP 架构

完成上述 process isolation 后再接 Monaco。

流程：

```text
Formula Editor
     │
     │ authenticated HTTP
     ▼
Qualy Server
     │
     │ WebSocket
     ▼
Formula LSP Bridge
     │
     │ Authoring RPC
     ▼
Authoring Sandbox
     │
     └─ tsc --lsp -stdio
```

Browser 永远不能直接连接 Authoring Sandbox。

---

# 36. LSP RPC

增加：

```text
OpenLsp
SendLsp
LspEvents
CloseLsp
```

不要求透明 socket tunnel。

Open：

```ts
{
  initialSource: string
}
```

返回：

```ts
{
  sessionId: string
}
```

session ID 使用 crypto-safe random。

---

## 36.1 SendLsp

请求：

```ts
{
  sessionId: string
  sequence: number
  jsonRpc: string
}
```

Authoring 为每 session 校验 monotonic sequence，防止并发 unary RPC 乱序。

---

## 36.2 LspEvents

server stream：

```ts
{
  sessionId: string
}
```

输出：

```ts
{
  sequence: number
  jsonRpc: string
}
```

底层使用 bounded queue。

Browser 太慢时不得积累无限 LSP response。

---

# 37. LSP process ownership

一个 session：

```text
一个临时 workspace
一个 tsc --lsp -stdio process
一个 bounded outbound queue
```

此前已实测 TS7 LSP 的 `shutdown/exit` 不能作为资源回收保证。

因此：

```text
CloseLsp
idle timeout
absolute timeout
RPC disconnect
Authoring shutdown
```

最终都必须：

```text
SIGTERM
短 grace
SIGKILL
remove workspace
```

LSP protocol shutdown 只作为礼貌步骤，不作为资源回收前提。

---

# 38. LSP session limits

第一版：

```text
global sessions          8
per user                 1
idle timeout             5 min
absolute lifetime        30 min
single browser frame     ≤ 1 MiB
single source            ≤ Formula source budget
outbound queue           bounded
```

这些限制分别在：

```text
Qualy bridge
Authoring service
```

两层都守。

不能仅信 Browser。

---

# 39. 浏览器 WebSocket 的认证

不要在 raw `upgrade` handler 中重新实现一套 Session/Cookie 解析。

推荐采用两步握手。

先走正常已认证 HttpApi：

```text
POST /assessment/formulas/:functionId/lsp-session
```

这个 endpoint 使用当前 Auth middleware 和 Formula `assessment.formula.manage` 权限。

它创建短寿命、一次性的 bridge ticket，绑定：

```text
userId
tenantId
functionId
draftRevision
expiresAt
```

然后 Browser 用 ticket 打开 formula LSP WebSocket。

ticket：

```text
随机
高熵
一次使用
TTL ≤ 30s
```

日志绝不能记录 ticket。

当前部署若只有单 API process，可先用 bounded in-memory TTL store；如果以后进入多 API replica，再将 ticket 改为已有安全 token/seal 机制或共享 store，不在本批引 Redis。

---

# 40. 浏览器不能看到 Sandbox session ID

Browser WebSocket 与 sandbox session 的绑定只存在于 Qualy Server：

```text
browser ws
    ↓
bridge state
    ↓
sandbox sessionId
```

sandbox sessionId 不作为前端业务数据返回。

---

# 41. LSP virtual URI

Browser 只认识：

```text
qualy-formula:///formula.ts
qualy-formula-sdk:///...
```

Authoring 内部：

```text
file:///work/<session>/formula.ts
file:///opt/qualy/formula-sdk/...
```

bridge 做双向 URI translation。

---

# 42. URI gate

Browser 发来的任何：

```text
file://
/etc/passwd
/proc/self/environ
/work/...
../...
```

直接 protocol refusal。

Authoring 返回的所有 URI 也必须先验证：

```text
属于当前 workspace
或
属于 readonly formula-sdk root
```

否则不得送给 Browser。

---

# 43. LSP method allowlist

第一版只开放实际需要：

```text
initialize
initialized

textDocument/didOpen
textDocument/didChange
textDocument/didClose

textDocument/completion
textDocument/hover
textDocument/signatureHelp
textDocument/definition
textDocument/documentSymbol
```

以及生命周期方法。

明确禁止：

```text
workspace/executeCommand
workspace/applyEdit
任意 filesystem request
任意 workspace folder mutation
```

遇到 TS7 LSP 真正需要的新标准方法，通过测试后逐项增加。

---

# 44. Source-policy diagnostics

TS7 不知道 Qualy 自己额外禁止的：

```text
explicit any
module boundary
suppression
dynamic code generation
```

因此每次：

```text
didOpen
didChange
```

Authoring 同时对最新 source 运行 TS6 AST policy。

编辑器最终显示：

```text
TS7 diagnostics
+
Qualy source-policy diagnostics
```

两者必须明确不同 source，例如：

```text
typescript
qualy-formula
```

Publish 仍然重新执行一遍完整 policy/typecheck。

LSP diagnostics 不具有任何可信业务意义。

---

# 45. Formula editor 状态

Monaco 接入不得破坏当前已经修好的 draft 并发模型。

继续维护：

```text
baseDraftRevision
localDraft
dirty
remoteRevisionAvailable
```

LSP 只服务于 local editor buffer。

保存仍然：

```text
PATCH draft
expectedDraftRevision
```

发布仍然先保证 dirty draft 已成功保存。

远端 draftRevision 更新时：

```text
dirty = false
→ 可以 reseed

dirty = true
→ 不得覆盖本地 Monaco model
→ 显示服务器草稿已更新
```

---

# 46. Test / local implementation

unit test 可以直接：

```text
FormulaCompilerLocal
SandboxLocal
```

用于快速测试业务代码。

但必须单独有：

```text
remote UDS parity tests
```

验证：

```text
Local result
==
Remote process result
```

包括 error tag、limits 和 deterministic artifact。

---

# 47. Main Server dependency gate

容器化完成后增加架构测试。

`@qualy/plugin-assessment-formula` runtime dependency 不再包含：

```text
typescript
esbuild
TS6 compiler
```

当前 FormulaVersion/Formula plugin 是 compiler orchestration 的承载点，迁移后 compiler 依赖必须从业务 server 图移走。

`@qualy/plugin-sandbox` runtime dependency 不再包含 QuickJS package。

禁止：

```text
packages/plugins/assessment/formula
  import esbuild

packages/plugins/assessment/formula
  spawn tsc

packages/plugins/infra/sandbox
  import quickjs engine implementation
```

production server dependency closure 不应包含 QuickJS execution engine。

---

# 48. 实施顺序

按六个独立提交施工。

| 阶段 | 内容                                                     | 硬验收                                                 |
| ---- | -------------------------------------------------------- | ------------------------------------------------------ |
| A    | 抽 `sandbox-engine`                                      | 现有 QuickJS escape/resource suite 结果不变            |
| B    | `sandbox-rpc` + `sandbox-runtime` + remote Sandbox Layer | local/remote invoke parity                             |
| C    | 抽 `formula-compiler` + TS6 AST policy                   | 当前 Formula source/typecheck/bundle fixtures 全部一致 |
| D    | `sandbox-authoring` + remote FormulaAuthoring            | Formula publish 真 PG 全链结果不变                     |
| E    | Docker hardening + UDS dev/prod wiring                   | container security smoke                               |
| F    | LSP session + authenticated WS bridge + Monaco           | completion/hover/diagnostics/cleanup/URI attacks 全过  |

每个阶段：

```text
定向测试
→ pnpm typecheck
→ 相关集成
→ STATUS
→ commit
```

不要在 A～E 期间顺手做 Monaco。

---

# 49. A 阶段额外收掉的现有问题

如果当前 `main` 尚未修复以下问题，应在 A/C 一并完成：

```text
Function constructor prototype-chain escape

畸形 contract 不得让 Host pattern/profile validator defect

TS module closure 从 regex lexer 迁到真实 AST

Formula pagination cursor/前端分页遗留问题

publish fingerprint 必须包含最终 runtimeSha256

formula plugin runtime dependsOn 必须与实际 Ui/assessment 使用一致
```

这些属于现有 4a 收口，不属于 Recognition。

---

# 50. Docker security smoke

至少验证：

```text
uid != 0
CapEff = 0
root filesystem 不可写
network 不可达
无 docker.sock
无 repo root
无 .env
无 SSH
无 host home
Runtime 看不到 authoring socket
Authoring 看不到 runtime socket
```

准备一个 host-only sentinel 文件，确认两个 container 都不可读取。

---

# 51. RPC 安全测试

至少：

```text
invalid NDJSON
oversized frame
partial frame
wrong RPC tag
invalid payload schema
invalid response schema
disconnect during invoke
server dies during invoke
1000 concurrent refusals
slow consumer stream
```

任何 malformed sandbox response：

```text
typed failure
```

不能导致：

```text
Qualy server defect
memory unbounded
stack leakage
```

---

# 52. Authoring 攻击测试

至少保留或新增：

```ts
import '/absolute/path'
import '../../relative'
import type X = require(...)
type X = import(...).X
dynamic import(...)
triple slash reference
@ts-ignore
@ts-nocheck
@ts-expect-error
explicit any
as any
```

必须全部在启动 TS7 前被 source policy 捕获。

---

# 53. Runtime 攻击测试

至少：

```text
Date
Math.random
eval
Function
arrow.constructor
generator.constructor
async.constructor
async-generator.constructor

global intrinsic mutation

infinite loop
deep recursion
memory bomb
oversized input
oversized output
worker crash
```

worker 遭遇不可恢复 resource state 后继续采用：

```text
retire entire worker
replace
```

不得尝试复用。

---

# 54. LSP 攻击测试

至少：

```text
file:///etc/passwd
file:///proc/self/environ
../../
workspace/executeCommand
workspace/applyEdit

huge frame
sequence reorder
session flood
idle leak
browser disconnect
authoring process crash
tsc LSP hang
```

断开以后必须最终证明：

```text
LSP process 数量回到基线
/work session directory 被删除
```

---

# 55. 完成标准

完成 E 后必须能够证明：

```text
Browser Formula source
        ↓
Qualy Server
        ↓
Authoring Sandbox
        ↓
TS6 AST + TS7 + esbuild
        ↓
artifact
        ↓
Qualy Server
        ↓
Runtime Sandbox
        ↓
QuickJS
        ↓
Qualy Server
        ↓
Schema/RBAC/Audit/DB
```

并且在业务 Server 的 runtime source/dependency graph 中不存在本地 Formula compiler/executor。

完成 F 后：

```text
Monaco
    ↓
authenticated bridge
    ↓
Authoring Sandbox TS7 LSP
```

编辑体验与 publish 使用同一份：

```text
Formula SDK
TS7 semantics
Qualy source policy
```

但最终发布永远重新检查，不信任编辑器。

---

# 56. 本批禁止范围

本批不进入：

```text
EntryRecognition
ReviewEvent recognition
ReviewPanel proposal
ItemRevision.scoring_plan
CalculatorDriver 改造
Evidence bindableFields
formula@1 calculator
ScoreRun / Publication
```

这些仍然属于下一批 assessment 阶段五以后。

本批目标只有：

> 将现有 Formula 编译与执行能力搬出可信业务进程，并在这个安全边界上完成 4b LSP。

---

# 57. Claude Code 实施纪律

实现前先读取当前真实代码，不按本文示意接口名称生搬硬套。

Effect RPC/Socket API 必须优先读取：

```text
repos/effect/
packages/effect/src/unstable/rpc/
packages/platform/node*/src/NodeSocket*.ts
packages/platform/node/test/RpcServer.test.ts
```

当前 vendored Effect rc.111 的 socket/RPC 能力已经存在。

不得为了方便升级 Effect。

不得修改已有 Formula wire semantics 以迁就容器化。

不得删除现有 QuickJS security gate。

不得修改历史 FormulaVersion。

若迁移 compiler 后 deterministic artifact 发生变化，立即停止并报告原因。

若 Remote Sandbox 与 Local Sandbox 行为不能逐项等价，立即停止。

若 Docker isolation 需要把仓库根、secret 或 Docker socket挂进 sandbox，说明设计实现错了，不得通过放宽权限解决。
