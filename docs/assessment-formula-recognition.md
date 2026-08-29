# Qualy 严格类型认定与可编程计分系统：设计与开发规范

> 状态：设计定案草案
> 日期：2026-08-29
> 适用仓库：`hprogq/qualy`
> 目标：建立“材料 → 审核认定 → 严格类型参数绑定 → 确定性计分函数 → 精确计分”的完整基础设施，同时保持插件边界、历史可回放、前后端类型一致和业务无关性。

## 1. 文档效力

本文是对 `docs/assessment-design.md` 中旧 calculator/custom formula 方案的后续收敛。以下旧设计若与本文冲突，以本文为准：Calculator 直接消费 `EntryRevision.payload`；custom formula 直接读取整题 entries；竞赛等业务规则各自增加 calculator；公式依赖完整 Effect 运行时；Recognition 作为修正后的 Evidence payload。

其他已经冻结的设计不变，包括 EntryRevision append-only、ReviewInstance/ReviewEvent 审计模型、Aggregator、ScoreGroup cap/floor、精确 bigint scorer、Publication 冻结以及插件装配纪律。

当前仓库已经使用 TypeScript `7.0.2`、Node `>=24.12`、Effect `4.0.0-rc.111`，根类型检查直接调用 workspace `tsc`，并由 `@effect/tsgo` patch 接入 Effect diagnostics。 TypeScript 7 已经是原生 Go 实现并提供新的原生语言服务器，但当前尚不提供成熟稳定的程序化 Compiler API，因此 Formula 的编译和编辑器集成都必须优先围绕 CLI/LSP，而不是 `import("typescript")` 后直接操作 compiler internals。([Microsoft Developer Blogs][1])

---

## 2. 整个设计只有四层业务事实

不要再把所有东西塞进一个 payload。

第一层是 **Evidence**。它表示“提交者实际上提交了什么”。学生填写的赛事名称、申报级别、获奖名称、奖项序位、章程、证书，都属于 Evidence，继续保存在 `EntryRevision.payload`。EntryRevision 永远不可被审核员修改。

第二层是 **Recognition**。它表示“审核以后，Qualy正式认定了什么”。例如学生申报“国家级、一等奖、集体”，审核员最终认定“省部级、奖项序位 2、集体”。Recognition 是新的 append-only 业务事实，不是修改后的 EntryRevision。

第三层是 **Formula/Calculator**。它只接收严格类型的 Recognition 参数，并输出一个精确分值。公式不知道学生是谁，不知道证书，不访问 Entry，不访问数据库，也不读取其他题。

第四层是现有 **Aggregator + ScoreGroup**。每条 approved Entry 得到 amount 后，现有 `sum/max/top-n-sum` 等决定同题多条如何计入，ScoreGroup 继续负责组合 cap/floor。

权威数据流固定为：

```text
EntryRevision.payload
        Evidence
           │
           │ 首级默认值
           ▼
ReviewEvent.recognitionPayload
     审核节点认定快照
           │
           │ terminal approve
           ▼
EntryRecognition.values
        有效认定
           │
           │ scoring plan
           ▼
Formula typed input
           │
           ▼
exact amount
           │
           ▼
Aggregator → ScoreGroup → Breakdown
```

当前 scorer 直接把 approved EntryRevision 的 `payload` 交给 calculator；代码本身已经明确写明这只是 M2 临时有效事实，将来 adjudication layer 可以替换输入来源而不碰 scorer。这正是现在应当利用的切入点。

---

## 3. 最核心的不变量：类型必须在配置阶段被证明安全

只要管理员把一个学生字段配置为某个认定参数的默认来源，系统就必须在保存题目时证明：

```text
EvidenceFieldSchema
        ⊆
RecognitionSchema
        ⊆
FormulaParameterSchema
```

不是“实际填进来的值到时候再试一下”，而是所有合法值都必须安全。

例如函数允许：

```text
ordinal: integer >= 0
```

某题进一步规定审核员认定：

```text
ordinal: integer >= 10
```

这是合法收窄。

如果学生字段也是：

```text
integer >= 10
```

可以绑定。

如果学生字段是：

```text
integer >= 1
```

不能绑定，即使某个学生当前实际填的是 20。因为字段本身允许产生 5，而 5 不符合 Recognition。

前端下拉框要直接把这种字段置灰，后端保存 ItemRevision 时用同一实现再次验证。前端永远不是安全边界。

---

# 4. 最终组件划分

这次不应该只做 `sandbox` 和 `formula` 两个大包。真正稳定的划分是“两块普通核心能力 + 两个插件 + 修改两个现有插件”。

| 组件                                | 位置                                  | 性质            | 职责                                                                     |
| ----------------------------------- | ------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| `@qualy/value-schema`               | `packages/core/value-schema`          | 普通核心包      | JSON Schema 子集、validator、类型包含、canonicalization                  |
| `@qualy/formula`                    | `packages/core/formula`               | 普通 SDK        | 管理员公式唯一可 import 的 Schema/Decimal/Formula API                    |
| `@qualy/plugin-sandbox`             | `packages/plugins/infra/sandbox`      | infra 插件      | 资源受限、确定性执行自包含 JS                                            |
| `@qualy/plugin-assessment-formula`  | `packages/plugins/assessment/formula` | assessment 插件 | 函数库、TS7、编辑器、编译、版本、测试、`formula@1`                       |
| `@qualy/plugin-assessment`          | 已有                                  | 修改            | Recognition、typed calculator contract、scoring plan、审核与 scorer 接缝 |
| `@qualy/plugin-assessment-evidence` | 已有                                  | 修改            | richer fields、表单 → JSON Schema、可绑定字段描述                        |

工作区现有 glob 已经能覆盖 `packages/core/*` 和 `packages/plugins/*/*`，无需改变 workspace 结构。

---

# 5. `@qualy/value-schema`：全系统唯一的数据类型协议

这个包不依赖 Effect，也不知道 assessment/formula/Evidence。

JSON Schema Draft 2020-12 是持久化和交换格式，但 Qualy 只允许一个能够完整证明兼容关系的严格子集。

第一版只支持六种语义类型：

```text
text
integer
decimal
choice
boolean
date
```

不要支持 nullable、optional、array、nested object、`oneOf`、`anyOf`、`not`、递归 `$ref`、`if/then/else`。

原因不是这些功能不能校验，而是 Qualy还必须准确判断：

> Schema A 能产生的每一个值，是不是一定都满足 Schema B？

完整 JSON Schema 上这是远比普通实例验证复杂的问题。这里主动缩小语言，换取真正可证明的严格类型。

## 5.1 text

```json
{
  "type": "string",
  "minLength": 1,
  "maxLength": 100
}
```

可选支持 `pattern`。Pattern 的 assignability 采取保守策略：target 无 pattern 可以；两边 pattern 完全相同可以；其他情况判定“无法证明”，拒绝绑定。不要实现正则语言包含证明器。

## 5.2 integer

```json
{
  "type": "integer",
  "minimum": 1,
  "maximum": 100
}
```

所有 integer 都必须限制在 JavaScript safe integer 域。`Schema.integer()` 即使用户没配置范围，也要隐式生成：

```text
Number.MIN_SAFE_INTEGER
~
Number.MAX_SAFE_INTEGER
```

否则 JSON 解析阶段就可能已经丢精度。

第一版只做 inclusive minimum/maximum。

## 5.3 choice

```json
{
  "type": "string",
  "enum": ["national", "provincial", "city"],
  "x-qualy-enumLabels": {
    "national": "国家级",
    "provincial": "省部级",
    "city": "市级"
  }
}
```

类型只看 stable value ID。中文 label 是 annotation，修改 label 不改变类型。

## 5.4 boolean

```json
{
  "type": "boolean"
}
```

底层保留即可，产品 UI 不一定需要大量使用。

## 5.5 date

```json
{
  "type": "string",
  "format": "date"
}
```

Formula 内部仍是字符串/brand，不允许 JS `Date`。

## 5.6 decimal

Decimal 是唯一必须自定义 JSON Schema vocabulary 的类型。

不能使用：

```json
{ "type": "number" }
```

因为这会重新把 IEEE-754 引回权威计分路径。当前 scorer 已经坚持 decimal string → 1e-4 bigint，不能倒退。

建议：

```json
{
  "type": "string",
  "format": "qualy-decimal",
  "x-qualy-maxScale": 4,
  "x-qualy-minimum": "0.00",
  "x-qualy-maximum": "6.00"
}
```

JSON 中永远是 canonical decimal string。

---

# 6. Validator 与类型兼容算法

