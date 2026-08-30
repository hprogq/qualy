# Qualy Phase 7 — Formula Calculator 完整开发设计与执行规范

> 编写基线：`main @ ffb2f3dd8c276ed552e6bf93c699982ac879450a`  
> 阶段状态：Phase 6 CLOSED；Phase 7 AUTHORIZED  
> 本文目标：定义 Phase 7 从 service-backed scoring 基础设施到 `formula@1` 正式生产启用的唯一实施路线。

---

## 0. 执行规则

开始任何实现前，先重新读取当前 HEAD 和 `STATUS.md`。本文基于上述 commit；如果执行时仓库已经前进，必须先比较变化，已完成的 hardening 不得重复实现，已改变的契约不得按本文旧快照强行覆盖。

每个子阶段独立落地、独立验收。禁止一次性写完 7.0～7.6 再统一调试。

每笔真正改变业务不变量的提交必须有承重门禁：删除修复后测试必须明确失败，而且失败原因应点名对应不变量。

继续遵守项目现有纪律：

- append-only 事实不原地改写；
- 历史执行依赖 exact identity，不依赖 `latest`；
- fail closed，不用 0 分掩盖失败；
- Core 不导入 Formula/Sandbox/QuickJS；
- 不使用 module-global service locator、mutable registry 或 late binding；
- 不复制一套 schema/converter/evaluator；
- 前端只能提前反馈，后端始终重新证明；
- 数据库约束能够表达的跨行/跨租户不变量尽量落 DB；
- 不因为 Phase 7 顺手重构无关 Assessment 业务；
- `pnpm typecheck`、`pnpm test`、`pnpm test:browser`、`pnpm build` 是阶段封板最低门槛。

---

# 1. 当前事实，不要重新实现

Phase 7 不是从零写 Formula。

当前仓库已经具备以下基础。

## 1.1 Value Schema

`packages/core/value-schema`

已经承担全系统唯一 typed-value protocol，包括：

- atomic schema；
- flat Formula input schema；
- normalization；
- validation；
- assignability；
- semantic canonicalization；
- decimal canonicalization；
- `integer-to-decimal@1` converter；
- schema hashing；
- score amount schema；
- value canonicalization。

Phase 7 不引入第二套类型语言。

继续坚持：

```text
Evidence schema
    ⊆
Recognition schema
    ⊆
Calculator parameter schema
```

所有包含关系在配置阶段证明。

---

## 1.2 Recognition

Assessment Core 已经有：

```text
EntryRevision.payload
→ Evidence

ReviewEvent.recognitionPayload
→ 审核过程中的认定快照

EntryRecognition.values
→ terminal determination
```

Recognition 是 append-only 机构事实，不是对 Evidence 的修改。

Phase 7 不重新设计 Recognition 数据库模型。

---

## 1.3 ScoringPlan

当前：

`packages/plugins/assessment/core/src/scoring/plan.ts`

已经完成：

- calculator/aggregator ref 解析；
- config decode；
- calculator contract compile；
- output → score amount proof；
- constant / recognition parameter binding；
- Evidence default → Recognition assignability；
- Recognition → parameter assignability；
- converter freeze；
- recognition schema freeze；
- input/output schema freeze；
- semantic `planHash`；
- stored plan shape/hash/profile/converter validation；
- rolling-deployment fail closed；
- historical plan boot audit。

Phase 7 应演化这套 compiler，不能另写 Formula compiler。

---

## 1.4 Effectful evaluator + pure ledger

当前：

```text
evaluateEntry()
    effectful

calcParticipant()
    pure
```

这个边界必须永久保留。

Formula 可以需要 DB 和 Sandbox；Aggregator + ScoreGroup 不可以因此变成 effectful。

最终仍然是：

```text
Recognition
→ calculator
→ exact amount bigint
→ Aggregator
→ ScoreGroup
→ Breakdown
```

---

## 1.5 Formula authoring

`packages/plugins/assessment/formula`

已经拥有：

- FormulaFunction；
- FormulaVersion；
- TypeScript source；
- TS7/LSP；
- Monaco editor；
- source policy；
- esbuild；
- deterministic bundle；
- contract extraction；
- test cases；
- draft preview；
- try-run；
- publish；
- publish fingerprint；
- immutable version rows；
- sandbox execution；
- authoring UI。

不要重写 Formula IDE。

Phase 7 的 Formula 工作是：

> Published FormulaVersion 如何成为一个 Assessment calculator。

---

## 1.6 Sandbox

`packages/plugins/infra/sandbox`

已经是独立 runtime process。

它：

- business-blind；
- 无 local fallback；
- artifact hash 自检；
- input/artifact/output limit；
- timeout/memory/stack limit；
- RPC protocol/ABI；
- per-answer runtime identity；
- process isolation。

Formula calculator 必须使用 Sandbox 服务，不允许在 API process 中执行 Formula JS。

---

# 2. Phase 7 最终产品语义

最终唯一数据流：

```text
EntryRevision.payload
        │
        ▼
     Evidence
        │
        │ default seed
        ▼
   Recognition
        │
        │ frozen typed binding
        ▼
FormulaVersion exact UUID
        │
        │ Sandbox
        ▼
 exact decimal amount
        │
        ▼
  scaled bigint
        │
        ▼
 Aggregator
        │
        ▼
 ScoreGroup
        │
        ▼
 Breakdown
```

Formula 永远不知道：

```text
tenant
batch
item
entry
participant
user
organization
attachment
database
RBAC
HTTP
```

Formula 只能知道自己的 typed input。

宿主拥有所有业务上下文。

---

# 3. Phase 7 明确非目标

本阶段不实现：

- 最终 ScoreRun；
- Publication freeze；
- 排名发布；
- 完整 JSON Schema；
- nested Formula input；
- array Formula parameter；
- nullable/optional Formula parameter；
- arbitrary npm imports；
- dynamic imports；
- Formula DB/API access；
- Formula 读取 Entry/Evidence；
- Formula `latest`；
- 自动升级历史 FormulaVersion；
- 多公式组合 DAG；
- 跨 Item Formula；
- Excel-like expression DSL；
- 另一个 Formula IDE；
- arbitrary JavaScript number authoritative scoring。

这些若将来需要，另立阶段。

---

# 4. Phase 7 子阶段

正式拆分：

```text
7.0  Service-backed Scoring Runtime
7.1  Immutable Formula Runtime & Binding Catalog
7.2  Scoring Authoring V2 + ScoringPlan V2
7.3  formula@1 Calculator
7.4  Item Authoring & Typed Binding UX
7.5  Determination / Impact / Failure Semantics
7.6  Production Rollout / Performance / Final Acceptance
```

`formula@1` writer 在 7.6 前不得默认生产开放。

---

# 5. Phase 7.0 — Service-backed Scoring Runtime

这是整个 Phase 7 最重要的基础阶段。

不要先写 Formula calculator。

---

## 5.1 当前拓扑问题

当前 plugin-kit：

```text
prepare
  ↓
services
  ↓
afterServices
```

`prepare` extension provider 必须输出无需 runtime service 的 Layer。

当前：

```ts
ScoringDeclarations;
phase = "prepare";
```

`ScoringCatalog` 因而是 prepare catalog。

与此同时：

```ts
Assessment.make;
```

在 Assessment service 构建期间：

```ts
const scoring = yield * ScoringCatalog;
```

所以不能简单：

```diff
- phase: 'prepare'
+ phase: 'afterServices'
```

否则 Assessment service 建立时 scoring catalog 不存在。

另一个问题是：现有 `afterServices` 主要承载 HTTP handler。多个 `afterServices` provider 的 Layer 是平行 merge；一个 provider 的输出不会天然成为另一个 provider 的输入。

因此：

```text
afterServices ScoringRuntimeCatalog
+
afterServices Api handlers
```

仍然不能形成可靠的：

```text
services
→ ScoringRuntimeCatalog
→ handlers
```

---

# 5.2 Kernel 增加通用 runtime phase

正式装配顺序改为：

```text
prepare
    ↓
services
    ↓
runtime
    ↓
afterServices
```

语义：

### prepare

纯声明/静态 catalog。

允许：

```text
schema
metadata
driver definitions
contracts
```

禁止 runtime service requirement。

### services

普通 `Context.Service` / plugin layers。

### runtime

在完整 services 上方，把“需要运行中 Service 的扩展描述”绑定成真正 runtime capability。

典型用途：

```text
service-backed calculator
```

这一 phase 可以依赖 services，并可以输出 Context Service 给 handler 和 boot barrier 使用。

### afterServices

HTTP handlers / raw routes 等最终 consumer。

---

