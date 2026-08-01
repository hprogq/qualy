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
  migrate() 幂等且台账检查仅数十毫秒,hmr 重载 database 插件重跑无害,不做进程级
  once-guard。
- **codegen 自动化**:手动 `pnpm gen` 是踩过的 footgun(fresh clone CI 曾因 typecheck
  前置缺 gen 断链)。dev/typecheck/test 现在前置 gen(build 原本就有 --all),
  plugin:add 收尾自动 regen;写前比对使无变更时零写入,重复执行代价 ~1-2s。
  CI 的独立 gen 步骤随之删除(typecheck 自带)。

## 缓建(记录触发条件,条件未发生前禁止预防性重建)

| 机制                                               | 触发条件                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| @qualy/tooling 包(qualy bin/CLI)                   | 第四类 codegen 能力落地(如 rbac.permissions 权限码生成)、插件出现私有 codegen 需求、或 CLI 需在本仓库之外使用 |
| AssemblyGraph / CodegenRegistry(贡献-任务双层模型) | 同上——审计自己的实施顺序也把 registry 排在第四条真实能力之后                                                  |
| Vite adapter / plugins.gen 虚拟模块                | 物理 gen 文件造成真实构建摩擦(如 watch 竞态、fresh clone 解析失败复发)                                        |
| gen watcher(dev 期间自动重生成)                    | 结构性变更(增删 contract/client 导出)在会话内高频发生;当前 plugin:add 自动 regen 已覆盖主路径                 |
| 迁移 mode 'verify'(校验不执行)                     | 应用容器无 DDL 权限的生产部署真实出现                                                                         |
| 插件自带 migration 序列                            | 出现需要独立发版的外部插件生态(需要版本 DAG/拓扑排序/多 ledger,见审计第七节)                                  |

## 永久禁令(审计与既有纪律一致)

- 应用运行时进程禁止执行 drizzle-kit generate、禁止写 .gen.ts(生产容器可能只读;
  rename 歧义无法无人值守;生成物必须经审查提交)。
- codegen 不进 cordis core(contract/组件/schema 是 Qualy 应用约定,不是框架概念)。
- 不按 active 集合动态增删数据库对象(停用不改变 schema 聚合,不变式测试守护)。
- 共享输出文件单一 owner:插件声明贡献,聚合器拥有 contracts.gen/plugins.gen。
