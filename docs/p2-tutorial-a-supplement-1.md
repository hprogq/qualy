# 增补 01 · Sandbox 的归属：infra 化拆分

> 性质：对 `docs/assessment-design.md` v2.1 的**增补文件**，独立成篇、不改原文。
> 效力：本文 §8 逐条列出的 v2.1 语句被取代；未列出的一切照旧。
> 新增包：`@qualy/plugin-sandbox`（plugins/infra/sandbox）、`@qualy/plugin-llm`（plugins/infra/llm，薄）。
> 建议路径：`docs/assessment-addendum-01-sandbox.md`。

## 1. 结论

拆。v2.1 把 QuickJS 运行时放在 formula 插件内，混淆了两层不同性质的东西。定稿为三层：

```text
机制层  plugins/infra/sandbox        确定性 JS 执行（不知道什么是综测）
驱动层  plugins/assessment/formula   custom 计分驱动 + AI 生成流水线（知道综测，经 Sandbox 服务执行）
语义层  plugins/assessment/core      assessment.calculator 注册表、ScoreRun、Breakdown（不变）
```

类比仓库既有形态：sandbox 之于 formula，如 database 之于一切领域插件；formula 之于 `assessment.calculator`，如 auth-local 之于 `Login.driver`。三层拆分本身也是论文可写的架构论点——"沙箱是平台能力而非综测特性"直接支撑通用性叙事。

## 2. 为什么归 infra

**infra 成员资格四判据**（对照现有 database / ui-registry / web / 已排期的 storage，全部成立）：① 零业务语义；② 零自有业务数据（sandbox **没有任何表**）；③ 以"是否装配"为治理开关有独立意义；④ 存在跨领域消费的现实路径。sandbox 四条全中：

- **①②** 运行时的全部职责是"把这段 JS 在限额内确定性地跑完"，输入输出都是 JSON，见不到 batch/entry/tenant 任何概念。
- **③ 是最重的一条。** 拆成插件后，"本部署是否允许任意代码执行"成为 qualy.yml / qualy.lock.json 层面的可审计决策：不装 sandbox → 含 formula 的装配在 dependsOn 解析时**硬失败**；两者都不装 → 该能力在部署中物理不存在，且配置了 custom 计分器的题目在配置校验时按既有"硬失败不静默降级"规则报错。这正好落在 ADR-0001（禁止在线装插件）确立的"装配即信任边界"上——安全治理复用既有机制，不新造开关。
- **④** 已在路线图上的潜在消费者：evidence 的自定义校验器（超出 pattern 表达力时）、跨学期账本/月度结算的 custom aggregator 表达（v2.1 §27 已预告）、以及 Qualy 作为通用审批平台未来的路由谓词。**但注意：④ 是佐证不是主论据**——归置的正当性来自类别（①②③），不来自对未来消费者的投机。

**反方陈述与回应**：反对拆分的最强理由是"M9 只有一个消费者 + 多一个包的仪式成本"。回应：仪式成本在本仓库被 `pnpm plugin:add` 压到很低，且 sandbox 是 server-only 无 client/无 api.ts/无表的最小包；而"现在归对位置"几乎免费，"以后从 formula 里往外抠"要动依赖、动测试、动安全审计记录。归置决策与功能建设不同，不适用"由第二个需求触发"——它没有推迟收益。

**排除另外两个候选位置**：`packages/core/`（api-kit/assembly/plugin-kit）是插件系统自身的构建期/框架 kit，不是运行时能力，sandbox 放这里层级错误；`packages/contracts/` 不需要新叶子——sandbox 的服务类型是 server-only，formula 的前端只与 formula 自己的 API 对话，循 database 先例由插件包自身导出类型即可。

## 3. 精确边界：sandbox 提供什么、绝不提供什么

**服务面（概念草案；Effect 实 API 按仓库 `repos/` 同版本源码实查）**：