## 5.3 plugin-kit 修改

修改：

```text
packages/core/plugin-kit/src/index.ts
packages/core/plugin-kit/src/assemble.ts
tools/tests/assemble-kernel.test.ts
apps/server/src/runtime.ts
```

`ExtensionPhase`：

```ts
type ExtensionPhase = "prepare" | "runtime" | "afterServices" | "external";
```

`Assembled`：

```ts
interface Assembled {
  prepared: AnyLayer;
  services: AnyLayer;
  runtime: AnyLayer;
  above: AnyLayer;
}
```

`assemble()`：

```text
prepared = compile('prepare')

services = build service graph over prepared

runtime = compile('runtime')

above = compile('afterServices')
```

runtime layer本身不要在 assembler 内偷偷提供 services。

composition root 明确负责：

```text
runtime
  provided by services + prepared

above
  provided by runtime + services + prepared

boot barrier
  provided by runtime + services + prepared
```

保证 runtime 只构建一份；不要为 routes 和 boot 分别制造两个独立 runtime instance。

如果 Effect Layer 组合写法不明显，先写 kernel test 证明同一个 runtime service instance 被 boot 和 request consumer 共享，再固定 composition。

---

# 5.4 Runtime phase 承重门禁

增加 kernel test：

```text
ServiceA
  ↓
runtime extension provider
  ↓
RuntimeCatalog
  ↓
afterServices consumer
```

必须证明：

1. runtime provider 能 `yield* ServiceA`；
2. afterServices handler 能 `yield* RuntimeCatalog`；
3. 删除 ServiceA provider，assembly/build 明确失败；
4. runtime service 只 build 一次；
5. prepare provider 仍不能依赖 ServiceA；
6. afterServices 的旧 API 路径全部继续工作。

不要只保留现有 synthetic “afterServices 可以访问 service”测试。

新的门禁必须证明四层拓扑。

---

# 5.5 Scoring 拆成 Definition 与 Runtime

不要维护两份 calculator 定义。

定义一个 calculator registration，helper 自动产生两条 contribution。

建议：

```ts
interface CalculatorDefinition {
  readonly kind: "calculator";
  readonly ref: string;
  readonly configSchema: Schema.Top;
}

interface RuntimeRef {
  readonly kind: string;
  readonly id: string;
  readonly sha256: string;
}

interface CalculatorHostContext {
  readonly tenantId: string;
  readonly batchId: string;
}

interface CalculatorCompileContext extends CalculatorHostContext {
  readonly previousRuntimeRef?: RuntimeRef;
}

interface PreparedCalculator {
  readonly evaluate: (
    input: Record<string, unknown>,
  ) => Effect.Effect<string, CalculatorEvaluationError>;
}

interface BoundCalculator {
  readonly ref: string;

  readonly compile: (
    config: unknown,
    context: CalculatorCompileContext,
  ) => Effect.Effect<CompiledCalculator, CalculatorContractError>;

  readonly verify: (
    config: unknown,
    runtimeRef: RuntimeRef | undefined,
    context: CalculatorHostContext,
  ) => Effect.Effect<void, CalculatorRuntimeError>;

  readonly prepare: (
    config: unknown,
    runtimeRef: RuntimeRef | undefined,
    context: CalculatorHostContext,
  ) => Effect.Effect<PreparedCalculator, CalculatorRuntimeError>;
}

interface CalculatorRegistration<R> {
  readonly ref: string;
  readonly configSchema: Schema.Top;

  readonly bind: Effect.Effect<BoundCalculator, never, R>;
}
```

`CompiledCalculator` 扩展：

```ts
interface CompiledCalculator extends CalculatorContract {
  readonly config: unknown;
  readonly runtimeRef?: RuntimeRef;
}
```

---

# 5.6 为什么引入 prepare()

不要让 Formula 每条 Entry 都重新：

```text
SELECT FormulaVersion
→ 校验 hash
→ 校验 ABI
→ 再 Sandbox
```

一个 result request 中同一 Item 的 ScoringPlan 会被很多 Entry 使用。

正确生命周期：

```text
ScoringPlan
    ↓ once per request/plan
RuntimeCatalog.prepare()
    ↓
PreparedCalculator
    ↓ many times
evaluate(input)
```

Formula implementation 可以：

```text
prepare:
  resolve exact FormulaVersion
  verify runtimeRef
  capture runtimeJs/hash/Sandbox

evaluate:
  only Sandbox.invoke
```

fixed calculator：

```text
prepare:
  return pure closure
```

这样 Core 不知道 Formula，却自然避免 N 次 FormulaVersion DB lookup。

---

# 5.7 Scoring extension points

建议：

```ts
ScoringDefinitions;
phase: "prepare";

ScoringRuntimes;
phase: "runtime";
```

Definition Catalog：

```ts
class ScoringDefinitionCatalog {
  calculators: Map<string, CalculatorDefinition>;
  aggregators: Map<string, AggregatorDriver>;
}
```

Runtime Catalog：

```ts
class ScoringRuntimeCatalog {
  compile(...)
  verify(...)
  prepare(...)
}
```

Runtime provider 建立时同时读取 `ScoringDefinitionCatalog`，验证：

```text
calculator definition refs
==
runtime calculator refs
```

任何：

```text
有 definition 无 runtime
有 runtime 无 definition
duplicate runtime ref
duplicate definition ref
```

全部 boot fail。

---

# 5.8 Scoring registration helper

不要让 plugin 作者：

```ts
Scoring.definition(...)
Scoring.runtime(...)
```

手写两遍 ref。

提供单一入口，例如：

```ts
...Scoring.calculator({
  ref: 'fixed@1',
  configSchema,
  bind: Effect.succeed(boundFixedCalculator),
})
```

helper 内自动生成：

```text
prepare definition contribution
runtime binding contribution
```

Aggregator 仍然：

```ts
Scoring.aggregator(...)
```

Aggregator 是纯函数，不需要 runtime phase。

---

# 5.9 Assessment service 不再捕获 Runtime Catalog

`Assessment.make` 可以继续捕获：

```text
ItemTypeCatalog
ScoringDefinitionCatalog
```

不能在 services 阶段 `yield* ScoringRuntimeCatalog`。

需要 calculator runtime 的 method 应返回带 runtime requirement 的 Effect，或者在 invocation 内获取 runtime service。

即：

```text
Assessment service 可以先建好
↓
request / boot 真执行某 method
↓
此时 runtime layer 已存在
```

不要用：

```ts
let runtimeCatalog: ScoringRuntimeCatalog | undefined;
```

再在后面赋值。

---

# 5.10 trusted host context

当前 `BatchContext` 只有 materialRange，这是 ItemType context。

Calculator 另建独立 host context。

第一版只传：

```ts
{
  (tenantId, batchId);
}
```

不要传：

```text
Principal
userId
participantId
entryId
payload
attachments
org tree
```

FormulaVersion 查询必须：

```sql
WHERE tenant_id = :tenantId
  AND id = :versionId
```

不能只按 UUID。

`tenantId` / `batchId` 绝不能来自：

```text
scoringConfig
Formula input
browser-hidden fields
```

---

# 5.11 Assignment 唯一解释器

当前 assignment compile 已集中，但 runtime converter 解释仍不得散落。

在 `@qualy/value-schema` 提供：

```ts
applyAssignment(
  assignment: AssignmentPlan,
  value: unknown,
): unknown
```

所有：

```text
Evidence seed
Recognition input assembly
Formula input assembly
browser preview
```

只调用这一个实现。

当前唯一 converter：

```text
integer-to-decimal@1
```

新增 converter 必须：

1. 新 ref；
2. compile 支持；
3. runtime interpreter 支持；
4. stored-plan reader vocabulary 支持；
5. compatibility test；
6. rolling deployment test。

---

# 5.12 Phase 7.0 同批 preflight hardening

以下前置项在真实 Formula 参数进入系统前关闭。

## A. required text effective schema

Evidence required text 实际拒绝 trim 后空串。

因此给 bindable/scoring 使用的 effective schema 必须表达：

```json
{
  "type": "string",
  "minLength": 1
}
```

当 `required === true`。

不要让：

```text
真实 Evidence 值域
```

比 `fieldSchema()` 声称的更窄却不表达，从而造成错误 incompatibility。

这不意味着现在开放管理员自定义 `minLength/pattern`。

只让 schema 准确描述已有 required 语义。

## B. Evidence retype identity server gate

浏览器当前在 field type 改变时 mint 新 field identity。

后端也必须守。

更新 ItemRevision 时：

```text
same field identity
+
old type != new type
→ reject
```

不能依赖 ItemConfigEditor 帮忙 mint。

