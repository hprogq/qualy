# Qualy 系统概览

Qualy 是面向高校综合素质测评的单一产品。它把一次测评中的名单、阶段、填报、材料、审核、认定、计分和结果发布放在同一套可追溯流程中，同时用插件边界隔离业务域和基础设施。插件化服务于仓库内部的模块化、能力组合和依赖约束；当前产品不是允许客户任意拼装的插件市场。

## 主要业务流程

一次典型流程从测评批次开始：工作人员确定参评范围和阶段，冻结本批次的人员快照并配置填报事项；参评人提交带版本的申报和材料；系统按批次冻结的审核路线组织审核、补件、上提、复查和申诉；终局认定进入计分；正式公示生成不可变快照，后续更正通过新的业务记录表达。

```text
批次与名单
    ↓
事项、阶段与计分配置
    ↓
参评人填报 + 材料版本
    ↓
审核 / 补件 / 上提 / 复查 / 申诉
    ↓
终局认定 → 计分
    ↓
不可变公示快照
```

这条流程的细节和例外以[综测领域设计](../assessment-design.md)为准。五条基础业务决策另有 [ADR 0004–0008](../adr/)；公式认定和计分见[公式认定设计](../assessment-formula-recognition.md)与[公式运行时](formula-runtime.md)。

## 插件和装配

仓库根目录是产品组合根：`package.json` 声明安装的软件包，`qualy.yml` 选择当前产品使用的插件，`qualy.lock.json` 固化解析结果。宿主不枚举业务插件；它读取描述器、验证依赖图，再按准备、服务、运行期扩展和最终处理层组装应用。

插件通过描述器贡献 API、页面、权限、数据库实体、登录驱动或 CLI 命令。核心装配器只理解插件状态、依赖和扩展点，不理解 PostgreSQL、表或页面的具体语义。能力提供者负责解释自己的贡献，并在解析期拒绝重复提供、缺少提供者和不合法依赖。

```text
package.json + qualy.yml + qualy.lock.json
                    ↓
             assembly resolver
                    ↓
        plugin descriptors / capabilities
                    ↓
     prepared → services → runtime → handlers
                    ↓
        server host / web build / CLI runtime
```

应用是单一发布物。启用或停用会改变浏览器产物或服务图的插件时，需要重新解析并重新构建 release；需要运行时切换的纯服务端策略通过受校验的环境变量或设置表达。历史施工方案保存在[归档设计](../archive/README.md)，现行边界由描述器代码、装配测试和 `qualy.lock.json` 共同承重。

## 代码布局

- `apps/server`：生产和开发后端宿主；负责验证装配、建立 Effect runtime、绑定 HTTP 和优雅关闭。
- `apps/web`：浏览器组合根；不声明产品插件，Vite 构建时从当前装配生成私有组件表。
- `apps/cli`：`pnpm qualy` 的生命周期和能力命令宿主。
- `apps/sandbox-*`：公式编写与运行的隔离进程。
- `packages/core`：装配、插件工具、API、文本、公式、沙箱与遥测等稳定平台能力。
- `packages/contracts`：跨包共享的 wire 与领域契约。
- `packages/web`：浏览器 runtime、UI、i18n、品牌和可观测性端口。
- `packages/plugins`：基础设施、基础业务和综测业务插件。
- `packages/build`：消息编译和 Web 聚合，仅在构建或开发期使用。
- `tools`：质量门禁、测试 fixture、发布、演示数据和仓库维护工具。

## API 和浏览器

后端 API 以 Effect HttpApi 契约为单一来源。插件拥有自己的 group 和 handler layer；浏览器从插件私有 typed client 取得调用类型。服务端始终承担身份、授权、租户隔离、输入校验和审计，manifest 只负责能力发现。

浏览器收到的是页面、布局、槽位和登录方式等产品身份，不会收到实现它们的包名或源码路径。Vite 在构建期把这些身份映射到动态 import；私有映射和 sourcemap 不进入公开 release store。详见[浏览器公开面](browser-surface.md)和 [Web Release 协议](web-release.md)。

国际化由包私有 ICU JSON 和 Paraglide 编译期消息函数完成。每个浏览器文档在生命周期内固定一种语言；切换语言需要确认并整页重载，其他已打开文档继续使用各自的原语言。设计与性能基线见 [ADR 0011](../adr/0011-i18n-paraglide.md)。

## 数据和发布边界

实体由 MikroORM 定义，查询默认使用 Kysely。整个产品只有一条提交到 `db/migrations` 的中央迁移历史；构建不生成迁移，部署只应用已经审阅的迁移，启动只验证而不修复。详见[数据库与迁移](database.md)。

一个 release 由同一提交、同一标签和同一平台的 server、runtime sandbox、authoring sandbox 三个不可变镜像组成。数据库部署和 Web release 安装发生在 deploy 阶段；生产使用蓝绿两套应用进程，在新颜色就绪并通过公网核对后切换流量。详见[生产部署](../deployment.md)。

## 关键取舍与限制

- Effect 是后端唯一运行时；生产业务层不自行运行 Effect。
- 插件拓扑按一次装配固定，不提供在线安装或进程内热插拔。
- 正式公示是不可变快照；审核不确定性和参评人申诉是不同工作流。
- 管理员提供的公式源码只在隔离沙箱中编译和执行，服务端重新校验所有输出。
- 多租户隔离存在于数据和授权模型，但仓库不声称已有多个真实学校部署或使用。
- AI 辅助审批、自动生成表单等早期设想不是当前已交付能力，不能从历史聊天或毕设选题材料推断为现状。
