# Qualy 文档入口

这里是仓库文档的主入口。根目录 `README.md` 只负责最短的项目介绍；本页按阅读任务指向现行说明。带有“归档”标记的材料用于追溯当时的取舍，不再指导当前开发。

## 第一次了解项目

1. [系统概览](architecture/overview.md)：Qualy 解决的问题、主要业务流程、代码边界和关键取舍。
2. [综测领域入口](domain/README.md)：批次、填报、审核、认定、计分和公示的权威规则。
3. [项目亮点](resume-highlights.md)：面向答辩和求职材料的技术证据索引；它不是运行规范。
4. [项目面试模拟转写稿](qualy-interview-transcript.md)：从项目介绍进入代码展示，再沿不同面试官兴趣深入到插件、Effect、业务、安全、计分和发布。

## 本地开发与验证

- [本地开发](development/getting-started.md)：工具链、启动方式、配置来源和安全边界。
- [验证指南](development/validation.md)：按改动类型选择检查，不把终端流水账写回长期文档。
- [开发态进程模型](development/runtime.md)：Vite、后端候选进程和热更新如何协作。
- [StyleX 编写约定](development/stylex.md)：当前 UI 样式 API 和常见陷阱。
- AI 或自动化工具先读根目录 `AGENTS.md`，再按其中的任务路由打开必要文档。

## 深入设计与部署

- [插件化系统与运行边界](architecture/overview.md#插件和装配)：产品清单、描述器、能力和宿主职责。
- [数据库与迁移](architecture/database.md)：MikroORM、Kysely、中央迁移历史和部署约束。
- [浏览器公开面](architecture/browser-surface.md)：manifest、surface 身份和最小披露边界。
- [Web Release 协议](architecture/web-release.md)：旧标签页兼容、release store 和服务端校验。
- [沙箱架构](architecture/sandbox.md)：公式编译与运行隔离。
- [公式运行时](architecture/formula-runtime.md)：认定、assignment、calculator 发布与执行边界。
- [租户设置与术语](architecture/settings.md)：设置目录和文档上下文。
- [生产部署](deployment.md)：镜像、迁移、双色切换、回滚和备份。
- [架构决策记录](adr/)：为什么采用当前方案，以及被替代方案的背景。

## 证据和历史材料

- [实测笔记](notes/)保存依赖行为、事故复盘和性能测量。它们是窄证据，不自动升级为全局规范。
- [上游问题草稿](upstream/)保存可独立提交给依赖项目的复现与状态。
- [历史设计](archive/README.md)保存仍有追溯价值的已完成方案。当前实现以代码、测试、ADR 和本页列出的现行文档为准。

文档发生冲突时，已接受的业务裁决和 ADR 说明“应该是什么”，代码和测试说明“现在实现了什么”。两者不一致时先记录差异，不用代码静默覆盖业务规范，也不为迁就历史方案修改现行行为。