建议给 `@qualy/value-schema` 加 `ajv@8.20.0`。Ajv 当前支持 Draft 2020-12，并允许注册自定义 format/keyword。([NPM][2])

必须使用类似配置：

```ts
new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: true,
})
```

Qualy 再显式注册：

```text
qualy-decimal
x-qualy-maxScale
x-qualy-minimum
x-qualy-maximum
```

绝不允许 validator 自动转换 `"3"` → `3`、自动补 default 或删除额外字段。

核心 API 建议：

```ts
validateProfile(schema)
validateValue(schema, value)

assignmentPlan(sourceSchema, targetSchema)

normalizeSchema(schema)
canonicalizeSchema(schema)
semanticHash(schema)
```

其中：

```ts
type AssignmentPlan =
  | { kind: 'direct' }
  | {
      kind: 'convert'
      converter: 'integer-to-decimal@1'
    }
  | {
      kind: 'incompatible'
      code: string
      detail?: unknown
    }
```

第一版唯一允许的自动 widening 是：

```text
integer → decimal
```

因为数学上完全无损，但 JSON 表示不同，例如：

```json
3
```

转换为：

```json
"3"
```

这必须作为版本化 converter 明确写进编译后的 scoring plan，不能运行时偷偷 `String(value)`。

其他：

```text
text → integer
decimal → integer
text → date
choice → text
```

第一版一律禁止。

即使某些从集合论看也安全，先保持语义类型严格一致。

---

# 7. Formula Input 强制为扁平 Object

公式 Input 必须是：

```json
{
  "type": "object",
  "properties": {
    "level": { "...": "atomic schema" },
    "ordinal": { "...": "atomic schema" },
    "base": { "...": "atomic schema" }
  },
  "required": ["level", "ordinal", "base"],
  "additionalProperties": false
}
```

每个字段只能是前面的六种 atomic schema。

第一版不允许：

```text
foo.bar
items[0]
nested object
array
optional parameter
nullable parameter
```

这是值得永久保留一段时间的限制，因为计分函数本质就是：

```text
一组有名字的参数 → 一个分值
```

管理端也因此天然能显示：

| 参数    | 函数要求    | 本题值来源 |
| ------- | ----------- | ---------- |
| level   | choice      | 审核认定   |
| ordinal | integer ≥ 1 | 审核认定   |
| base    | decimal     | 固定值     |
| step    | decimal     | 固定值     |

没有路径 DSL，也没有低代码对象编辑器。

---

# 8. `@qualy/formula` SDK

**已裁决(2026-08-29,取代本节原有的 TypeBox 方案):`@qualy/formula` 手写、零第三方依赖。**
不另造持久化类型语言——`@qualy/value-schema` 的受限 JSON Schema 是唯一运行时合同,SDK 的
Schema 构造器直接产出这些 profile 对象,只叠加 phantom 泛型以获得 `Static<S>` 推导;
Decimal 是 Qualy 自己的 opaque static/runtime 类型,JSON wire 表示仍为 canonical decimal string。
SDK 的 runtime(decode/encode 与 Decimal 算术)会被 esbuild 打进每个公式 artifact,因此保持极小、
纯逻辑、不引入 Ajv/node:crypto;Schema 产物、contract、definition 与 Decimal 运行时值一律 deep-frozen。

管理员只能:

```ts
import { Schema, defineFormula } from '@qualy/formula'
```

Qualy 只暴露：

```ts
Schema.text(...)
Schema.integer(...)
Schema.decimal(...)
Schema.choice(...)
Schema.boolean()
Schema.date(...)
Schema.input(...)
```

构造器之外不暴露任何类型组合子(没有 Union/Intersect/Transform 这一层)。

Formula 的目标源码：

```ts
import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice({
      national: '国家级',
      provincial: '省部级',
      city: '市级',
    }),

    ordinal: Schema.integer({
      minimum: 1,
    }),

    projectType: Schema.choice({
      individual: '个人',
      team: '集体',
    }),

    base: Schema.decimal({ maxScale: 4 }),
    step: Schema.decimal({ maxScale: 4 }),
    floor: Schema.decimal({ maxScale: 4 }),
  }),

  output: Schema.decimal({ maxScale: 4 }),

  run(input, q) {
    const deduction = q.decimal.mulInteger(input.step, input.ordinal - 1)

    return q.decimal.max(q.decimal.sub(input.base, deduction), input.floor)
  },
})
```

`run` 的类型必须完全由 Input/Output Schema 推导：

```ts
function defineFormula<
  const I extends FormulaInputSchema,
  const O extends FormulaOutputSchema,
>(definition: {
  input: I
  output: O

  run: (input: Static<I>, q: FormulaContext) => Static<O>
}): FormulaDefinition<I, O>
```

因此不存在另外的：

```ts
interface Input
type Output
```

管理员只维护 Schema。

TS7 自动知道：

```ts
input.level
// "national" | "provincial" | "city"

input.ordinal
// number
```

如果写：

```ts
input.ordinal.toUpperCase()
```

编译失败。

如果 Output 是 Decimal，却：

```ts
return true
```

同样失败。

`minimum: 1` 这种 refinement 则由运行时 JSON Schema validator 保证，因为 TypeScript 本身不应该被强行改造成“>=1 类型系统”。

---

# 9. Decimal Runtime

Formula 内不能让 Decimal 实际上只是普通字符串。

内部建议实现：

```ts
interface DecimalInternal {
  coefficient: bigint
  scale: number
}
```

对管理员暴露 opaque `Decimal`。

FormulaContext 第一版提供：

```ts
q.decimal.add(a, b)
q.decimal.sub(a, b)
q.decimal.mul(a, b)
q.decimal.mulInteger(a, integer)
q.decimal.compare(a, b)
q.decimal.min(a, b)
q.decimal.max(a, b)
q.decimal.abs(a)
q.decimal.negate(a)
q.decimal.quantize(a, scale)
q.decimal.fromInteger(n)

q.fail(message)
```

`div` 第一版不要随便加。除法必须先明确输出 scale 和舍入策略，不能默认产生隐藏的数值语义。如果真实规则要求，再设计：

```ts
q.decimal.div(a, b, {
  scale: 4,
  rounding: 'half-away-from-zero',
})
```

所有中间运算使用任意 scale 的 BigInt 十进制；Formula 输出不自动截断。如果 Output 要求最多 4 位，而函数算出了 6 位，应当 output validation 失败，作者明确 `quantize`，避免隐藏舍入。

最终 Decimal 输出再交给现有 `scaledAmount()` 进入 bigint scorer。

---

# 10. Formula 不引入 Effect

这是最终决定。

Qualy 后端本身继续完全使用 Effect；Sandbox Service、Formula Service、数据库、API、生命周期仍按项目工程规范写 Effect。

但是管理员公式环境只有：

```text
TypeScript
@qualy/formula
JSON input/output
Decimal helper
```

没有：

```text
Effect
Clock
Random
Fiber
Layer
HttpClient
FileSystem
process
fetch
```

计分函数的业务定义本来就是一个确定性的纯函数。引入 Effect 只会扩大语言和能力表面，而且以后还要解释“为什么你可以 import Effect 却不能用 Clock”。

---

# 11. `@qualy/plugin-sandbox`

Sandbox 是纯执行设施，不能知道 Formula。

建议接口：

```ts
interface Sandbox {
  invoke(input: {
    artifact: string
    artifactHash: string

    entrypoint: string
    arguments: readonly JsonValue[]

    limits?: Partial<SandboxLimits>
  }): Effect.Effect<JsonValue, SandboxError>
}
```

不要提供 tenantId、itemId、functionVersionId。

Formula 插件自己知道上下文，Sandbox 永远业务盲。

## 11.1 QuickJS

推荐精确版本：

```text
quickjs-emscripten-core 0.32.0
@jitl/quickjs-wasmfile-release-sync 0.32.0
@jitl/quickjs-wasmfile-debug-sync 0.32.0
```

当前版本提供 runtime 级 `setMemoryLimit`、`setMaxStackSize`、`setInterruptHandler`，官方也明确建议不受信任代码使用独立 runtime；更强隔离还可以做到独立 WASM module。([NPM][4])

选择 sync variant。Asyncify 会显著增加体积并降低同步执行性能，而 Formula 明确禁止 async，因此没有任何收益。([GitHub][5])

## 11.2 Worker Thread

不要在 Node API 主线程直接执行同步 QuickJS。

结构：

```text
Node 主服务
   │
   ▼
Sandbox Worker Pool
   │
   ├─ Worker 1
   │    └─ QuickJS WASM module
   │
   └─ Worker 2
        └─ QuickJS WASM module
```

每个 Worker 启动时加载一次 WASM module。

每次 invocation：