这直接影响历史 Evidence → Recognition binding identity。

## C. prototype-sensitive business keys closure

继续清查：

```text
__proto__
constructor
toString
```

至少覆盖：

- Formula SDK `Schema.choice`；
- ValueForm 内部 result object；
- scoring authoring maps；
- Recognition maps；
- binding maps；
- label maps。

业务 key map 原则：

```text
Object.create(null)
Object.hasOwn()
Map
```

三选一。

不要依赖普通对象原型语义。

## D. Sandbox effective wire ceilings

当前 engine ceiling 与 RPC envelope ceiling 必须区分：

```text
engine ceiling
transport ceiling
effective callable ceiling = min(...)
```

如果 capabilities API 暴露限制，必须暴露 effective limit。

不要再宣称调用方可以送 8 MiB，而 RPC frame 约 2 MiB。

---

# 5.13 7.0 Boot/backfill

当前 `sweepScoringPlans()` 和 `auditStoredPlans()` 是正式 readiness barrier。

扩展查询：

```text
tenantId
batchId
```

必须随 revision 一起取出。

backfill compile：

```text
tenantId
batchId
→ CalculatorCompileContext
```

stored plan audit：

```text
readScoringPlan
→ definition ref installed
→ runtime ref installed
→ runtime.verify(...)
```

`verify()`：

Formula 只做：

```text
DB immutable fact exists
hash matches
contract matches
ABI/profile compatible
```

不要联系 Sandbox process。

启动一台 API server 不应要求 Sandbox 此刻在线。

---

# 5.14 Phase 7.0 Done

必须有真实 Assessment bearing：

```text
SyntheticService
      ↓
service-backed calculator registration
      ↓
Scoring runtime phase
      ↓
real compileScoringPlan()
      ↓
frozen plan
      ↓
RuntimeCatalog.prepare()
      ↓
real evaluate path
      ↓
exact amount
```

同时：

```text
calcParticipant remains pure
Assessment Core imports no Formula
Assessment Core imports no Sandbox
Assessment Core imports no QuickJS
no module global
no service locator
fixed@1 characterization unchanged
boot audit uses runtime verifier
```

通过后进入 7.1。

---

# 6. Phase 7.1 — Immutable Formula Runtime & Binding Catalog

这一阶段把 Formula authoring 世界与 scoring runtime 世界彻底分离。

---

# 6.1 不复用 FormulaLibrary 做 runtime

当前 FormulaLibrary 是 authoring service。

它拥有：

```text
preview
try-run
draft
publish
archive
owner options
management auth
```

Scoring runtime 禁止调用它。

不能：

```text
formula@1
→ FormulaLibrary.getVersion(...)
→ fabricate Principal
→ assessment.formula.manage
```

管理权限和历史执行权限不是一回事。

---

# 6.2 新建 FormulaRuntimeStore

建议：

```text
packages/plugins/assessment/formula/src/server/runtime-store.ts
```

接口：

```ts
interface FormulaRuntimeVersion {
  readonly versionId: string;
  readonly functionId: string;
  readonly versionNo: number;

  readonly runtimeJs: string;
  readonly runtimeSha256: string;
  readonly contractSha256: string;

  readonly inputSchema: NormalizedInputSchema;
  readonly outputSchema: NormalizedAtomicSchema;

  readonly formulaAbiVersion: number;
  readonly formulaRuntimeSha256: string;
  readonly sandboxAbiVersion: number;
  readonly valueSchemaProfileVersion: number;
  readonly regexProfileVersion: number;

  readonly quickjsEngineVersion: string;
}

class FormulaRuntimeStore {
  resolve(input: {
    tenantId: string;
    versionId: string;
  }): Effect<FormulaRuntimeVersion, FormulaRuntimeResolutionError>;
}
```

不收：

```text
Principal
batchId
manage permission
```

它回答：

> 这个 tenant 中，这个 immutable version 的执行事实是什么？

仅此而已。

---

# 6.3 RuntimeStore 必须验证 row integrity

不要只：

```sql
SELECT runtime_js...
```

然后信任。

抽取出版流程已有的 pure hashing helper，publication 和 RuntimeStore 共用。

至少验证：

```text
sha256(runtimeJs)
==
runtimeSha256
```

以及：

```text
canonical(inputSchema, outputSchema)
→ contract hash
==
contractSha256
```

不要复制 hashing 算法。

如果当前 hash helper 埋在 `server/index.ts`，先提取，例如：

```text
server/contract-identity.ts
```

publication 和 runtime 两边共同调用。

---

# 6.4 Runtime compatibility policy

新建纯模块，例如：

```text
server/runtime-compatibility.ts
```

不要把一堆：

```ts
if (version !== CURRENT)
```

散在 calculator。

返回：

```ts
checkRuntimeCompatibility(version): RuntimeCompatibilityIssue[]
```

第一版 hard gate：

```text
formulaAbiVersion
sandboxAbiVersion
valueSchemaProfileVersion
regexProfileVersion
stored input/output schema profile
```

unsupported：

```text
fail closed
```

以下主要是 provenance，不直接要求和当前 build 字符串相等：

```text
typescriptVersion
esbuildVersion
sourcePolicyVersion
sourcePolicyParserVersion
authoringBuildId
quickjsEngineVersion
```

尤其不能：

```text
storedQuickJsVersion === currentQuickJsVersion
```

否则 Sandbox engine 正常升级会杀死所有历史 FormulaVersion。

QuickJS 升级是否仍能 replay，应由 Sandbox release/replay suite 证明，而不是每条版本强制字符串相等。

---

# 6.5 FormulaVersion 数据库永久性

当前 FormulaVersion → FormulaFunction FK 的：

```sql
ON DELETE CASCADE
```

改为：

```sql
RESTRICT
```

或默认：

```sql
NO ACTION
```

FormulaFunction 产品语义：

```text
archive
```

不是 delete。

Published FormulaVersion 一旦存在：

```text
不 update
不 delete
不因 parent archive 消失
不因 owner org node 删除消失
```

tenant 删除仍可以按 tenant lifecycle cascade。

迁移必须有 DB 承重：

```text
published version exists
→ direct parent delete fails
→ row remains
```

---

# 6.6 Exact version UUID

所有 scoring binding 的 execution identity：

```text
FormulaVersion.id
```

不是：

```text
functionId + versionNo
```

后者只用于展示/locator。

API DTO 命名：

```ts
versionId;
functionId;
versionNo;
```

不要只返回 `id` 让三个 id 混在一起。

绝对禁止：

```text
latestVersion
latest
current published
```

作为 scoring config。

---

# 6.7 新建 BindableFormulaCatalog

建议：

```text
server/binding-catalog.ts
```

职责：

```text
published FormulaVersion
+
Formula owner node
+
Batch management anchors
→ 是否允许 NEW binding
```

接口可类似：

```ts
interface BindableFormulaVersion {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

class BindableFormulaCatalog {
  listForBatch(...)
  requireBindable(...)
}
```

---

# 6.8 Binding authorization rule

继续采用：

```text
FormulaFunction.ownerNode
必须是
Batch 每一个 management anchor 的 ancestor-or-self
```

含义：

```text
租户根公式
→ 所有 batch

学院公式
→ 该学院辖下 batch

班级公式
→ 只能用于其覆盖范围
```

如果：

```text
owner node 已删除
management anchor 无法解析
batch 不存在
formula archived
version 不存在
```

NEW binding fail closed。

---

# 6.9 不使用 assessment.formula.manage 做 binding

`assessment.formula.manage` 只意味着：

```text
write
test
publish
archive
```

Batch manager 使用一个中央发布公式不等于获得源码管理权。

因此 BindableFormulaCatalog 不是 FormulaLibrary 的一个 `listFunctions()` filter。

它是独立 read model。

---

# 6.10 Assessment 提供窄的 extension access service

Formula plugin 不应 deep-import Assessment DB。

在 Assessment Core 暴露一个窄 server capability，例如：

```ts
class AssessmentConfigurationAccess {
  requireManage(tenantId, batchId, principal);

  managementAnchors(tenantId, batchId);
}
```

名字可以根据现有 package export 风格调整，但语义必须窄。

它属于 Assessment：

> 谁能管理这个 Batch，以及这个 Batch 的管理边界是什么？

Formula 只消费答案。

Formula plugin 不自己 join：

```text
assessment_batches
batch_management_anchors
```

以避免跨 bounded-context DB ownership 泄漏。

---

# 6.11 Existing binding 与 new binding 分开

如果 Item 当前已经绑定：

```text
Formula V1
```

随后：