```ts
// @qualy/plugin-sandbox —— dependsOn: []
interface Sandbox {
  // 编译并缓存；同 hash 幂等命中
  load(js: string, hash: Sha256): Effect<CompiledHandle, SandboxError>
  // 单次确定性执行
  run(
    handle: CompiledHandle,
    input: JsonValue,
    limits?: Partial<Limits>,
  ): Effect<
    JsonValue,
    TimeoutError | MemoryError | RuntimeError | ForbiddenApiError | OutputTooLargeError
  >
}
// 插件 config（qualy.yml 可调，服务端为硬上限）：
// { defaultDeadlineMs: 25, maxDeadlineMs: 200, maxMemoryMb: 64, maxOutputKb: 256 }
```

**确定性细则（比 v2.1 §16 契约②更具体，实施以此为准）**：

- **Date 整体不可用**（不是只禁 Date.now）：no-arg 构造非确定，而"带参构造纯不纯"的甄别不值得做。材料日期以 epoch ms / ISO 字符串作为**普通数据字段**进入 input；formula 的 AI 生成提示词内建此约定（"日期一律按 input 中的字符串/数字处理"）。
- `Math.random` 抛 `ForbiddenApiError`；`Math` 其余保留。**libm 决定论由 WASM 保证**：quickjs-emscripten 是自带数学实现的固定二进制，`Math.sin` 等在任何宿主平台逐位一致——这是选它而非 isolated-vm（宿主 V8 libm 因平台而异）的决定性理由之一，也是答辩时"为什么跨平台可回放"的现成答案。
- 无 `import`/`require`/模块解析、无 timers、无 fetch/网络、无 `process`/`os`/`std`、宿主零对象注入；`globalThis` 自有属性 = ES intrinsics 白名单，白名单本身有快照测试。
- **版本升级 = 计分内核变更**：quickjs-emscripten 在 pnpm catalog 固定精确版本；升级前必须跑确定性回归对拍（历史 ScoreRun 抽样重放逐字节比对），此条写入纪律而非建议。

**刻意不存在清单**（出现即架构违规）：`api.ts`（不得把"执行任意代码"暴露成 HTTP 面）、`client/`、`db/`、`permissions.ts`、TS→JS 转译（那是授权期职责，esbuild 依赖留在 formula，安全关键包不背构建工具链）、对 tenant/batch/item 的任何感知（输入组装发生在 scoring 引擎，那里已经租户约束；sandbox 保持租户盲）。

## 4. formula 剩下什么

`@qualy/plugin-assessment-formula`，dependsOn: `assessment, sandbox, llm`。职责收敛为三块：

1. **驱动**：向 core 的 `assessment.calculator` 注册表贡献 custom 计算器与聚合器；执行时组装 input（实例配置 + 该生该题已确认 entries + 声明的外部事实快照 + run 冻结时间戳字段）→ 调 Sandbox 服务 → 校验输出 shape `{score, lines?}` 并入 Breakdown。v2.1 §16 契约六条全部沿用，其中②③的**实施主体**是 sandbox，①⑤⑥的实施主体是 formula。
2. **授权流水线**（分层生成不变）：细则文本 →（经 Llm 服务）优先产声明式配置 → 降级产 TS 纯函数 + 测试用例 → 沙箱跑测试 → 抽样试算 diff → 人工显式发布。TS→JS 转译在**发布动作**时一次性完成入库。
3. **版本数据**：`formula_versions`（tenant_id, id, ts_source, js_artifact, sha256, tests(jsonb), last_test_run(jsonb), status(draft|published), published_by/at, created_at）。item config 以 version id 引用已发布版本，天然纳入 §9 配置冻结与 BatchConfigRevision；ScoreRun input_manifest 记 sha256（v2.1 已要求，不变）。授权动作复用 `assessment.batch.manage` 权限（改计分配置与改题目同权级），不新增权限点。

## 5. 目标目录树与包内布局