```text
new QuickJSRuntime
→ set memory limit
→ set stack limit
→ install interrupt handler
→ new Context
→ bootstrap deterministic globals
→ eval artifact
→ call entrypoint
→ dump JSON result
→ dispose Context
→ dispose Runtime
```

第一版每次调用都新建 runtime/context，不复用。先把隔离和正确性做稳；只有 benchmark 明确证明创建 runtime 成为瓶颈以后，才讨论 per-worker runtime + per-call context。

## 11.3 两层超时

第一层是 QuickJS interrupt handler。

第二层是 Node Worker wall-clock watchdog。如果 Worker 超过硬 deadline 连消息都没回来，主线程直接 `worker.terminate()`，补一个新 Worker。

初始建议：

```text
soft deadline       25ms
hard deadline       100ms
runtime memory      16 MiB
stack               512 KiB
artifact            256 KiB
input               64 KiB
output              64 KiB
```

这些是初始基线，必须 benchmark 后调整。

## 11.4 Determinism

执行前移除/禁用：

```text
Date
Math.random
fetch
timers
process
require
WebAssembly
```

最终 artifact 不允许 runtime module resolution。用户源码虽然：

```ts
import { Schema } from '@qualy/formula'
```

但该 import 在 Formula 发布时由 esbuild bundle 掉。

QuickJS 实际收到的是一个完全 self-contained JS artifact，无 import、无 require、无网络 module loader。

---

# 12. Formula 编译链

Formula 插件需要在生产环境执行 TS7 和 esbuild，因此 `typescript`/`esbuild` 不能只作为仓库根 devDependency；Formula 插件自己应声明运行时依赖。

建议新增 catalog：

```yaml
ajv: 8.20.0

esbuild: 0.28.2

quickjs-emscripten-core: 0.32.0
'@jitl/quickjs-wasmfile-release-sync': 0.32.0
'@jitl/quickjs-wasmfile-debug-sync': 0.32.0
```

TypeScript 已经是 `7.0.2`。当前 esbuild 最新线为 0.28.x。([NPM][6])

## 12.1 用户代码只能一个文件

第一版禁止：

```text
相对 import
多个用户文件
任意 npm package
dynamic import
```

唯一允许：

```ts
import ... from '@qualy/formula'
```

这样函数版本本身就是一个完整审计单位。

## 12.2 TS7 typecheck

每次 publish 使用隔离临时 workspace(**必须位于 OS temp,不在仓库树内**,天然切断向上的
node_modules 查找;显式布置 SDK 及其唯一依赖,缺一不可):

```text
<os-tmpdir>/qualy-formula/<job-id>/
  formula.ts
  tsconfig.json
  node_modules/@qualy/formula -> 固定 SDK
  node_modules/@qualy/value-schema -> SDK 的唯一依赖
```

固定 tsconfig，大致：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,

    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    "lib": ["ES2020"],
    "types": [],
    "noEmit": true
  },
  "files": ["formula.ts"]
}
```

tsconfig **不含 `plugins` 节**——公式 typecheck 不启用 @effect/language-service,即使 workspace
的 tsc 二进制本身经过 effect-tsgo patch(2026-08-29 裁决),诊断面与 vanilla TS7 一致。
用户源码含 `/// <reference` 即发布失败(triple-slash 是绕过模块封闭面的旁门)。

调用 workspace-local：

```text
node_modules/.bin/tsc -p <temp>
```

禁止调用 PATH 上的全局 tsc。

不要依赖 TS7 尚未稳定的 programmatic compiler API。([Microsoft Developer Blogs][1])

## 12.3 esbuild

Typecheck 成功后再打包：

```text
platform: neutral
format: iife
target: es2020
bundle: true
treeShaking: true
minify: false
legalComments: none
```

不建议 minify。Formula 本来就很小，未压缩 artifact 对 QuickJS runtime error 和人工审计更友好。

esbuild resolver 对用户源码只接受 `@qualy/formula`，任何其他 bare/relative import 都直接发布失败。

---

# 13. TS7 LSP 与前端编辑器

> **已裁决(2026-08-29):本节整体是第四阶段的后半(4b),独立施工、实施前另做 spike。**
> 它只是编辑体验,不是 Formula 正确性或发布安全的门禁——4a 先以最小源码编辑页交付,
> 发布时服务端 TS7 diagnostics 完整返回。

公式编辑器推荐 Monaco，但实时类型能力不能再依赖 Monaco 内建旧 JavaScript TypeScript worker。

TS7 使用原生语言服务器。官方 TypeScript 7 已经把新的语言服务器作为 native toolchain 的一部分；实践中项目级 native server 通过 workspace-local `tsc --lsp --stdio` 启动。([Microsoft Developer Blogs][1])

结构：

```text
Monaco Editor
     │
     │ WebSocket / LSP JSON-RPC
     ▼
Formula plugin LSP bridge
     │
     │ stdio
     ▼
workspace-local tsc --lsp --stdio
```

每个编辑 session 建一个临时 workspace，只有：

```text
formula.ts
固定 tsconfig
@qualy/formula SDK
```

不暴露 Qualy 仓库源码、不暴露 Node types、不允许用户决定 tsconfig。

LSP session 以 `{userId,functionId}` 隔离，空闲例如 5 分钟后回收。

前端 LSP 只用于 completion、hover、diagnostics、signature help 等体验。点击 Publish 后必须重新启动独立 `tsc --noEmit` 权威检查，绝不能相信编辑器当前 diagnostics。

当前 web infra 没有现成 Formula LSP 通道；实现时允许为了这个明确业务需求给 `@qualy/plugin-web` 增加最小 WebSocket upgrade 能力，但不得借此重构已经封板的 web platform。

---

# 14. Formula Plugin 数据模型

需要两张表。

## 14.1 `assessment_formula_functions`

表示可复用函数的业务身份和 mutable draft：

```text
id                  uuid PK
tenant_id           uuid
owner_node_id       uuid

name                varchar(255)
description         text nullable

draft_source_ts     text
draft_tests         jsonb
draft_revision      integer

created_by          uuid
created_at          timestamptz
updated_by          uuid
updated_at          timestamptz

archived_at         timestamptz nullable
```

`owner_node_id` 是函数归属组织。函数不是某个 Batch 的私有配置，因为它要跨批次复用。

建议不对 org node 建 cascade FK；服务写入时验证 node 属于 tenant。组织后来删除时，已发布公式仍是历史事实，只是不再允许拿一个失效归属创建新配置，直到管理员处理。

新增权限：

```text
assessment.formula.manage
```

函数在某 org node 创建/编辑/发布需要该节点上的权限。

Formula 对 Batch 可用的规则建议是：

> Formula owner node 必须是该 Batch 所有 management anchors 的共同祖先或自身。

这样学院公式只能用于完全属于该学院管理范围的批次；租户根公式可全校使用。

## 14.2 `assessment_formula_versions`

每一行都是 immutable published version：

```text
id                    uuid PK
tenant_id             uuid
function_id           uuid
version_no            integer

source_ts              text
runtime_js             text

input_schema           jsonb
output_schema          jsonb

source_sha256          char(64)
runtime_sha256         char(64)
contract_sha256        char(64)

typescript_version     varchar   -- 真实身份,含 patch(如 7.0.2+effect-tsgo.0.36.4)
esbuild_version        varchar
formula_abi_version    varchar   -- SDK 导出的显式 FORMULA_ABI_VERSION,协议变更才递增
formula_runtime_sha256 char(64)  -- 打进 artifact 的 SDK runtime 内容 hash
quickjs_engine_version varchar

tests                  jsonb
test_report            jsonb

published_by           uuid
published_at           timestamptz
```

唯一约束：

```text
(tenant_id, function_id, version_no)
```

Published Version 永远不 UPDATE、不 DELETE。

函数被 archive 只是从新建题目的选择列表隐藏，历史版本继续存在。

不存在：

```text
functionVersion = latest
```

题目只能引用确切 UUID。

---

# 15. Publish 流程

发布不要在长 DB transaction 内运行编译器。

流程：

```text
读取 draft source + draftRevision
        │
        ▼
TS7 typecheck
        │
        ▼
esbuild
        │
        ▼
Sandbox 加载 artifact
        │
        ├─ 提取 input/output JSON Schema
        │
        └─ 执行测试
        ▼
Qualy profile 验证
        │
        ▼
计算 hashes
        │
        ▼
短事务：
重新锁 function row
确认 draftRevision 未变化
生成 version_no
INSERT formula_version
```

如果编译期间另一页面改了 draft：

```text
draftRevision changed
```

发布失败，要求重新检查，不能发布一份已经不是当前草稿的代码。