```text
FormulaFunction archived
owner node deleted
```

历史 Item 必须继续：

```text
read
score
save unrelated title edit
```

所以 Formula compile context 使用：

```ts
previousRuntimeRef?: RuntimeRef
```

规则：

```text
requested versionId
==
previousRuntimeRef.id
→ continuation

requested versionId
!= previousRuntimeRef.id
→ NEW binding
```

continuation：

```text
FormulaRuntimeStore.resolve()
```

但不再要求：

```text
BindableFormulaCatalog.requireBindable()
```

new binding：

```text
RuntimeStore.resolve()
+
BindableFormulaCatalog.requireBindable()
```

这一区分非常重要。

---

# 6.12 7.1 Done

承重：

```text
wrong tenant version UUID
→ not found

tampered runtimeJs
→ fail

tampered schema/contract
→ fail

unsupported ABI/profile
→ fail

archived function + existing runtimeRef
→ runtime resolve succeeds

archived function + new binding
→ refused

owner node deleted + existing runtimeRef
→ runtime resolve succeeds

owner node deleted + new binding
→ refused

published parent hard delete
→ database refuses
```

---

# 7. Phase 7.2 — Scoring Authoring V2 + ScoringPlan V2

这一阶段正式冻结 Formula binding protocol。

---

# 7.1 两种版本必须区分

不要把：

```text
authoring config version
```

和：

```text
ScoringPlan version
```

混为一谈。

建议：

```text
ScoringAuthoring V2
ScoringPlan V2
```

旧 fixed 配置和旧 Plan V1 继续可读。

---

# 7.2 Stored Scoring Authoring V2

目标存储语义：

```ts
interface ScoringAuthoringV2 {
  readonly version: 2;

  readonly calculator: {
    readonly ref: string;
    readonly config: unknown;
  };

  readonly aggregator: {
    readonly ref: string;
    readonly config: unknown;
  };

  readonly recognitions: Record<
    RecognitionId,
    {
      readonly label: string;
      readonly refinement: AtomicSchema | null;
      readonly defaultFromFieldId: string | null;
    }
  >;

  readonly bindings: Record<
    ParameterName,
    | {
        readonly kind: "constant";
        readonly value: unknown;
      }
    | {
        readonly kind: "recognition";
        readonly recognitionId: RecognitionId;
      }
  >;
}
```

`RecognitionId` 是 UUID。

---

# 7.3 Recognition ID 必须 server-minted

不要让业务身份继续接受：

```text
constructor
toString
foo
awardLevel
```

作为持久 ID。

但浏览器新增 Recognition 时还没有 server UUID，因此 wire draft 与 stored config 分开。

建议 wire V2：

```ts
interface RecognitionDraft {
  readonly handle: string;
  readonly id?: string;
  readonly label: string;
  readonly refinement: AtomicSchema | null;
  readonly defaultFromFieldId: string | null;
}
```

binding 在请求中引用：

```text
handle
```

server normalization：

```text
new recognition:
  id absent
  → server mint UUIDv7

existing recognition:
  id present
  → 必须出现在 previous revision 中
```

禁止 client：

```text
凭空带一个新 UUID
```

伪造“这是旧 Recognition”。

正常化后写入 ItemRevision 的是：

```text
UUID-keyed stored config
```

draft handle 不持久化。

---

# 7.4 UUID mint 实现

不要增加 UUID npm dependency。

项目 PostgreSQL 已使用：

```sql
uuidv7()
```

在 Item save transaction 中批量获取所需新 UUID。

可以：

```sql
select uuidv7()
from generate_series(1, :count)
```

或复用仓库已有等价 DB helper。

不要一条 Recognition 一次数据库 round trip。

---

# 7.5 Existing recognition identity protection

update 时：

```text
client supplied recognition id
```

只有它存在于 previous stored scoring config 才合法。

同时：

```text
one id
→ exactly one recognition
```

禁止：

```text
duplicate
reuse
alias
```

删除后重新新增：

```text
new UUID
```

不要自动复活旧 identity。

---

# 7.6 Recognition refinement

当前实现相当于：

```text
RecognitionSchema = FormulaParameterSchema
```

Phase 7 正式允许：

```text
Recognition ⊂ FormulaParameter
```

不要另造 refinement DSL。

`refinement` 本身就是唯一 AtomicSchema。

compile：

```text
P = Formula parameter normalized schema

if refinement == null:
  R = P
else:
  R = normalize(refinement)
  prove assignmentPlan(R, P) == direct
```

之后：

```text
Evidence E
→ prove assignmentPlan(E, R)
```

最终：

```text
E ⊆ R ⊆ P
```

---

# 7.7 refinement 规则

第一版只使用 Value Schema 已支持的语言。

例如：

Formula：

```text
ordinal:
integer >= 0
```

题目：

```text
recognition ordinal:
integer >= 10
```

合法。

以下非法：

```text
Formula integer >= 10
Recognition integer >= 0
```

因为放宽了值域。

choice：

```text
Formula enum [a,b,c]
Recognition enum [a,b]
```

合法。

decimal：

```text
Formula 0..100 scale<=4
Recognition 10..50 scale<=2
```

合法。

text：

完全交给现有 `assignmentPlan()` 保守证明。

不要写第二个 contains 算法。

---

# 7.8 Recognition label 不是类型身份

label 作为 annotation。

重命名：

```text
“赛事级别”
→
“认定赛事级别”
```

不得改变 semantic plan identity。

compiler 可把 label 注入 schema title 供 UI 使用，但 canonical semantic body 必须继续剥离 annotation。

---

# 7.9 constant canonicalization

constant：

```text
validate
→ canonicalizeValue
→ freeze
```

不是：

```text
validate
→ freeze raw input
```

例如 decimal：

```text
"3.0"
"3.00"
"03.000"
```

如果都代表同一个合法值：

```text
frozen constant identical
plan semantic hash identical
```

使用：

```text
@qualy/value-schema/values
canonicalizeValue()
```

不要重新写 decimal normalization。

---

# 7.10 ScoringPlan V2

定义：

```ts
interface ScoringPlanV2 {
  readonly version: 2

  readonly calculator: {
    readonly ref: string
    readonly config: unknown
    readonly contractHash: string
    readonly runtimeRef?: RuntimeRef
  }

  readonly parameters: ...
  readonly recognitionSchemas: ...
  readonly defaultBindings: ...

  readonly aggregator: ...
  readonly inputSchema: ...
  readonly outputSchema: ...

  readonly planHash: string
}
```

Formula plan：

```json
{
  "runtimeRef": {
    "kind": "formula-version",
    "id": "<exact FormulaVersion UUID>",
    "sha256": "<runtimeSha256>"
  }
}
```

fixed：

```text
runtimeRef absent
```

---

# 7.11 runtimeRef 是 generic Core concept

Assessment Core 只知道：

```text
kind
id
sha256
```

Core 不写：

```ts
if (runtimeRef.kind === 'formula-version') {
  ...
}
```

Formula runtime adapter 解释它。

以后别的 stored-program calculator 也可以有自己的 runtimeRef。

---

# 7.12 runtimeRef 必须进入 planHash

否则：

```text
FormulaVersion runtime bytes changed
但 ScoringPlan planHash 不变
```

会破坏 frozen identity。

因此 V2 semantic body 明确包含 runtimeRef。

---

# 7.13 不要破坏 V1 hash

不要把 V1 semantic body 改成：

```ts
{
  ...old,
  runtimeRef: undefined
}
```

再假定 hash 一样。

提供版本专属：

```text
semanticPlanBodyV1()
semanticPlanBodyV2()
```

读取流程：

```text
inspect version
→ decode corresponding shape
→ validate corresponding language
→ corresponding semantic rehash
```

支持：

```text
V1
V2
```

未知版本 fail closed。

旧 V1 行不重写。

---

# 7.14 Previous plan 进入 compile context

Item update compile 时，把 previous plan 的 runtimeRef 传入：

```ts
CalculatorCompileContext.previousRuntimeRef;
```

Formula adapter 用它判定：

```text
existing continuation
vs
new binding
```

Core 不理解 versionId。

---

# 7.15 evaluationIdentity

不要直接把整个 `planHash` 当成：

> 这次修改会不会改变分数。

引入 pure helper：

```ts
evaluationIdentity(plan);
```

或：

```ts
evaluationHash(plan);
```

至少包含：

```text
calculator ref
canonical execution config
runtimeRef
parameter binding
constant
converter
aggregator
contract semantics
```

不要包含纯 presentation：

```text
Recognition label
schema title
default Evidence source（如果最终 Recognition 已给定）
```

这个 helper 在 7.5 ChangeImpact 使用。