```text
packages/plugins/
├── assessment/                    # M1 起新增分组
│   ├── core/  evidence/  appraisal/
│   └── formula/                   # M9：驱动 + 授权流水线（不含运行时）
├── data/                          # 新增分组
│   ├── grades/  dormitory/
└── infra/
    ├── database/  ui-registry/  web/      # 既有
    ├── storage/                   # M2
    ├── sandbox/                   # M9（零综测依赖，可提前并行）
    └── llm/                       # M9（薄，见 §7）
```

```text
plugins/infra/sandbox/                     # server-only 最小包
├── package.json                           # @qualy/plugin-sandbox；dependsOn: []
├── src/
│   ├── index.ts                           # Plugin.define：config schema + 提供 Sandbox 服务，别无其他
│   ├── service.ts                         # 服务接口 + Layer.scoped（wasm 模块加载/释放）
│   ├── context.ts                         # intrinsics 白名单、Date 移除、random 抛错、宿主零注入
│   ├── limits.ts                          # 中断句柄(deadline) / 内存上限 / 输出尺寸上限
│   ├── cache.ts                           # sha256 → 编译产物 LRU
│   └── errors.ts                          # Timeout/Memory/Runtime/ForbiddenApi/OutputTooLarge
└── tests/                                 # 确定性对拍、逃逸套件、限额、负载 yield、句柄泄漏

plugins/assessment/formula/
├── package.json                           # dependsOn: assessment, sandbox, llm
├── src/
│   ├── index.ts                           # 描述器：贡献 custom 驱动；Api.group；Ui.page
│   ├── api.ts                             # 授权端点：生成 / 测试 / 试算 / 发布
│   ├── driver.ts                          # custom calculator/aggregator（经 Sandbox 执行）
│   ├── authoring/ generate.ts | transpile.ts | tests-run.ts
│   ├── db/entities.ts                     # formula_versions
│   ├── server/ db.ts | errors.ts | index.ts
│   └── client/                            # 编辑器 / 测试面板 / 试算 diff；locales/zh-CN.ts
└── tests/
```

## 6. 工程要点

- **Layer 生命周期**：wasm 模块异步加载，走 scoped Layer（获取即加载、作用域结束 dispose）；每次 run 用独立 context，用毕即弃，杜绝跨执行状态泄漏。
- **事件循环**：quickjs-emscripten 同步执行会占住主线程。v1 策略 = 单调用中断预算（默认 25ms）+ **调用之间显式 yield**；ScoreRun 本就是后台 fiber，4000 生 × 3 题 × ~2ms ≈ 24s CPU 摊在异步任务里，服务保持响应。worker 线程池**推迟**（触发条件：实测发布流程延迟不可接受或健康探针出现可观测阻塞）。
- **依赖与上游笔记**：quickjs-emscripten 进 pnpm catalog 锁精确版本；实施中发现的 API 怪癖按仓库惯例落 `docs/upstream/quickjs-emscripten-*.md`（对齐既有 mikro-orm 系列笔记）。
- **错误分类学**：五类错误全部携带 `(codeHash, 定位信息)`；formula 在 ScoreRun 失败时补充 (item, participant, input) 上下文——确定性保证任何失败可离线复现。
- **租户盲**：sandbox 永不接触 tenantId；跨租户隔离由输入组装侧（scoring，已有租户纪律）保证。这条写进 sandbox 的 README 首行。

## 7. 顺带同理：infra/llm 薄插件

AI 调用按 §2 同一判据也属机制层：零业务语义、零自有数据、装配即治理（不装 = 部署无外呼 LLM 能力）、且**第二个消费者已在论文路线图上**（多模态材料读取、审核辅助）——现在不拆，M10 就要从 formula 里往外抠。范围刻意收窄防止膨胀：

- `@qualy/plugin-llm`（plugins/infra/llm）：单一 OpenAI 兼容端点配置（baseUrl / apiKey / model / 超时 / 重试），一个 `Llm.chat` 服务，完。**不做** provider 动物园、不做流式（实施时按 Effect HttpClient 能力实查后可选）、不做用量计费。formula 的 generate.ts 只依赖此服务，模型切换是部署配置而非代码变更。