每个 Formula 发布至少要求一条 test。Tests：

```ts
{
  name: string
  input: JsonValue
  expected: JsonValue
}
```

测试 input 先按 Input Schema 验证，expected 按 Output Schema验证，再执行 QuickJS，结果用 canonical output 比较。

---

# 16. `@qualy/plugin-sandbox` 和 Formula Artifact 的交界

Formula 插件生成的 bundle 可以固定导出两个全局 entrypoint：

```text
__qualyContract
__qualyInvoke
```

`__qualyContract()` 返回：

```json
{
  "input": { "...": "JSON Schema" },
  "output": { "...": "JSON Schema" }
}
```

`__qualyInvoke(inputJson)`：

```text
JSON.parse
→ 按 Schema decode Formula runtime values
→ formula.run(input,q)
→ encode Formula runtime value
→ JSON.stringify
```

Sandbox 不知道这些名字是什么意思，它只是按 Formula 插件要求调用字符串 entrypoint。

运行时正式计分前，Host 仍然按冻结的 input_schema 再验证一次输入；QuickJS 输出后 Host 再按 output_schema 验证一次。

因此完整安全边界：

```text
Recognition + constants
        │
        ▼
host input schema validate
        │
        ▼
QuickJS runtime decode
        │
        ▼
formula.run()
        │
        ▼
runtime encode
        │
        ▼
host output schema validate
        │
        ▼
Decimal → bigint
```

TS 类型系统永远不是安全边界。

---

# 17. Assessment Core：CalculatorDriver 要重新定义

当前：

```ts
amountOf(
  config,
  { payload: unknown }
): bigint
```

已经不够用了。

目标模型应当变成“Calculator 给出自己的输入合同，然后接受已经按合同组装好的 typed JSON”。

概念接口：

```ts
interface CalculatorDriver {
  readonly kind: 'calculator'
  readonly ref: string
  readonly configSchema: Schema.Top

  readonly contract: (
    config: unknown,
  ) => Effect.Effect<CalculatorContract, CalculatorContractError, CalculatorEnvironment>

  readonly evaluate: (
    config: unknown,
    input: JsonValue,
  ) => Effect.Effect<string, CalculatorEvaluationError, CalculatorEnvironment>
}

interface CalculatorContract {
  readonly inputSchema: QualyInputSchema
  readonly outputSchema: QualyDecimalSchema
  readonly contractHash: string
}
```

`contract()` 允许 Effect，是因为 `formula@1` 需要根据 `functionVersionId` 查询 Formula Version。

Builtin fixed 可以立即：

```text
Input {}
Output Decimal
```

现有 `fixed@1` 继续存在，不需要推翻。

以后加入：

```text
identity@1
lookup@1
```

也使用同一 typed binding machinery。

Formula 插件贡献：

```text
formula@1
```

其 config：

```json
{
  "functionVersionId": "..."
}
```

Formula driver 读取发布版本的 input/output schema，evaluate 时交给 Sandbox。

---

# 18. ItemTypeDriver 增加“可绑定字段合同”

Core 不能开始理解 Evidence 的：

```text
text
choice
integer
```

当前 `ItemTypeDriver` 的好边界必须保留。

新增：

```ts
interface BindableField {
  readonly fieldId: string
  readonly schema: QualyAtomicSchema
}

interface ItemTypeDriver {
  ...

  readonly bindableFields?: (
    config: unknown,
    batch: BatchContext,
  ) => readonly BindableField[]
}
```

Evidence 自己负责：

```text
number field
→ integer/decimal JSON Schema

choice field
→ enum JSON Schema

text field
→ string JSON Schema
```

附件直接不出现在 `bindableFields()` 中。

`decodePayload()` 仍保留，因为 JSON Schema 无法检查附件真实存在、日期与 Batch materialRange 的关系等外部业务上下文。

---

# 19. ItemRevision：新增 server-generated `scoring_plan`

现有 `assessment_item_revisions` 已经天然是不可变配置版本，继续保留：

```text
form_config
scoring_config
review_policy
display_config
```

建议新增：

```text
scoring_plan jsonb NOT NULL
```

`scoring_config` 是管理员真正编辑的配置。

`scoring_plan` 是服务器保存 ItemRevision 时编译出来的 immutable execution plan，客户端永远不能提交/覆盖。

这样不需要运行时每次重新做类型推理。

Authoring `scoringConfig` 建议：

```ts
{
  version: 2,

  calculator: {
    ref: 'formula@1',
    config: {
      functionVersionId: '...',
    },
  },

  recognitions: {
    'recognition-uuid-A': {
      key: 'awardLevel',
      label: '认定赛事级别',
      refinement: null,
      defaultFromFieldId: 'claimed-level',
    },

    'recognition-uuid-B': {
      key: 'awardOrdinal',
      label: '认定获奖序位',
      refinement: null,
      defaultFromFieldId: 'claimed-ordinal',
    }
  },

  bindings: {
    level: {
      kind: 'recognition',
      recognitionId: 'recognition-uuid-A',
    },

    ordinal: {
      kind: 'recognition',
      recognitionId: 'recognition-uuid-B',
    },

    base: {
      kind: 'constant',
      value: '3.00',
    },

    step: {
      kind: 'constant',
      value: '0.20',
    },

    floor: {
      kind: 'constant',
      value: '0.00',
    }
  },

  aggregator: {
    ref: 'sum@1',
    config: {},
  }
}
```

Recognition 有自己的稳定 ID 和业务 label，但**没有一份独立的基础类型**。

其基础类型直接来自它绑定的函数参数。

题目只允许进一步收窄：

```text
Formula ordinal:
integer >= 0

本题 Recognition:
integer >= 10
```

---

# 20. Item `scoring_plan` 编译

保存 ItemRevision 时执行：

```text
取得 calculator contract
        │
        ▼
检查所有 required parameter 恰好绑定一次
        │
        ├─ constant → 直接按 parameter schema 校验
        │
        └─ recognition
             │
             ├─ 构建 recognition effective schema
             ├─ 证明 Recognition ⊆ Formula parameter
             └─ 如有 default field
                    证明 Evidence ⊆ Recognition
        ▼
生成 converter plan
        ▼
校验 output = score decimal
        ▼
校验 aggregator
        ▼
生成 immutable scoring_plan
```

Compiled plan 概念：

```ts
{
  version: 1,

  calculator: {
    ref: 'formula@1',
    config: { functionVersionId: '...' },

    contractHash: '...',
    runtimeRef: {
      kind: 'formula-version',
      id: '...',
      artifactHash: '...',
    },
  },

  parameters: {
    level: {
      kind: 'recognition',
      recognitionId: '...',
      assignment: { kind: 'direct' },
    },

    ordinal: {
      kind: 'recognition',
      recognitionId: '...',
      assignment: { kind: 'direct' },
    },

    base: {
      kind: 'constant',
      value: '3.00',
    }
  },

  recognitionSchemas: {
    '...': { "...": "normalized schema" }
  },

  defaultBindings: {
    '...': {
      fieldId: 'claimed-level',
      assignment: { kind: 'direct' }
    }
  },

  aggregator: {
    ref: 'sum@1',
    config: {}
  },

  planHash: '...'
}
```

Item config runtime 只消费这个 plan。

---

# 21. Recognition 数据表

新增 `entry_recognitions`。

建议字段：

```text
id                  uuid PK
tenant_id           uuid
batch_id            uuid

entry_id            uuid
entry_revision_id   uuid

item_id             uuid
item_revision_id    uuid

values              jsonb

source              varchar
                    review | record | import | system

review_instance_id  uuid nullable
review_event_id     uuid nullable

supersedes_id       uuid nullable

created_by          uuid nullable
created_at          timestamptz
```

`values` 用 Recognition 稳定 ID 做 key：

```json
{
  "recognition-uuid-A": "provincial",
  "recognition-uuid-B": 2,
  "recognition-uuid-C": "team"
}
```

不要保存成：

```json
{
  "level": "provincial",
  "ordinal": 2,
  "projectType": "team"
}
```

因为这些只是某一函数版本的参数名。

数据库要建立 `(tenant_id, entry_id, id)` unique，方便 Entry 的 `current_recognition_id` 通过 composite FK 保证 Recognition 真属于自己。

---

# 22. `entries` 修改

新增：

```text
current_recognition_id uuid nullable
```

terminal approve 时指向当前有效 Recognition。

不要规定“非 approved 必须 NULL”，因为 reopen/appeal 进行期间可能仍需保留此前有效认定作为历史/current reference。至少保证：

> 新产生的 approved Entry 必须拥有 currentRecognition。