暂不需要新增数据库列。

---

# 7.16 7.2 Done

承重：

```text
decimal "3.0" vs "3.00"
→ same plan hash

Recognition refinement narrow
→ accepted

Recognition refinement widen
→ refused

Evidence not subset of Recognition
→ refused

client invents existing Recognition UUID
→ refused

new Recognition
→ server UUID

old V1 fixed plan
→ same hash, same result

new V2 formula plan
→ runtimeRef included
```

---

# 8. Phase 7.3 — formula@1 Calculator

只有到这里才真正注册 Formula calculator。

建议文件：

```text
packages/plugins/assessment/formula/src/scoring/formula-calculator.ts
```

---

# 8.1 configSchema

唯一 authored config：

```ts
{
  versionId: UUID;
}
```

禁止：

```text
functionId
versionNo
latest
tenantId
batchId
runtimeJs
runtimeHash
inputSchema
outputSchema
```

这些不是管理员配置。

---

# 8.2 bind()

Formula calculator registration：

```ts
Scoring.calculator({
  ref: 'formula@1',
  configSchema,
  bind: Effect.gen(function* () {
    const runtimeStore = yield* FormulaRuntimeStore
    const bindable = yield* BindableFormulaCatalog
    const sandbox = yield* Sandbox

    return ...
  }),
})
```

Service 在 runtime phase 一次绑定。

bound calculator 的方法之后为 closed Effect，不再暴露 FormulaRuntimeStore/Sandbox requirement。

---

# 8.3 compile()

逻辑：

```text
decode {versionId}
        ↓
FormulaRuntimeStore.resolve(tenantId, versionId)
        ↓
check:
  immutable row integrity
  compatibility
        ↓
if previousRuntimeRef.id != versionId:
  BindableFormulaCatalog.requireBindable(tenantId,batchId,versionId)
        ↓
return:
  inputSchema
  outputSchema
  contractHash
  canonical config
  runtimeRef
```

canonical config：

```ts
{
  versionId;
}
```

UUID 本身已经有唯一 spelling。

---

# 8.4 compile 不调用 Sandbox

FormulaVersion 发布时已经：

```text
typecheck
bundle
contract extraction
tests
```

Item binding compile 不需要重新跑 artifact。

它只验证：

```text
published immutable execution fact
```

这样：

```text
Sandbox 暂时离线
```

不会导致管理员连保存一个已发布 Formula binding 都做不到。

---

# 8.5 verify()

用于 boot readiness。

逻辑：

```text
resolve exact FormulaVersion
compare runtimeRef:
  kind
  id
  sha256

compare plan contractHash
  ==
FormulaVersion.contractSha256
```

不调用 Sandbox。

如果 runtimeRef：

```text
kind != formula-version
id != config.versionId
sha256 != row.runtimeSha256
```

fail closed。

---

# 8.6 prepare()

runtime scoring：

```text
FormulaRuntimeStore.resolve()
        ↓
verify runtimeRef + contract
        ↓
capture:
  runtimeJs
  runtimeSha256
  schemas
  Sandbox
        ↓
PreparedCalculator
```

一次 plan/request prepare。

---

# 8.7 PreparedCalculator.evaluate()

流程：

```text
typed input already host-validated
        ↓
JSON.stringify(input)
        ↓
Sandbox.invoke({
  artifact: runtimeJs,
  artifactHash: runtimeSha256,
  entrypoint: '__qualyInvoke',
  arguments: [inputJson],
  limits: FORMULA_SCORING_LIMITS
})
        ↓
strict envelope decode
        ↓
ok → amount
fail → typed refusal
```

仍然由 host 的 `evaluateEntry()` 在 Sandbox 前后执行：

```text
validate inputSchema
validate outputSchema
```

Formula SDK runtime 的 decode/encode 只是 defense-in-depth，不替代 host boundary。

---

# 8.8 Formula envelope 必须严格解析

不要继续：

```ts
JSON.parse(output) as SomeType;
```

定义严格：

```ts
type FormulaEnvelope =
  | {
      ok: true;
      amount: string;
    }
  | {
      ok: false;
      failure: {
        message: string;
      };
    };
```

拒绝：

```text
invalid JSON
wrong shape
extra impossible fields if protocol says closed
ok=true without amount
ok=false without failure
non-string message
```

message 再次按：

```text
FORMULA_FAILURE_MESSAGE_LIMIT
```

截断。

---

# 8.9 Calculator failure taxonomy

当前只有一个 reason string 不够。

建议：

```ts
type CalculatorFailureKind =
  | "refusal"
  | "unavailable"
  | "execution"
  | "integrity"
  | "invariant";
```

### refusal

Formula 主动：

```text
q.fail(...)
```

表示这个 typed input 不被业务函数接受。

### unavailable

```text
SandboxUnavailable
transport outage
```

可重试的基础设施状态。

### execution

```text
timeout
memory
stack
uncaught JS exception
malformed Formula envelope
```

说明 Formula/artifact 在合法输入上没能正常计算。

### integrity

```text
runtimeRef mismatch
artifact hash mismatch
unsupported persisted ABI/profile
missing historical FormulaVersion
contract mismatch
```

存储/assembly 不再能履行冻结承诺。

### invariant

Host 已经证明不可能但仍发生，例如：

```text
assembled input fails frozen schema
calculator output violates its frozen schema
```

---

# 8.10 Sandbox Formula reserved globals hardening

当前 bundler 依赖：

```text
globalThis.__qualyContract
globalThis.__qualyInvoke
```

用户 module 的 top-level code 不能抢占这两个 entrypoint。

推荐 prelude：

1. 在任何 user module 执行前运行；
2. 捕获：
   - `JSON.parse`
   - `JSON.stringify`
   - `Object.defineProperty`
3. 用 non-configurable getter 提前占住：
   - `__qualyContract`
   - `__qualyInvoke`
4. getter 读取 prelude closure 内部函数；
5. user code 无法 assign/delete/redefine；
6. wrapper 在 user module 初始化完成后通过只有 wrapper 能 import 的 `installEntrypoints()` 更新 closure。

不要用 writable placeholder。

hostile tests：

```text
globalThis.__qualyInvoke = evil
delete globalThis.__qualyInvoke
Object.defineProperty(globalThis, '__qualyInvoke', ...)
same for __qualyContract
```

均不能劫持真正 entrypoint。

---

# 8.11 Formula scoring limits

不要复制 authoring try-run 的：

```text
2s / 10s
```

到真实评分。

定义：

```text
FORMULA_SCORING_LIMITS
```

集中管理。

初始 deadline 优先沿用 Sandbox 当前严格 default，再用 7.6 benchmark 决定是否调整。

必须显式覆盖：

```text
artifactBytes >= publication MAX_COMPILED_ARTIFACT_BYTES
```

否则：

```text
300 KiB artifact
publish 成功
score 永远失败
```

同时给 Formula input/output 设置合理的 effective transport budget。

不要依赖 engine 8 MiB ceiling 绕过 RPC frame ceiling。

---

# 8.12 Sandbox runtime identity

`Sandbox.invoke()` 的 answer 自带真实执行 instance identity。

不要缓存“当前 engine identity”并当作下一次调用保证。

`quickjsEngineVersion` 是版本 provenance。

Formula replay compatibility 通过：

```text
Sandbox ABI
Formula ABI
profile versions
Sandbox release replay certification
```

而不是要求每次 scoring：

```text
stored engine string == current engine string
```

---

# 8.13 7.3 E2E bearing

必须是真 PostgreSQL + 真 FormulaVersion + 真 Sandbox process：

```text
create Formula
→ publish FormulaVersion
→ exact versionId
→ formula@1 compile
→ ScoringPlan V2
→ Recognition
→ RuntimeCatalog.prepare
→ Sandbox
→ QuickJS
→ decimal amount
→ scaled bigint
```

反例：

```text
wrong tenant
tampered runtime
wrong runtimeRef hash
unsupported ABI
Sandbox down
Formula q.fail
Formula timeout
Formula output violates schema
artifact >256KiB but <= publish max
```

最后一条必须成功执行。

---

# 9. Phase 7.4 — Item Authoring & Typed Binding UX

这一阶段不重做 Formula editor。

它解决：

> 一道 Assessment Item 如何配置使用 published FormulaVersion。

---

# 9.1 首先修 ItemConfigEditor round-trip ownership

当前 editor 把 scoring 当：

```text
fixedValue
folding
topN
```

保存 Evidence/Declaration/Constant 都会硬写：

```text
fixed@1
```

Formula 上线前必须打破这个假设。

第一条承重：

