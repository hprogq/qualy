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

## 测试与类型检查提速(2026-08-11,逐条实测)

`pnpm test` 15.8s → **8.9s**,`pnpm typecheck` 8.5s → **3.6s**(热)。三个改动,按收益排序:

1. **测试跑在一个不做持久化的独立 Postgres 上**(`fsync=off`、`synchronous_commit=off`、
   `full_page_writes=off`):一次全量 15.8s → 10.5s,测试 CPU 时间 155s → 72s。
   一次运行要建、删约 150 个数据库,那些操作**无论 synchronous_commit 怎么设都要刷数据文件**
   ——实测只关 synchronous_commit 收益为零(15.9s),收益全部来自 fsync。
   但不 fsync 的集群崩溃后可能起不来(不是丢最近几笔,是起不来),所以它是**另一个容器**
   (compose 的 `postgres-test`,5433,tmpfs 无卷),开发库照旧持久化;
   testkit 认 `QUALY_TEST_DATABASE_URL`,没有就退回 `DATABASE_URL`——少一个容器只是慢,不是坏。
   CI 只有一个库且活不过一个 job,直接在安装后 `alter system` + `pg_reload_conf()`
   (三项都是 sighup 级,service 容器不接 command)。
   **vitest 不读 .env**:这一个变量由 vitest.config.ts 单独挑出来注入,
   整份 .env 灌进测试进程会让装配门禁看见它们本来就不该有的 DATABASE_URL 与清单覆盖(实测三条红)。
2. **tsc 带上 `--incremental` 与各自的 `tsBuildInfoFile`**(写在 node_modules/.cache 下,
   派生物、机器本地、随 install 消失):plugin-isolation 门禁 6.5s → 1.3s,
   `pnpm typecheck` 8.5s → 3.6s。实测注入一个类型错误,热运行照报不误——缓存按文件版本
   失效,不会给出假绿。CI 永远是冷的,不受影响。
3. **仓库遍历统一到 tools/lib/walk.ts**:六个门禁各写了一份 `walk`,规则已经漂移。
   诊断门禁会在 `apps/server/.effect-diagnostics-*` 里写临时 fixture 再删掉,
   有的 walk 在「列出目录」与「读文件」之间撞上删除,以 ENOENT 在无关门禁里偶发红——
   两次。现在只有一条规则:node_modules 与点开头目录不是源码。

4. **前端查询的重试策略写明白**:TanStack 默认失败重试 3 次、退避 1+2+4 秒,而本项目每个区块
   在失败时都会渲染错误与「重试」按钮——那七秒只是把读者本来立刻就能看到的消息藏在转圈后面,
   服务器给的 4xx/领域错误第三次也不会改口。现在只对「没有 `_tag` 的错误」(即连接层失败)
   重试一次。浏览器套件 14.2s → 12.5s,其中一条用例从 7.0s 降到 0.4s。

**排查过的死路**(别再重来):`create database ... template` 本身很便宜(并发 10 个时每个
18ms),`strategy = file_copy` 反而慢 4 倍;`--pool=threads` 无差别;`--no-isolate` 省 CPU
(75s → 52s)但墙钟只快 1.4s,而它把文件间的模块隔离也一起关掉了,不值。
瓶颈从来不是并行度——是**单个最慢文件**决定墙钟(现在是 assembly.test.ts 的 7.2s)。
浏览器套件那边 `browser.isolate=false` 与 `browser.fileParallelism` 都不动分毫,
剩下的 12s 基本是 Chromium 启动与四个文件各自经 Vite 加载整张模块图。

## workspace 依赖环:确有其事,判为不修(2026-08-30)

pnpm 安装时警告两组 cyclic workspace dependencies。实查(Tarjan SCC,全仓两张图):

- **dependencies + devDependencies 图**:两个强连通分量——{assessment, assessment-evidence}
  与 {audit, auth, auth-local, org, rbac, ui-registry, web-runtime}。
- **纯 dependencies(生产)图**:一个分量 {auth, org, ui-registry, web-runtime},
  即 pnpm 没说全——生产图本身就有环,不只是测试装配的 dev 边。

逐边核对,**全部是活边且各有领域理由**:auth ↔ org(站位不变量判定单源在 auth 的
placementLegal、org 改类型前要问 usersBlockingOrgType;反向是 auth 的实体闭包并入
org 的 Tenant——CLAUDE.md 明文的跨插件取表方式);auth ↔ ui-registry(manifest 是按
principal 的授权投影,要 session-contract;auth 用 Ui.page 声明页面);web-runtime ↔
ui-registry(统一 API runtime 拉 manifest 契约;页面组件用 useApi)。这是「双核心
互相纠缠」的架构形状,不是失误。

**为什么不修**:本仓库的运行模型里这个环没有可观察代价——workspace 是符号链接,
不需要安装拓扑序;所有包零 build/prepare 脚本(strip-types 直跑),pnpm 警告所指的
「生命周期脚本顺序不定」落在空集上;模块级(叶子子路径互指)并不构成运行时 TDZ 环,
从未炸过;typecheck 是逐工程 tsc --noEmit,无 project-references 拓扑要求。断环需要
把 session-contract 从 auth 挪进独立契约包一类的手术,而没有任何已发生的问题为它背书
——按数据层冻结规则的元规则,不做预防性建设。

**触发条件**(出现任一即必须先断环再做那件事):①引入 per-package 增量构建编排
(turbo/nx/project references build);②把任一 workspace 包发布到 npm;③生产源码
真实出现循环 import 的 TDZ 报错。