当前 scorer 仍然根据 Entry status 判断是否参与实时分数，所以一个被最终 reject 的 Entry 即使仍保留旧 recognition pointer，也不会继续作为 approved fact 进入 ledger。

---

# 23. ReviewInstance 修改

新增：

```text
recognition_revision_id uuid
```

现有 `policy_revision_id` 明确表示“这一轮走哪一版 Review Policy”，而 judged `revision_id` 表示“审的是哪一版学生材料”。两者已经是不同事实。

Recognition 也需要明确冻结：

```text
revision_id
    这轮审哪份 EntryRevision

policy_revision_id
    这轮按哪版审核流程

recognition_revision_id
    这轮按哪版认定/计分合同
```

不要把三者偷懒合并。

Round 一旦创建，认定字段在整个 round 内冻结，不因管理员中途保存 ItemRevision 而突然变化。

---

# 24. ReviewEvent 修改

新增：

```text
recognition_payload jsonb nullable
recognition_reason  text nullable
recognition_hash    char(64) nullable
```

当前 ReviewEvent 本来就是“一轮审核中实际发生了什么”的 append-only 权威记录，因此放这里最合适。

审核员作出 `approve` 时，必须提交完整 Recognition snapshot。

如果当前题没有任何 Recognition 字段，服务器写 `{}`。

Reject 不要求完整认定。

Escalate 不要求完整认定，因为“我无法确定”本来就是合法提审原因。

当 reviewer 修改了上一节点传下来的 Recognition 值，要求填写 `recognitionReason`。如果完全没改，则无需填写。

---

# 25. 多级审核的默认值传递

第一审核阶段：

```text
Evidence default bindings
        ↓
Recognition draft
```

例如学生填：

```text
申报级别：national
申报序位：2
项目形式：team
```

审核 UI 初始：

```text
认定赛事级别：国家级
认定获奖序位：2
认定项目形式：集体
```

第一审核员改成省部级并 approve，ReviewEvent 保存：

```json
{
  "level-recognition-id": "provincial",
  "ordinal-recognition-id": 2,
  "project-recognition-id": "team"
}
```

第二审核阶段的初始值来自上一阶段 approve snapshot：

```text
上一阶段 Recognition
        ↓
下一阶段 Recognition draft
```

绝不能重新从学生 Evidence 初始化，否则上一级审核修正会消失。

---

# 26. terminal approve

终局 approve 事务内：

```text
锁 Batch
锁 ReviewInstance
确认 reviewer 有权
验证 recognition payload
写 ReviewEvent
完成 ReviewInstance
创建 EntryRecognition
更新 Entry.currentRecognitionId
更新 Entry.status = approved
```

如果 Entry 已经有 Recognition：

```text
newRecognition.supersedesId = oldRecognition.id
```

永远不 UPDATE 旧 Recognition。

这使 reopen/appeal 后可以清楚解释：

```text
Recognition #1
国家级 / 2 / 集体

↓

Recognition #2
省部级 / 2 / 集体
```

---

# 27. Panel 必须投票于同一份 Recognition

当前 review engine 已经有 `review_panels`、seat assignments 和 immutable `review_votes`。

绝不能允许三位 reviewer 分别 approve：

```text
A：国家级 / 2
B：省部级 / 2
C：国家级 / 3
```

然后 Qualy 自己合并。

建议给 `review_panels` 增加 projection 字段：

```text
recognition_payload      jsonb nullable
recognition_hash         char(64) nullable
recognition_locked_at    timestamptz nullable
```

Proposal 每次修改都同时写一个 ReviewEvent，panel row 只是当前 projection。

第一张 vote 落库的事务里：

```text
lock panel
确认 recognition proposal 完整合法

if recognition_locked_at IS NULL:
    freeze recognition_payload/hash
    recognition_locked_at = now()

写 vote
```

第一票后禁止修改 proposal。

建议 `review_votes` 再增加：

```text
recognition_hash char(64)
```

每张票明确说明“我投的是哪一份认定”。

Panel resolve approve 时，以 locked proposal 创建 stage ReviewEvent；若该 stage 是 terminal，再创建 EntryRecognition。

---

# 28. 行政认定

现有 record 创建即 approved，不建 ReviewInstance。这个语义继续保留。

以后行政认定页面同时填写：

```text
Evidence/依据
+
Recognition
```

一个事务内创建：

```text
Entry
EntryRevision
EntryRecognition
Entry.status = approved
Entry.currentRecognitionId
```

Formula 不区分它来自审核还是行政认定。

---

# 29. Evidence 插件扩展

当前 Evidence 只有 `text/date/attachment`。下一阶段先补：

```text
text 增强
integer
decimal
choice
```

然后再考虑：

```text
choice+other
multi-choice
ordered-text-list
```

但只有可作为计分参数的 atomic fields 才进入 `bindableFields()`。

例如：

```ts
{
  id: 'claimed-ordinal',
  type: 'integer',
  min: 1
}
```

输出：

```json
{
  "type": "integer",
  "minimum": 1,
  "maximum": 9007199254740991
}
```

Choice 输出 enum。

Attachment 永远不是 Formula bindable field。

学生浏览器表单应逐步使用 Evidence driver 生成的 JSON Schema 做值校验；后端再验证同一 contract。附件真实存在、日期与 batch materialRange 的关系等 contextual validation 继续由 ItemTypeDriver 执行。

---

# 30. Scorer 必须拆成“求值”和“记账”两步

当前 `calcParticipant()` 的最大价值就是纯：没有 DB、没有 Clock、没有 float、自己做稳定排序。

不要把它改成到处 `yield* Sandbox.run()`。

应该变成：

```text
collect scoring facts
        │
        ▼
evaluate entry amounts
  Effectful / Formula / QuickJS
        │
        ▼
pure ledger
  Aggregator / group / breakdown
```

新增类似：

```ts
interface EvaluatedEntry {
  entryId: string
  revisionId: string
  recognitionId: string
  itemId: string

  amount: bigint

  calculatorRef: string
  functionVersionId?: string
  functionArtifactHash?: string
}
```

Effectful evaluator 负责：

```text
EntryRecognition
+ ItemRevision.scoringPlan
        ↓
build formula input
        ↓
apply recorded converters
        ↓
input validate
        ↓
calculator.evaluate
        ↓
output validate
        ↓
decimal → 1e-4 bigint
```

然后纯 scorer 继续：

```text
Aggregator
→ quantize line
→ group cap/floor
→ Breakdown
```

Breakdown provenance 增：

```text
entryRecognitionId
functionVersionId
functionArtifactHash
```

最终一行成绩可以完整回答：

> 这份学生材料 → 哪一轮审核认定 → 哪一版公式 → 多少分。

---

# 31. 竞赛题完整业务例子

现在用真正的竞赛题验证整个模型。

管理员发布一个通用函数：

```ts
import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice({
      national: '国家级',
      provincial: '省部级',
      city: '市级',
    }),

    ordinal: Schema.integer({
      minimum: 1,
    }),

    projectType: Schema.choice({
      individual: '个人',
      team: '集体',
    }),

    nationalBase: Schema.decimal({ maxScale: 4 }),
    provincialBase: Schema.decimal({ maxScale: 4 }),
    cityBase: Schema.decimal({ maxScale: 4 }),

    individualStep: Schema.decimal({ maxScale: 4 }),
    teamFactor: Schema.decimal({ maxScale: 4 }),
    teamStep: Schema.decimal({ maxScale: 4 }),
    floor: Schema.decimal({ maxScale: 4 }),
  }),

  output: Schema.decimal({
    maxScale: 4,
  }),

  run(input, q) {
    const base =
      input.level === 'national'
        ? input.nationalBase
        : input.level === 'provincial'
          ? input.provincialBase
          : input.cityBase

    const first = input.projectType === 'team' ? q.decimal.mul(base, input.teamFactor) : base

    const step = input.projectType === 'team' ? input.teamStep : input.individualStep

    const decline = q.decimal.mulInteger(step, input.ordinal - 1)

    return q.decimal.max(q.decimal.sub(first, decline), input.floor)
  },
})
```

这段函数没有任何“软件学院”“竞赛”等硬编码系统类型。它只是参数 → 分数。

管理员配置题目学生字段：

```text
赛事名称
届次
申报赛事级别
获奖名称
申报获奖序位
项目形式
赛事章程
获奖证明
```

然后选择这个函数版本并绑定：

```text
level
→ Recognition「认定赛事级别」
→ defaultFrom「申报赛事级别」

ordinal
→ Recognition「认定获奖序位」
→ defaultFrom「申报获奖序位」

projectType
→ Recognition「认定项目形式」
→ defaultFrom「项目形式」

nationalBase
→ constant 3.00

provincialBase
→ constant 2.00

cityBase
→ constant 1.00

individualStep
→ constant 0.20

teamFactor
→ constant 0.50

teamStep
→ constant 0.10

floor
→ constant 0.00
```