```text
open formula item
→ 不修改 scoring
→ 修改 title
→ save
→ calculator ref/config/recognitions/bindings unchanged
```

如果这条没过，禁止做 Formula picker。

---

# 9.2 Core 不 import Formula UI

禁止：

```ts
import { FormulaVersionPicker } from "@qualy/plugin-assessment-formula/...";
```

使用现有 UI surfaces。

当前 web runtime 已支持：

```text
UiCollection
UiSlot
slot context
plugin component lazy loading
```

利用它。

---

# 9.3 新增 Assessment calculator authoring surfaces

在 Assessment 的 browser-safe UI contract 中定义：

```ts
calculatorAuthoringOptions;
```

collection：

```ts
interface CalculatorAuthoringOption {
  readonly ref: string;
  readonly label: UiText;
  readonly order?: number;
}
```

以及：

```ts
calculatorEditorSlot;
```

cardinality：

```text
many
```

Core 和其他 calculator plugin 均可贡献。

---

# 9.4 ItemConfigEditor 使用 collection

Core：

```text
useUiCollection(calculatorAuthoringOptions)
```

绘制 calculator selector。

Core 自己贡献：

```text
fixed@1
```

Formula plugin 贡献：

```text
formula@1
```

因此 Core 不知道 Formula 名字，但 manifest 知道此 assembly 中有哪些可配置 calculator。

---

# 9.5 ItemConfigEditor 使用 slot context

Core 在 calculator config 区域：

```tsx
<UiSlot
  token={calculatorEditorSlot}
  context={...}
/>
```

context 至少：

```ts
interface CalculatorEditorContext {
  readonly batchId: string;
  readonly itemId: string | null;

  readonly calculator: {
    readonly ref: string;
    readonly config: unknown;
  };

  readonly disabled: boolean;

  readonly onChange: (calculator: { ref: string; config: unknown }) => void;
}
```

各 plugin slot component：

```text
如果 selected ref 不是自己的
→ render null
```

Formula slot 只编辑：

```text
{ versionId }
```

---

# 9.6 Formula Version picker

Formula plugin 提供 batch-scoped API：

```text
listBindableFormulaVersions
```

必须：

```text
require assessment.batch.manage
```

不是 Formula manage。

显示：

```text
Formula name
Version N
publishedAt
parameter summary
```

选择真正保存：

```text
versionId
```

不要保存 label/versionNo。

---

# 9.7 Existing archived binding UI

当前 Item 绑定的 version 即使：

```text
Formula archived
owner node gone
```

也必须显示。

列表 API 可以接：

```text
currentVersionId
```

规则：

```text
new options:
  only bindable

current exact version:
  additionally return if this item already binds it
```

UI 标注：

```text
已停用，不可用于新的绑定
```

但不得强迫用户切换。

---

# 9.8 Generic scoring preview endpoint

Assessment Core 增加通用 preview。

例如：

```text
POST /assessment/batches/:batchId/scoring-preview
```

请求：

```ts
{
  itemType: string
  formConfig: unknown

  calculator: {
    ref: string
    config: unknown
  }

  currentRevisionId?: string
}
```

响应：

```ts
{
  calculator: {
    ref: string;
    contractHash: string;
  }

  inputSchema: NormalizedInputSchema;
  outputSchema: NormalizedAtomicSchema;

  bindableFields: Array<{
    fieldId: string;
    payloadKey: string;
    schema: AtomicSchema;
    always: boolean;
  }>;
}
```

server 使用真正：

```text
ItemTypeDriver.bindableFields
RuntimeCatalog.compile
```

所以 browser 不复制 Evidence schema semantics。

---

# 9.9 Generic Binding Editor 属于 Core

Formula picker 属于 Formula plugin。

参数 binding UI 属于 Assessment Core。

原因：

```text
typed calculator parameter binding
```

不是 Formula 特有概念。

未来其他 calculator 一样可以复用。

UI 对每个 Formula input parameter 显示：

```text
参数名
schema kind
constraints

来源:
  固定值
  认定字段
```

---

# 9.10 Constant editor

根据 AtomicSchema kind：

```text
text
integer
decimal
choice
boolean
date
```

使用 typed editor。

提交前 local validate。

decimal UI 最终保存 canonical string 或由 server canonicalize；无论 browser spelling 如何，server compile 后 plan identity 必须 canonical。

---

# 9.11 Recognition editor

选择 Recognition binding 时：

```text
label
refinement
default Evidence field
```

新 Recognition 在 browser 只有 draft handle。

server save 后返回 normalized UUID config。

UI 收到 refreshed Item DTO 后切换到 server UUID。

不要把 draft handle 当历史 identity。

---

# 9.12 refinement UI

根据 parameter schema 提供收窄 controls。

第一版：

### integer

```text
minimum
maximum
```

### decimal

```text
minimum
maximum
maxScale
```

### choice

允许选 Formula enum 的 subset。

### text

只提供当前 value-schema 能准确证明的约束。

### boolean/date

若没有可安全表达的 refinement，直接使用 Formula schema。

UI 每次修改可 local `assignmentPlan()` 预判。

server save 仍重新证明。

---

# 9.13 Evidence default picker

默认来源列表来自 preview response 的 `bindableFields`。

每项显示：

```text
field label
field type
compatibility
```

不兼容：

```text
disabled
```

可以展示原因：

```text
范围过宽
精度过高
选项不完全包含
类型不同
```

前端原因可用 shared diagnose helper；不要重新实现 assignability。

---

# 9.14 no-op round-trip

7.4 最关键 browser gates：

```text
fixed item open/save
→ unchanged

formula item open/save no-op
→ unchanged

formula item title edit only
→ scoring unchanged

archived bound formula item title edit
→ succeeds

switch Formula V1 → V2
→ exact new versionId

reload
→ Recognition UUIDs preserved

change label only
→ semantic plan identity unchanged
```

---

# 10. Phase 7.5 — Determination / Impact / Failure Semantics

Formula 能算不代表业务闭环。

这是 Phase 7 最容易漏掉的一层。

---

# 10.1 q.fail 是合法业务拒绝

Schema 只能验证单字段值域。

Formula 可以表达跨字段规则：

```ts
if (...) {
  q.fail('...')
}
```

因此：

```text
Recognition schema-valid
```

不等于：

```text
Formula admissible
```

---

# 10.2 Recognition 成为正式事实前必须 probe calculator

所有 terminal determination：

```text
review approve
administrative record
automatic approval
```

在写 `EntryRecognition` 前都必须证明：

```text
candidate Recognition
→ current frozen ScoringPlan
→ calculator accepts
```

不要等到学生打开成绩页才发现 approved Recognition 无法计算。

---

# 10.3 抽取共享 evaluation primitive

不要为 settlement 写第二个 Formula evaluator。

从当前 `evaluateEntry()` 抽出共享核心，例如：

```ts
evaluateRecognition(...)
```

职责：

```text
assemble input
applyAssignment
validate input
PreparedCalculator.evaluate
validate output
scale exact amount
```

`evaluateEntry()` 只在外面加：

```text
entryId
revisionId
itemId
```

这样：

```text
result scoring
review settlement probe
change impact probe
```

全部共用一条真实执行语义。

---

# 10.4 不在 DB transaction 中运行 Sandbox

必须采用 optimistic two-phase。

### Phase A — capture

短 transaction：

```text
lock relevant row
capture:
  itemRevisionId
  planHash
  review/entry state
  candidate Recognition
  candidate canonical hash
commit
```

### Phase B — evaluate

transaction 外：

```text
RuntimeCatalog.prepare
evaluate candidate
```

### Phase C — commit

重新 transaction + lock：

验证：

```text
itemRevisionId unchanged
planHash unchanged
review/entry state unchanged
candidate/token unchanged
```

都相同才：

```text
append EntryRecognition
move pointer/status
append review event
```

否则：

```text
typed conflict
```

重新来。

不要持有 DB connection 等 Sandbox。

---

# 10.5 q.fail settlement 行为

`q.fail`：

```text
不写 EntryRecognition
不 approve
不算 0
```

reviewer/admin 收到结构化拒绝。

message 是 Formula business text，可以显示，但必须：

```text
bounded
escaped by UI
not treated as translation key
```

---

# 10.6 SandboxUnavailable settlement 行为

```text
不写事实
不 approve
返回可重试 unavailable
```

不能变成：

```text
500 defect
```

也不能：

```text
0 score
```

---

# 10.7 formula execution defect

timeout / memory / stack / exception：

```text
不写 Recognition
```

与 `q.fail` 分开。

用户看到的文案不应暴露内部 stack。

日志必须包含：