## 8. 对主文档（v2.1）的取代条款

1. **§16 custom 条目**："在 QuickJS-WASM 沙箱内执行"的**交付主体**由 formula 插件改为 `@qualy/plugin-sandbox` 提供的服务；契约六条不变，实施主体按本文 §4.1 划分；契约②中"无 Date.now"收紧为"**Date 整体不可用**"（本文 §3）。
2. **§20 插件树与依赖表**：树按本文 §5 替换；formula 行 dependsOn 更新为 `assessment, sandbox, llm`；新增两行——`@qualy/plugin-sandbox | 确定性 JS 执行沙箱（无表、无 API、无 UI） | （无） | M9(可提前)`、`@qualy/plugin-llm | OpenAI 兼容端点接入（薄） | server | M9`。
3. **§26 M9 段**：整段由本文 §9 替换。
4. **§27 表**：新增一行推迟项——`worker 线程池执行沙箱 | 实测发布延迟不可接受或健康探针可观测阻塞`；一行——`LLM 流式输出 | 授权界面体验确有需要且 HttpClient 实查支持`。
5. 其余（§17 preflight 的 custom 检查项、§28 两条禁令、ADR 五条、`assessment.calculator` 归 core）**全部不变**。

## 9. M9 修订版：两包分交付

**排程**：sandbox 零综测依赖，M1 之后任意时点可并行先行（适合主线写累时的换脑任务）；formula 硬前置 = M4（registry 缝）+ sandbox + llm。整体建议排序不变：M5 → M9 → M6–M8。

**M9a — `@qualy/plugin-sandbox`** 交付：§3 全部。验收：
① 确定性对拍：同 (js, hash, input, 冻结时钟) 在本机与 CI Linux 两平台输出逐字节一致，用例须覆盖 libm 路径（Math.sin/pow 等）；
② 逃逸套件：快照断言 globalThis 自有属性 = 白名单；Date（含构造）、Math.random、import/require、fetch、process 等访问全部 ForbiddenApiError 或不存在；
③ 限额：`while(true)` 在 deadline 内被中断 → TimeoutError；大分配 → MemoryError；超大返回 → OutputTooLarge；三者携带 codeHash 且可离线复现；
④ 缓存：同 hash 二次 load 不重编译（计数断言）；
⑤ 负载：后台 fiber 连续执行 12000 次 ~2ms 调用期间，health 端点响应延迟不劣化超过阈值（yield 生效）；
⑥ 生命周期：测试作用域结束无 wasm 句柄泄漏（dispose 断言）。

**M9b — `@qualy/plugin-assessment-formula`（+ `@qualy/plugin-llm`）** 交付：§4 全部 + §7。验收 = v2.1 原七条按新边界重述（①执行经 Sandbox 服务、②③断言 sandbox 错误类型、⑤ custom aggregator 复刻 countTier 逐字节对拍、⑥配置冻结、⑦端到端 AI 演示），另增：
⑧ **装配治理**：qualy.yml 含 formula 但移除 sandbox → 装配失败并指明缺失依赖；两者都移除 → 装配正常，且配置了 custom 计分器的题目在配置校验硬失败（复用"不静默降级"规则）；
⑨ llm 端点不可达时：生成流程给出明确错误，**不影响**已发布 custom 版本的计分执行（执行路径不依赖 llm）。

## 10. infra 成员资格的一般规则（成文，供未来机械判定）

一个包进 `plugins/infra/` 当且仅当同时满足：**零业务语义、零自有业务数据、以装配与否作为部署级治理开关有独立意义**；"存在跨领域消费路径"为佐证加分项而非必要条件。据此：database ✓、ui-registry ✓、web ✓、storage ✓、sandbox ✓、llm ✓；formula ✗（有综测语义，归 assessment/）、grades ✗（有自有业务数据，归 data/）。归置决策不适用"复杂度由需求触发"元规则——归置没有推迟收益，功能建设才有。