学生填写：

```text
国家级
一等奖
申报序位 2
集体
```

审核员查看章程后认定：

```text
省部级
序位 2
集体
```

最终 Formula Input：

```json
{
  "level": "provincial",
  "ordinal": 2,
  "projectType": "team",

  "nationalBase": "3.00",
  "provincialBase": "2.00",
  "cityBase": "1.00",

  "individualStep": "0.20",
  "teamFactor": "0.50",
  "teamStep": "0.10",
  "floor": "0.00"
}
```

公式精确算：

```text
2.00 × 0.50 = 1.00

1.00 - 0.10 × (2 - 1)
= 0.90
```

返回：

```json
"0.90"
```

再进入现有 Aggregator/ScoreGroup。

整个 Core 从头到尾都不知道这叫“竞赛”。

---

# 32. 函数调用函数暂缓，但接口必须允许以后扩展

第一版不要实现：

```ts
q.call(...)
```

QuickJS 内部也绝不暴露 FunctionRegistry。

如果以后确实出现大量公式重复某个子运算，再做静态 composition：

```text
Function A output
       │
       │ assignmentPlan
       ▼
Function B parameter
```

引用确切 FunctionVersion，不允许 latest。

Composition 由 Host 调度，各 Formula 仍然只看到自己的 typed input。

第一版 Formula Version 可跨多个题目复用，题目又能预绑定常量，这已经解决了绝大多数复用问题。不要提前造函数工作流系统。

---

# 33. Formula Function 的版本与哈希

至少冻结三个 hash：

```text
source_sha256
    用户保存的 TS 源码

contract_sha256
    normalized input/output schema

runtime_sha256
    真正送给 QuickJS 的 bundle
```

此外记录：

```text
typescript_version(真实身份,含 effect-tsgo patch 后缀)
esbuild_version
formula_abi_version(SDK 导出的显式 FORMULA_ABI_VERSION)
formula_runtime_sha256(打进 artifact 的 SDK runtime 内容 hash)
quickjs_engine_version
```

QuickJS package 版本必须在 catalog 精确 pin。升级 QuickJS 是评分运行环境变化，必须先跑历史 Formula fixture replay，再允许升级。

quickjs-emscripten 当前 release-sync variant 使用固定 vendored QuickJS engine，本身也建议针对不受信任代码设置 runtime 资源限制。([NPM][7])

---

# 34. 错误分类

不要一个 `FormulaError` 包打天下。

至少区分：

```text
FormulaSourceTooLarge
FormulaTypecheckFailed
FormulaBundleFailed
FormulaContractInvalid
FormulaTestFailed

FormulaInputInvalid
FormulaOutputInvalid
FormulaRuntimeFailed

SandboxTimeout
SandboxMemoryExceeded
SandboxStackExceeded
SandboxOutputTooLarge
SandboxWorkerLost

ScoringBindingInvalid
ScoringFieldIncompatible
ScoringConstantInvalid
ScoringRecognitionIncomplete
ScoringPlanStale
```

错误给管理员时必须能定位：

```text
题目
参数
函数版本
Entry/participant（运行期）
```

但 Sandbox 日志本身不要随意记录完整学生 input，避免把隐私材料写日志。

---

# 35. ItemRevision 改配置的兼容检查

现有系统保存新 ItemRevision 时已经会检查 live Entry payload 是否仍能消费。以后必须扩成：

```text
Evidence compatibility
+
Recognition compatibility
```

例如旧函数：

```text
awardOrdinal: integer >= 1
```

新函数改成：

```text
award: choice(first, second, third)
```

已有 500 条 Recognition：

```json
{
  "awardOrdinalRecognitionId": 4
}
```

新配置无法给函数供值，那么保存直接失败。

不要：

```text
自动把 4 转成 "fourth"
```

也不要允许保存后等待 ScoreRun 爆炸。

管理员要么保持兼容，要么作废替换/重新审核。

---

# 36. 现有 fixed 数据迁移

当前 Calculator 主要是 `fixed@1`，因此迁移非常容易。

旧题编译出的 Recognition Schema 是空：

```json
{}
```

已 approved Entry 可以生成：

```json
EntryRecognition.values = {}
```

其分值仍由：

```text
fixed@1 config.value
```

给出。

因此 Recognition 切换后，现有分数必须逐字节不变。

这是非常重要的迁移验收门禁。

---

# 37. 测试重点

这部分测试的价值高于普通 CRUD 覆盖。

`@qualy/value-schema` 必须重点做：

```text
integer interval containment
decimal exact range containment
choice subset
text length
pattern conservative rejection
integer → decimal converter

canonical schema hash stability
annotation does not alter semantic hash
```

Formula SDK：

```text
Input Schema → input TS inference
choice → literal union
wrong property → TS7 error
wrong return type → TS7 error

Decimal cannot use normal numeric operators
```

Sandbox：

```text
infinite loop timeout
recursive stack overflow
memory bomb
huge output
Date unavailable
Math.random unavailable
process/fetch/require unavailable
global state cannot cross executions

release QuickJS
debug QuickJS
两种 variant 都跑 escape/leak suite
```

Formula publish：

```text
source → TS7 → bundle → contract
same source/toolchain → identical artifact/hash
invalid contract refused
failing test cannot publish
draft changed during compile cannot publish stale version
```

Assessment：

```text
Evidence ⊆ Recognition ⊆ Formula
前端允许/禁用与后端结果一致

terminal approve creates Recognition atomically
reopen creates superseding Recognition
record directly creates Recognition

panel votes same recognition hash
first vote locks proposal

fixed old result identical
formula result exact
```

Scorer：

```text
Formula evaluation 有 Effect
纯 ledger 没 Effect
```

这个边界应有架构门禁。

---

# 38. 施工顺序

Claude Code 不得一次性把这整份设计全部写完。按下列顺序，每一阶段独立验收、更新 STATUS、提交。

### 第一阶段：`@qualy/value-schema`

只做 JSON Schema profile、Ajv、Decimal contract、canonicalization、`assignmentPlan()` 和测试。

不改 Review，不做 UI，不做 Sandbox。

### 第二阶段：Formula SDK + TS7 spike

创建 `@qualy/formula`，证明：

```text
Schema
→ TS7 inference
→ defineFormula
→ strict typecheck
```

并实际验证 workspace TypeScript 7.0.2 的 CLI 与 native LSP。

这一步失败就停，不继续造 Formula Plugin。

### 第三阶段：Sandbox

创建 `@qualy/plugin-sandbox`，QuickJS 0.32.0、Worker pool、fresh runtime/context、限额、determinism、escape tests。

它仍然不知道 Formula。

### 第四阶段：Formula Plugin 独立闭环(已裁决拆为 4a/4b)

4a:函数/版本表、最小源码编辑页、TS7 typecheck(服务端完整诊断回显)、esbuild、
Sandbox contract extraction、tests、publish;4b:Monaco + native TS7 LSP + WebSocket bridge,
独立施工、实施前另做 spike,不是发布安全门禁。

先用：

```text
f(value) = value
```

等极简单函数验收。

此阶段仍然不接 Assessment Item。

### 第五阶段：Recognition + typed scoring plan

修改 assessment core：

```text
EntryRecognition
review snapshots
calculator contract
ItemRevision.scoring_plan
```

先迁移现有 fixed 题，保证所有现有成绩不变。

### 第六阶段：Evidence P0

增加：

```text
integer
decimal
choice
text enhancements
```

并生成 bindable JSON Schema。

真正实现管理端：

```text
Evidence ⊆ Recognition ⊆ Formula
```

前后端严格一致。

### 第七阶段：Formula Calculator + 真实竞赛题

注册：

```text
formula@1
```

接 scoring evaluator。

配置真实专业竞赛规则跑完整：

```text
填报
→ 审核认定
→ Formula
→ Aggregator
→ Breakdown
```

这一步完成后不要继续造更多 Formula 功能，回到正式 ScoreRun/Publication 主线。

---

# 39. 明确禁止的实现

Claude Code 如果准备做以下事情，必须停止：