```text
tenantId
batchId
itemId
calculatorRef
runtimeRef id/hash
failure kind
trace id
```

不得日志输出完整 Evidence/Recognition 敏感 payload。

---

# 10.8 Result API failure semantics

当前 provisional result 把 evaluation failure `orDie`。

Formula 上线后修改。

### unavailable

向 API 暴露 typed：

```text
SCORING_UNAVAILABLE
```

HTTP：

```text
503
```

UI：

```text
暂时无法计算成绩，请稍后重试
```

### refusal

理论上 7.5 settlement + impact gate 后不应在稳定数据中出现。

如果仍出现：

```text
operator invariant breach
```

不要展示 0。

### integrity/invariant

继续 defect/fail closed，日志点名 item/revision/runtimeRef。

---

# 10.9 Current-plan scoring 语义继续保留

现有行为：

```text
approved Entry
使用 Item 当前 revision 的 ScoringPlan
```

Phase 7 不改成：

```text
submission-day plan
```

因此 Formula V1 → V2 会影响已有 approved Entry 的 provisional amount。

这要求增强 Item ChangeImpact。

---

# 10.10 Scoring ChangeImpact

Item update compile 新 plan 后比较：

```text
old evaluationIdentity
new evaluationIdentity
```

相同：

```text
scoring impact = none
```

不同：

对已有 effective Recognition 实际 probe。

至少统计：

```ts
{
  evaluated: number;
  unchanged: number;
  changed: number;
  rejected: number;
}
```

---

# 10.11 rejected existing Recognition 是 hard block

第一版不要自动：

```text
reopen
invalidate
reject
reroute
```

已有正式 Recognition 如果新规则 `q.fail`：

```text
Item update refused
```

理由：

```text
new scoring rule rejects existing recognized facts
```

否则保存后成绩页必然出现 approved-but-unscorable。

以后若需要“批量重新认定”，另立业务功能。

---

# 10.12 changed amount 可以进入现有 impact acknowledgement

如果：

```text
all existing Recognitions still computable
but amount changes
```

允许纳入现有 active-batch ChangeImpact。

管理员需要看到：

```text
多少条结果变化
```

并继续走已有：

```text
reason
impact token
configRevision
config event
```

不要另造一个平行 confirmation 系统。

---

# 10.13 Formula change impact 不比较 runtime strings

不能：

```text
versionId changed
→ 一定有影响
```

也不能：

```text
planHash changed
→ 一定分数变
```

真实影响：

```text
evaluationIdentity
+
existing facts actual evaluation
```

版本变化但结果恰好一致，仍记录规则改变，但 amount impact 可以是 0。

---

# 10.14 Derived Item

Derived Item 没有普通 Entry。

但 scoring rule 变化可能影响整个 roster。

ChangeImpact 不能：

```text
affectedEntryCount === 0
→ no scoring impact
```

对 derived item：

```text
evaluate derived grant under old/new plan
```

如果 amount 变，明确报告。

---

# 10.15 7.5 Done

承重：

```text
q.fail candidate
→ no Recognition persisted

Sandbox down during approval
→ no Recognition persisted

state changes while Sandbox running
→ stale evaluation cannot commit

Formula V2 rejects old Recognition
→ item config save refused

Formula V2 changes amount but accepts all
→ impact reports changed count

result Sandbox outage
→ 503, never zero

fixed@1 result path unchanged
```

---

# 11. Phase 7.6 — Production Rollout / Performance / Final Acceptance

---

# 11.1 必须 reader-first rollout

ScoringPlan V2 和 formula@1 是 rolling deployment 协议。

不能单次发布同时：

```text
新 reader
+
新 writer
```

---

# 11.2 Deployment A — runtime/read support

所有实例先具备：

```text
runtime phase
ScoringRuntimeCatalog
ScoringPlan V1 + V2 reader
formula@1 runtime
FormulaRuntimeStore
runtimeRef validation
boot audit
Formula binding APIs
UI chunks可以存在但 writer disabled
```

此阶段：

```text
不允许创建 formula@1 Item
```

可以通过 server feature flag / writer capability 控制。

优先用 assembly/config 中已有模式，不增加临时 module global flag。

---

# 11.3 Deployment A 验证

所有生产实例必须报告同一：

```text
assembly resolution
reader capability
runtime calculator refs
supported ScoringPlan versions
```

boot audit 全绿。

再进入 B。

---

# 11.4 Deployment B — writer enable

之后才允许：

```text
Formula option 出现在 Item calculator selector
保存 ScoringAuthoring V2
写 ScoringPlan V2
```

这样不会发生：

```text
new node writes formula plan
→ old node receives result request
→ old node cannot execute
```

---

# 11.5 Boot readiness

boot audit 应保证：

```text
每个 stored plan:
  readable
  hash valid
  schema language supported
  converter vocabulary supported
  calculator definition installed
  calculator runtime installed
  aggregator installed
  immutable runtime fact verifiable
```

不保证：

```text
Sandbox socket 此刻在线
```

Sandbox outage 属 request-time availability。

---

# 11.6 Performance benchmark

至少测：

```text
1 Formula Item / 100 approved entries
5 Formula Items / 500 approved entries
10 Formula Items / 1000 approved entries
```

记录：

```text
result page p50
p95
total Sandbox invokes
FormulaVersion DB queries
CPU
memory
Sandbox process CPU
runtime timeouts
```

---

# 11.7 优化顺序

第一层已经通过 `prepare()` 避免同 plan 重复 FormulaVersion lookup。

如果仍慢：

### 1. request-local plan cache

```text
planHash
→ PreparedCalculator
```

### 2. 有界并发

Sandbox invoke 可有界 parallel，但不能无限 `Effect.all`。

并发上限由 benchmark 决定。

### 3. FormulaRuntimeStore bounded cache

FormulaVersion immutable，所以可以在 **Layer-scoped service 内**缓存：

```text
tenantId + versionId
→ verified immutable row
```

允许 bounded LRU。

禁止：

```text
module-global Map
```

无需 invalidation，因为 published version 永不改变。

### 4. Sandbox artifact/bytecode cache

可以缓存 immutable artifact compilation，但：

```text
每次 invocation 仍创建 fresh execution context
```

不能为性能复用 user global state。

### 5. ScoreRun

不在 Phase 7 做。

如果实时 provisional scoring 最终规模不足，再由后续 ScoreRun/Publication 阶段持久化结果。

---

# 12. API 设计汇总

Phase 7 预计新增/调整的服务端能力。

## Assessment Core

### generic calculator preview

```text
POST /assessment/batches/:batchId/scoring-preview
```

batch manage only。

### existing Item create/update

继续原 endpoint。

server 内：

```text
normalize ScoringAuthoring
compile plan
change impact
write revision
```

### result

原 endpoint增加：

```text
ScoringUnavailable
```

---

## Formula plugin

### bindable versions

例如：

```text
GET /assessment/batches/:batchId/formula-versions
```

query 可包含：

```text
currentVersionId
```

用途：

```text
new binding options
+
existing archived binding display
```

不要复用：

```text
/assessment/formula-functions
```

management API。

Formula authoring API 保持现有权限语义。

---

# 13. 数据库迁移

Phase 7 自己必须做的 migration：

## FormulaVersion permanence

```text
FormulaVersion → FormulaFunction
CASCADE → RESTRICT/NO ACTION
```

## 若当前 HEAD 尚未落地的已记账 hardening

可以和最近 Assessment migration 合并，但不应为 Formula 单独制造无关 migration：

```text
AssessmentBatch.currentPhaseId same-batch FK
BatchParticipantEvent same-batch participant FK
```

执行前查 HEAD；若已修，跳过。

---

# 14. 文件组织建议

不要把所有代码继续塞进 Formula `server/index.ts`。

建议逐步拆：

```text
packages/plugins/assessment/formula/src/
  server/
    index.ts
    runtime-store.ts
    runtime-compatibility.ts
    binding-catalog.ts
    contract-identity.ts

  scoring/
    formula-calculator.ts

  client/
    FormulaCalculatorEditor.tsx
```

Assessment：

```text
packages/plugins/assessment/core/src/
  scoring/
    plan.ts
    runtime.ts
    evaluate.ts
    backfill.ts

  client/items/
    ItemConfigEditor.tsx
    CalculatorBindingEditor.tsx
    RecognitionEditor.tsx

  ui.ts
```

Value Schema：

```text
packages/core/value-schema/src/
  convert.ts
```

继续作为唯一 assignment runtime 实现位置。

Plugin kit：

```text
packages/core/plugin-kit/src/
  index.ts
  assemble.ts
```

---

# 15. 建议提交顺序

