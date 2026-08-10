# 工具链审计裁决(2026-08-02)

一次外部审计建议把 scripts/ 重构为 @qualy/tooling 包(qualy CLI + AssemblyGraph +
CodegenRegistry + Vite adapter),并把迁移执行下沉到 database 插件。按 CLAUDE 元规则
(复杂度必须由已发生的问题证明其存在,外部评审意见按此过滤)与 P1 时间盒逐项裁决如下。

## 现在采纳(有真实事故/摩擦支撑)

- **迁移执行下沉 database 插件**:此前 `pnpm dev` 前置 db:migrate,但直接
  `node main.ts` 的启动路径(生产冒烟实际发生过)会绕过迁移;迁移脚本与插件各建一个
  Pool、各知一份 URL,职责割裂。现在 `runMigrations()` 归
  `@qualy/plugin-database/migrator`(零 cordis 依赖),Service.init 按
  `migrations: 'apply' | 'off'` 执行**已提交**迁移,依赖 db 的插件在迁移完成后才激活;
  `pnpm db:migrate` 是同一实现的薄适配器,留给部署 Job(mode off 时)与手动使用。
  **单实例串行执行条件下**可安全重复调用(台账检查仅数十毫秒,hmr 重载重跑无害,
  不做进程级 once-guard);rc4 migrator 无 advisory lock,多副本并发启动会竞争 DDL,
  届时必须 mode off + 独立迁移 Job,或按回顾表触发 advisory lock。
  migrationsFolder 相对路径按装配清单目录(ctx.baseUrl)解析,启动与 cwd 无关,
  仓库装配在 qualy.yml 显式声明 `../../db/migrations`。
- **codegen 自动化**:手动 `pnpm gen` 是踩过的 footgun(fresh clone CI 曾因 typecheck
  前置缺 gen 断链)。dev/typecheck/test 现在前置 gen(build 原本就有 --all),
  plugin:add 收尾自动 regen;写前比对使无变更时零写入,重复执行代价 ~1-2s。
  CI 的独立 gen 步骤随之删除(typecheck 自带)。

## 缓建(记录触发条件,条件未发生前禁止预防性重建)

| 机制                                               | 触发条件                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @qualy/tooling 包(qualy bin/CLI)                   | 第四类 codegen 能力落地(如 rbac.permissions 权限码生成)、插件出现私有 codegen 需求、或 CLI 需在本仓库之外使用                                                              |
| AssemblyGraph / CodegenRegistry(贡献-任务双层模型) | 同上——审计自己的实施顺序也把 registry 排在第四条真实能力之后                                                                                                               |
| Vite adapter / plugins.gen 虚拟模块                | 物理 gen 文件造成真实构建摩擦(如 watch 竞态、fresh clone 解析失败复发)                                                                                                     |
| gen watcher(dev 期间自动重生成)                    | 第一次要求不重启 dev 进程热启用「启动时 disabled 且贡献 contract/client」的插件;届时先评估更简单的 dev 用 gen --all(shipped 超集 + manifest 决定可见性),不一定需要 watcher |
| 迁移 mode 'verify'(校验不执行)                     | 应用容器无 DDL 权限的生产部署真实出现                                                                                                                                      |
| 插件自带 migration 序列                            | 出现需要独立发版的外部插件生态(需要版本 DAG/拓扑排序/多 ledger,见审计第七节)                                                                                               |

## 永久禁令(审计与既有纪律一致)

- 应用运行时进程禁止执行 drizzle-kit generate、禁止写 .gen.ts(生产容器可能只读;
  rename 歧义无法无人值守;生成物必须经审查提交)。
- codegen 不进 cordis core(contract/组件/schema 是 Qualy 应用约定,不是框架概念)。
- 不按 active 集合动态增删数据库对象(停用不改变 schema 聚合,不变式测试守护)。
- 共享输出文件单一 owner:插件声明贡献,聚合器拥有 contracts.gen/plugins.gen。

## TypeScript 7(2026-08-11 换装,已实测)

`pnpm typecheck` 从 ~34s 降到 ~9s(12 个 program 全量,root program 单独由 9.5s 降到 2.4s),
12 个 program 的类型判定与 6.0.3 完全一致(逐个跑过,零差异)。换装的代价与解法:

- **原生 `tsc` 没有 JS 编译器 API**。包里只剩 `lib/version.cjs` 与 `typescript/unstable/*`,
  `createProgram` / `createCompilerHost` 不复存在。唯一的消费方是组件引用检查器
  (tools/quality/check-client-components.ts),改成:把断言文件写进插件自己的
  `src/client/`(client tsconfig 的 include 本来就覆盖它)→ 跑一次 `tsc -p <client>`
  → 只读回落在该文件上的诊断 → finally 删除。文件名进 .gitignore,只有被 kill 的运行会留下。
- **Effect 语言服务换成 `@effect/tsgo`**(tsgo 超集,内嵌固定版本 tsgo + Effect LS)。
  `prepare` 由 `effect-language-service patch` 换成 `effect-tsgo patch --typescript --no-oxlint`,
  换的是 `@typescript/typescript-<平台>` 里的原生二进制,`tsc --version` 显示
  `7.0.2+effect-tsgo.0.36.4`。tsconfig 里的插件名不变。
- **注释抑制的写法变了**:规则名不带 `effect/` 前缀,且 `-next-line` 是字面下一行。
  旧写法静默失效(实测:带前缀的 `effect/floatingEffect:off` 完全不生效,不报错也不抑制)。
  仓库里三处抑制:两处改成不需要抑制的写法(负面类型断言改为正面类型断言;
  `Effect.fail<unknown>` 让失败通道说实话),一处改用新语法。
- **诊断变严了**:新版规则集在旧代码上找出 1 个 error + 1 个 warning(都是真的),
  外加 51 条 suggestion。suggestion 经 `includeSuggestionsInTsc: false` 挡在 tsc 输出之外——
  它们是编辑器建议,不是门禁判定。
- **版本天花板是上游发布**:`@effect/tsgo` 的平台二进制包按版本单独发布,
  wrapper 声明了 optionalDependencies 不等于二进制已上传(0.36.4 发布当天,
  各平台包 404 了约两小时)。升级前先确认 `@effect/tsgo-<平台>@<版本>` 真的能装上。