- 在 assessment core 写 `if item is competition`。
- 给竞赛单独做 `competition@1` calculator。
- Formula 直接读取 EntryRevision、附件、学生、Batch、数据库。
- QuickJS 暴露网络、文件系统、Clock、Random。
- Formula runtime 引入 Effect。
- Formula SDK 引入任何第三方运行时依赖(TypeBox 已裁决不用);用户 import `@qualy/formula` 之外的任何模块。
- Formula Input 支持任意 JSON Schema。
- Evidence 字段不兼容却允许“到时候实际值校验”。
- 自动 text→integer 等弱转换。
- 运行时重新推导应该在 ItemRevision 保存时完成的绑定。
- Formula 通过 `latest` 调其他函数。
- Panel reviewer 对不同 Recognition 各自投票后由系统合并。
- 改写旧 EntryRecognition。
- 把 QuickJS 调用塞进当前纯 `calcParticipant()` 内部。
- 为了 Formula 顺便重构已经封板的 UI/audit/telemetry/supervisor 基础设施。

---

# 40. 完成标准

这套基础能力真正完成，不是“编辑器能运行一个 JS 函数”，而是以下场景全部成立：

管理员发布一个严格 typed Formula；TypeScript 编辑器能准确提示 `input` 和 `q`；后端重新 TS7 typecheck；QuickJS 沙箱安全运行；Input/Output contract 被冻结；管理员把函数绑定到一个 Evidence 题；不兼容字段前端不可选、后端也拒绝；学生提交材料；每一级 approve 明确认定参数；最终生成 immutable EntryRecognition；Formula只消费 Recognition；结果进入现有精确 scorer；成绩页能追到 EntryRevision、Recognition、Formula Version 和最终 amount；修改 Formula、参数结构或 Item 配置不能悄悄破坏已有事实；同一冻结输入在同一冻结运行环境下得到相同结果。

达到这里以后，Qualy 才真正拥有一个业务无关、严格类型、可解释、可审计、可由 AI 后续生成的计分函数系统。

---

我认为这一版已经可以作为正式施工依据。最关键的三个取舍已经固定：**Formula 环境不引入 Effect；JSON Schema 只开放可完整证明绑定安全的 Qualy 子集；QuickJS 求值与现有纯 bigint ledger 分层。** 这三条一旦守住，后面的竞赛、科研、干部、社会实践等复杂规则都只是配置和 Formula，而不会继续侵蚀 Core。

[1]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ 'https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/'
[2]: https://www.npmjs.com/package/ajv?activeTab=versions 'https://www.npmjs.com/package/ajv?activeTab=versions'
[4]: https://www.npmjs.com/package/quickjs-emscripten-core?activeTab=versions 'https://www.npmjs.com/package/quickjs-emscripten-core?activeTab=versions'
[5]: https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md 'https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md'
[6]: https://www.npmjs.com/package/esbuild?activeTab=versions 'https://www.npmjs.com/package/esbuild?activeTab=versions'
[7]: https://www.npmjs.com/package/%40jitl/quickjs-wasmfile-release-sync 'https://www.npmjs.com/package/%40jitl/quickjs-wasmfile-release-sync'

附录：如果一个业务不想让用户填写业务字段，而是由审核员填写，比如见义勇为加分、获奖序位，现在由用户填写并绑定，如果不想由用户填写，而是完全由管理员填写，并且需要在管理员的审核页面增加相应的表单（我推荐放在点击通过后打开模态框里作为必填项），且表单也需要做校验，你考虑应该怎么做。

可以，而且我认为这正好说明了为什么 Recognition 必须独立于 Evidence：**审核认定字段本来就不应该要求学生一定先填一个对应字段。**

最简单、最统一的规则应该是：函数参数如果绑定为 `recognition`，这个认定字段可以“有申报默认值”，也可以“没有申报默认值”。没有默认值时，它就是纯审核字段，由审核人在点击“通过”后填写。完全不需要再发明一套“管理员字段”或“审核表单 DSL”。

拿两个业务对比最清楚。

学生申报竞赛时，我们可能允许学生自己声明：

```text
申报赛事级别：国家级
申报获奖序位：2
```

公式要求：

```ts
level: choice(...)
ordinal: integer({ minimum: 1 })
```

题目配置就是：

```ts
recognitions: {
  awardLevel: {
    label: '认定赛事级别',
    defaultFromFieldId: 'claimed-level',
  },

  awardOrdinal: {
    label: '认定获奖序位',
    defaultFromFieldId: 'claimed-ordinal',
  },
}
```

于是首级审核打开“通过”弹窗时：

```text
认定赛事级别    [国家级 ▼]
认定获奖序位    [2        ]
```

这是学生申报值预填进去的，审核员只是确认或修改。

但如果学院不希望学生填写“获奖序位”，认为这是根据赛事章程由审核人员判断，那么学生表单可以只有：

```text
赛事名称
获奖名称
赛事章程
获奖证书
项目形式
```

函数仍然要求：

```ts
ordinal: Schema.integer({
  minimum: 1,
})
```

题目只需要这样配置：

```ts
recognitions: {
  awardOrdinal: {
    label: '认定获奖序位',
    defaultFromFieldId: null,
  },
}
```

此时学生完全不知道 `awardOrdinal` 这个字段，也不会在 `EntryRevision.payload` 里出现它。审核员点击“通过”后，弹窗出现：

```text
认定获奖序位 *
[                    ]

请输入 1 以上的整数
```

不填就不能通过。

这就是我认为应该冻结的设计。

---

## 配置模型不需要增加新的“字段来源类型”

还是原来的三种函数参数来源：

```text
constant
recognition
以后可能有 call
```

其中 `recognition` 再有一个可选的默认来源：

```ts
{
  parameter: 'ordinal',

  binding: {
    kind: 'recognition',
    recognitionId: '...',
  },

  recognition: {
    id: '...',
    key: 'awardOrdinal',
    label: '认定获奖序位',

    // 有 = 用申报值初始化
    // 无 = 审核员从空白开始填
    defaultFromFieldId: null,

    refinement: null,
  },
}
```

不要加：

```text
student-recognition
reviewer-recognition
admin-recognition
```

这几个类型。

它们本质上都是 Recognition，差别只是：

> 有没有一个 Evidence 字段可以作为它的初始值。

这样整个模型非常干净。

---

## “见义勇为加分”就是一个非常典型的 reviewer-only Recognition

例如政策规定审核人员根据事迹影响程度核定 1～6 分。

学生只提交：

```text
事迹说明
证明材料
附件
```

公式甚至可以非常简单：

```ts
export default defineFormula({
  input: Schema.input({
    score: Schema.decimal({
      minimum: '1.00',
      maximum: '6.00',
    }),
  }),

  output: Schema.decimal(),

  run(input) {
    return input.score
  },
})
```

题目绑定：

```text
score
→ Recognition「认定分值」
→ 没有 Evidence 默认字段
```

学生提交时根本没有“我认为自己应该加几分”这个字段。

审核员阅读材料，点击：

```text
通过
```

再打开：

```text
确认通过

认定分值 *
[ 3.00 ]

认定说明
[                            ]

取消                 确认通过
```

服务器只接受 `1.00 ~ 6.00` 的合法 Decimal。

这其实比“让学生先填 3 分，再让老师审核 3 分”业务上更合理。

---

# 审核 UI 我赞成放在“点击通过以后”的 Modal

我甚至认为不应该长期把 Recognition 表单一直摆在审核详情页里。

审核页面主要职责还是：

```text
看材料
看历史
看附件
看其他申报
作判断
```

Recognition 是“我要批准这份材料时，正式确认哪些计分事实”。

所以交互应该是：

```text
审核详情
          ↓
点击「通过」
          ↓
ApproveDecisionModal
          ↓
填写 / 确认 Recognition
          ↓
确认通过
```

如果该题完全没有 Recognition 参数，例如固定 +1 分：

```text
recognitionSchemas = {}
```

则不用多弹一层复杂表单，可以继续现有轻量通过体验。

但只要有 Recognition 字段，我建议**每一级 approve 都必须打开确认 Modal**，即使字段已经全部有默认值。

因为：

> “默认值正确”不等于“审核员正式认定过”。

---

# Modal 的值从哪里初始化

这个逻辑也可以非常明确。

假设当前有三个认定字段：

```text
level
ordinal
projectType
```

进入某一审核节点时，Qualy 先找上一审核节点已经 approve 的 Recognition snapshot。

如果有：

```text
上一审核节点
        ↓
当前 Modal 初始值
```

例如上级已经认定：

```json
{
  "level": "provincial",
  "ordinal": 2,
  "projectType": "team"
}
```

那么下一级打开通过弹窗直接看到这三个值。

如果这是第一个审核节点，没有上一级 Recognition，则逐字段初始化：

```text
有 defaultFromFieldId
→ 从 EntryRevision Evidence 取得

没有 defaultFromFieldId
→ 空
```

例如：