不要按“一个 Phase 一个巨型 commit”。

建议：

```text
Phase 7.0
feat(plugin-kit): add runtime extension phase
test(plugin-kit): prove runtime outputs feed after-service consumers

refactor(assessment): split scoring definitions from runtime bindings
feat(assessment): add trusted calculator host context
refactor(value-schema): centralize assignment execution
fix(evidence): make required text schema effective
fix(assessment): reject evidence retype with reused identity
fix(core): close prototype-sensitive business-key writes
fix(sandbox): expose effective transport ceilings
test(assessment): prove service-backed scoring through real path

Phase 7.1
feat(assessment): expose narrow batch configuration extension access
feat(formula): add immutable FormulaRuntimeStore
feat(formula): add runtime compatibility gate
fix(formula): make published versions database-permanent
feat(formula): expose exact FormulaVersion identity
feat(formula): add batch-scoped BindableFormulaCatalog

Phase 7.2
feat(assessment): add ScoringAuthoring v2
feat(assessment): mint Recognition identities server-side
feat(assessment): add Recognition refinements
fix(assessment): canonicalize constant bindings
feat(assessment): add ScoringPlan v2 runtimeRef
test(assessment): replay v1 and v2 plans side by side

Phase 7.3
feat(formula): register formula@1
fix(formula): seal sandbox formula entrypoints
feat(assessment): classify calculator runtime failures
test(formula): score a published formula through real sandbox

Phase 7.4
refactor(assessment): make item scoring configuration round-trip opaque
feat(assessment): add calculator authoring surfaces
feat(assessment): add generic scoring preview
feat(assessment): add typed binding editor
feat(formula): add exact FormulaVersion picker
test(browser): prove formula item no-op round-trip

Phase 7.5
refactor(assessment): share recognition evaluation primitive
feat(assessment): probe calculator before determination settlement
feat(assessment): add scoring change impact
feat(assessment): surface scoring unavailability without zero fallback

Phase 7.6
feat(assessment): enable scoring plan v2 writer
feat(formula): enable formula@1 authoring
perf(assessment): benchmark formula provisional scoring
test(assessment): prove rolling reader-before-writer deployment
docs(assessment): close Phase 7
```

实际 commit 名可以调整，但不要跨阶段混合语义。

---

# 16. 测试矩阵

Phase 7 封板至少必须覆盖以下层次。

## Pure unit

```text
assignment
canonical value
recognition refinement
plan V1/V2 hash
runtimeRef semantic identity
compatibility policy
envelope parsing
evaluationIdentity
```

## Kernel

```text
prepare → services → runtime → afterServices
duplicate runtime contribution
missing runtime definition
missing runtime service
runtime built once
```

## Database

```text
FormulaVersion permanence
cross-tenant FormulaVersion resolution
exact UUID
management-anchor binding eligibility
server-minted Recognition ids
migration replay from empty DB
schema parity
```

## Assessment integration

```text
service-backed compile
service-backed prepare/evaluate
boot audit
backfill
Recognition settlement
change impact
result failure mapping
```

## Formula integration

```text
publish
runtime resolve
formula@1 compile
Sandbox execute
q.fail
timeout
tamper
ABI mismatch
archived function replay
```

## Browser

```text
Formula picker
parameter binding
Recognition refinement
Evidence compatibility disabling
reload round-trip
title-only edit preserves Formula config
archived existing binding display
```

## Production smoke

```text
real server
real PG
real sandbox process
real published FormulaVersion
real Item
real Recognition
real result
```

---

# 17. 禁止实现

以下任何实现即使测试暂时能绿，也应拒绝。

```text
Assessment Core import Formula plugin

Assessment Core import Sandbox

Assessment Core import QuickJS

module-global FormulaRuntimeStore

module-global calculator registry

late assignment:
  let sandbox
  start() { sandbox = ... }

formula config stores tenantId

formula config stores batchId

formula config stores runtimeJs

Formula uses latest version

Formula runtime uses FormulaLibrary management API

Formula evaluator fabricates Principal

Batch manager receives assessment.formula.manage just为了选公式

FormulaFunction archive makes historical item unusable

FormulaVersion parent delete cascades versions

ScoringPlan V1 rewritten in place

old plans recompiled silently

runtimeRef omitted from Formula plan identity

Sandbox failure → amount 0

q.fail → amount 0

Sandbox run inside DB transaction

browser-only type safety

second assignment converter implementation

second Formula evaluator

second schema containment implementation

unbounded global result cache

reuse one mutable QuickJS context across entries
```

---

# 18. Phase 7 最终验收场景

最终至少跑通：

```text
1. 管理员创建 FormulaFunction

2. Monaco/TS7/LSP 编写：
   Schema + Decimal + defineFormula

3. draft preview

4. try-run

5. tests

6. publish FormulaVersion V1
   → exact UUID

7. Batch manager 打开 Item

8. Formula picker 只看到该 Batch 可绑定版本

9. 选择 V1 UUID

10. Core 读取 Formula parameter schemas

11. 配 Recognition:
    Formula P
      ↑
    Recognition R
      ↑
    Evidence E

12. server 证明：
    E ⊆ R ⊆ P

13. server mint Recognition UUID

14. save ItemRevision

15. freeze ScoringPlan V2:
    exact versionId
    runtime hash
    contract
    bindings
    converters
    schemas
    planHash

16. 学生提交 Evidence

17. reviewer 得到 Evidence default

18. reviewer 调整 Recognition

19. terminal approval 前真实 Formula probe

20. q.fail 时不落事实

21. 成功时 append EntryRecognition

22. result:
    Recognition
      ↓
    RuntimeCatalog.prepare
      ↓
    exact FormulaVersion
      ↓
    integrity/compatibility check
      ↓
    Sandbox
      ↓
    amount
      ↓
    Aggregator
      ↓
    ScoreGroup
      ↓
    Breakdown
```

---

# 19. 历史与故障验收

还必须证明：

```text
publish V2
→ V1 Item 不自动跳 V2

archive FormulaFunction
→ V1 historical Item 继续算
→ 新 Item 不可选

delete owner OrgNode
→ historical Item 继续算
→ 新 binding fail closed

wrong tenant UUID
→ 不可解析

tamper runtimeJs
→ boot/runtime fail closed

tamper runtimeRef hash
→ fail closed

Sandbox offline
→ 503 / unavailable
→ 不计 0

Formula timeout
→ 不写 Recognition

q.fail
→ 不写 Recognition

Item 从 V1 Formula 改 V2
且 old Recognition 被 V2 拒
→ 配置更新拒绝

Item 从 V1 改 V2
全部仍可算但分值变化
→ ChangeImpact 明确报告

old fixed@1 ScoringPlan V1
→ byte/semantic behaviour 不变
```

---

# 20. Phase 7 Definition of Done

只有同时满足以下定义，才允许 `STATUS.md` 写：

```text
Phase 7 — DONE
```

系统必须做到：

```text
FormulaVersion 是永久 immutable runtime fact

Item 永远引用 exact FormulaVersion UUID

Formula 不接触业务上下文

Evidence ⊆ Recognition ⊆ Formula parameter
在配置期证明

ScoringPlan 冻结 runtime identity

历史 Plan V1/V2 均 fail-closed replay

service-backed calculator 通过正式 plugin topology

无 global late binding

Formula 执行只发生在 Sandbox process

Recognition settlement 前验证 Formula admissibility

Sandbox outage 不产生 0 分或错误业务事实

Formula rule change 对既有 Recognition 有正式 impact gate

Item editor 对未知 calculator 配置可无损 round-trip

Formula management auth 与 Formula binding auth 分离

滚动部署 reader-first / writer-second

真实 PG + Sandbox + browser E2E 全绿

calcParticipant 仍是 pure function

Assessment Core 仍然不知道 Formula/Sandbox/QuickJS
```

在此之前，即使 UI 已经能选公式、Sandbox 也已经能算出分数，都只能称：

```text
Phase 7 in progress
```

不能提前封板。

---

# 21. 开工第一步

不要直接实现 `formula@1`。

第一笔工作只做 Phase 7.0 runtime topology。

先写失败测试证明当前：

```text
service-backed calculator
→ real Assessment compile/evaluate
```

无法在无 global state 情况下闭合。

然后实现：

```text
prepare
→ services
→ runtime
→ afterServices
```

并让 synthetic service-backed calculator 真正穿过：

```text
Scoring registration
→ compileScoringPlan
→ ScoringPlan
→ prepare
→ evaluate
```

只有这条 bearing gate 通过，才开始 FormulaRuntimeStore。

这是 Phase 7 的第一道承重墙。