```text
level
defaultFrom = 学生申报级别
→ 国家级

projectType
defaultFrom = 学生项目形式
→ 集体

ordinal
defaultFrom = null
→ 空
```

弹窗就是：

```text
认定赛事级别 *
[国家级 ▼]

认定获奖序位 *
[          ]

认定项目形式 *
[集体 ▼]
```

非常符合真实审核工作。

---

# 关键是：Modal 不是自己定义表单类型

不能再写：

```tsx
if (recognition.type === 'number') ...
```

然后维护第二套校验。

它直接使用 `scoring_plan.recognitionSchemas`。

例如 `ordinal` 对应：

```json
{
  "type": "integer",
  "minimum": 1,
  "maximum": 9007199254740991
}
```

前端 Recognition renderer 看到这个 Schema，就渲染整数输入框。

Choice：

```json
{
  "type": "string",
  "enum": ["national", "provincial", "city"],
  "x-qualy-enumLabels": {
    "national": "国家级",
    "provincial": "省部级",
    "city": "市级"
  }
}
```

就渲染 Select。

Decimal：

```json
{
  "type": "string",
  "format": "qualy-decimal",
  "x-qualy-minimum": "1.00",
  "x-qualy-maximum": "6.00"
}
```

渲染 DecimalInput。

也就是说 Formula 参数 Schema 同时控制：

```text
题目绑定是否合法
审核 Modal 长什么样
审核值是否合法
最终 Formula 能否接受
```

还是同一份类型事实。

---

# 这又引出一个应该加入设计文档的重要约束

不是所有 Formula 参数 Schema 都一定适合人工填写。

所以未来哪怕 Formula 类型系统扩展了 array/object 等复杂类型，也应该明确区分：

```text
Formula 可接受的 Schema
```

和：

```text
Recognition UI 可人工编辑的 Schema
```

第一版因为 Formula 本来就只允许扁平 atomic 参数，所以二者完全相同。

但代码层最好现在就有：

```ts
isRecognitionInputSchema(schema)
```

或者类似能力。

管理员选择：

```text
parameter source = recognition
```

时必须保证这个 parameter Schema 存在对应的 UI renderer。

没有 renderer 就不能设成 Recognition。

它仍然可能以后：

```text
来自 constant
来自另一个 function
```

但不能要求人手填一个前端根本不会显示的结构。

---

# 前端校验要做到三层

第一层是控件自己，例如整数输入框不允许正常输入 `abc`。

第二层是共享 JSON Schema validator。点击“确认通过”时，把整个 Recognition object：

```json
{
  "recognition-id-a": "provincial",
  "recognition-id-b": 2,
  "recognition-id-c": "team"
}
```

按当前 ReviewInstance 冻结的 Recognition contract 验证。

第三层是后端。请求到达 `decideReview()` 后重新根据 `recognition_revision_id` 加载冻结的 ItemRevision/scoring plan，再做同样验证。

所以即使有人绕过浏览器直接 POST：

```json
{
  "ordinal": -50
}
```

也过不了。

当前 ReviewInstance 已经分别冻结“审哪份 EntryRevision”和“使用哪版 review policy”，Recognition 继续冻结独立的 revision 是必要的，不能审核中途因为管理员改题而改变这个弹窗。

---

# API 我建议这样变化

当前 decision input 概念上是：

```ts
{
  decision,
  reason,
  comment,
  suggestedPayload,
}
```

新增：

```ts
{
  decision,
  reason,
  comment,
  suggestedPayload,

  recognition?: {
    values: Record<string, JsonValue>,
    reason?: string,
  }
}
```

服务器规则：

```text
decision = approve
并且题目存在 recognition fields
→ recognition 必须存在
→ 必须字段完整
→ 不允许多字段
→ 每个 value 必须通过对应 Schema

decision = reject
→ recognition 不需要

decision = escalate
→ recognition 不需要
```

如果没有 Recognition 字段：

```json
recognition.values = {}
```

服务器内部可以统一成空 object，但客户端不必提交。

---

# 不建议只在“最终审核人”那里填写

这个问题我重新考虑后，还是建议：

> **每一个作出 approve 的审核节点，都必须确认完整 Recognition。**

例如：

```text
学生申报
国家级

班级审核
认定国家级

学院审核
改成省部级

最终审核
确认省部级
```

这才真正能够回答：

> 哪一级改了认定？

如果只让最终审核员填，前面的“通过”其实只是：

> 材料大概没问题。

而不是正式审核判断。

你的审核系统已经很重视每一级判断的历史，所以 Recognition 也应保持同样精度。

当然 reviewer-only 字段第一次是空的，第一层真正填写；后续层级只是确认/修改。

---

# 什么时候要求“认定说明”

我建议不要无脑所有情况必填。

规则可以是：

**从空白填写 reviewer-only 字段，不要求说明。** 这是审核员本来的工作。

**完全接受上一层值，不要求说明。**

但发生以下情况时要求说明：

```text
第一审核节点：
学生 Evidence 默认值
        ↓
被改成别的 Recognition

后续审核节点：
上一节点 Recognition
        ↓
被修改
```

例如学生申报：

```text
国家级
```

审核员改成：

```text
省部级
```

这时候 Modal 增加：

```text
认定说明 *
[经赛事章程核对，主办单位为……]
```

后面别人打开历史就很清楚。

如果只是 reviewer-only：

```text
认定获奖序位
空 → 2
```

不算“修正”，无需强制解释。

---

# ReviewEvent 应保存完整 snapshot，不保存 diff

例如当前审核人确认：

```json
{
  "award-level": "provincial",
  "award-ordinal": 2,
  "project-type": "team"
}
```

ReviewEvent 就保存完整 object。

不要只存：

```json
{
  "award-level": "provincial"
}
```

这种 diff。

完整 snapshot 很小，却可以让任何历史节点独立解释，不需要把之前十个 Event fold 一遍才能知道“当时认定是什么”。

这也与 ReviewEvent 当前作为 append-only 正式审核轨迹的职责一致。

---

# Panel 模式也能自然兼容

Panel 审核时稍微特殊。

我仍然建议 panel 是：

> 多个人对同一份 Recognition proposal 投票。

如果 panel 第一次进入时还有 reviewer-only 空字段，第一位准备 approve 的 reviewer 点击通过时先填写完整 Recognition proposal：

```text
认定赛事级别：省部级
认定获奖序位：2
```

提交第一票的同时把 proposal 锁住。

其他 panel reviewer 再点击通过时，Modal 仍然展示：

```text
认定赛事级别：省部级
认定获奖序位：2
```

但是作为只读确认。

他们不能各填一套值。

否则三个人投票的是三个不同事实，quorum 就失去意义。

如果有人不同意认定内容，他应该 `reject`/不赞成当前 proposal，而不是偷偷把自己的 ordinal 改成 3 再 approve。

---

# 行政认定页面也直接复用同一 RecognitionForm

这也是这个设计最大的好处之一。

对于 `entrySource = administrative`：

工作人员创建记录时页面可以是：

```text
材料依据
----------------
事迹说明
证明附件

认定结果
----------------
认定分值 *
[3.00]
```

这里不是 Modal，因为它本身就是“认定录入”页面。

但是用的组件完全相同：

```tsx
<RecognitionForm
  schema={compiledRecognitionSchema}
  values={...}
/>
```

行政录入保存时直接创建：

```text
EntryRevision
+
EntryRecognition
+
approved Entry
```

所以 student review 和 admin record 不会发展出两套表单系统。

---

## 我会把 Recognition source 最终定成这三种情况

| 函数参数配置                        | 谁提供                 | 是否产生审核字段 |
| ----------------------------------- | ---------------------- | ---------------- |
| `constant`                          | 题目管理员配置         | 否               |
| `recognition + defaultFromEvidence` | 学生先申报，审核员确认 | 是               |
| `recognition + no default`          | 完全由审核员认定       | 是               |

以后如果有真正需要的系统事实，再考虑：

```text
context/system
```

但现在没有必要。

---

因此，“获奖序位到底让不让学生填”根本不应该变成两种题型。

同一个 Formula：

```ts
ordinal: integer >= 1
```

题目 A：

```text
defaultFrom = 学生申报获奖序位
```

就是“学生申报，老师确认”。

题目 B：

```text
defaultFrom = null
```

就是“学生不填，老师判定”。

Formula、Recognition、计分流程一行代码都不需要改。

我建议把这一条补进刚才的设计文档：**Recognition 的 Evidence binding 永远是 optional seed，不是 Recognition 存在的前提；任何未提供 seed 的 Recognition 都成为 reviewer-required input，并在 approve decision modal 中完成。** 这会让整个模型覆盖实际业务的能力明显完整一截。
