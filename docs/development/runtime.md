# 开发态进程模型

`pnpm dev` 运行 `apps/server/src/dev/host.ts`。它是开发监督者，不是生产入口：监督者保持 Vite 与后端服务，后端源码变化时启动候选进程，在候选完成准备后切换流量并关闭旧进程。

## 进程分工

```text
browser → Vite
             ├─ Web modules / HMR
             └─ /api, /health → current backend candidate

dev host
  ├─ watches backend and assembly inputs
  ├─ starts plugin-declared development services
  └─ stages and accepts backend candidates
```

Vite 是 `@qualy/plugin-web` 声明的开发服务，由监督者管理，但不随每次后端重载退出。开发态的 RSC、SSR 和浏览器模块由同一个 Vite 进程协调；生产态由 Node 下的 Web 插件运行已经 stage 的 release。

## 开发服务运行时

监督者、Effect API、CLI 和沙箱继续由 Node 运行。Web 插件通过 `Dev.service` 声明 `runtime: 'bun'`，监督者仅为这个开发服务选择 Bun 可执行文件，继续沿用原有 IPC、准备、接力和关闭协议。其他未声明运行时的开发服务默认使用监督者的 Node，不按插件名称硬编码选择。

Node 与 Bun 的项目版本都由根 `mise.toml` 固定；pnpm 仍由 `package.json#packageManager` 固定。准备好工具后仍执行 `pnpm dev`。Bun 从 PATH 查找，官方安装与 mise 安装均可；mise 激活时优先选择项目固定版本。启动日志会打印开发服务身份、实际运行时版本和可执行文件路径。

监督者统一加载环境，Bun 子进程带 `--no-env-file --no-install`，只继承已确定的环境和 pnpm 安装树，不再自动读取环境文件或安装依赖。Bun 不存在或启动失败时明确报错，不自动改用 Node。

需要对照或临时回退时，在开发环境中显式设置：

```dotenv
QUALY_DEV_RUNTIME=node
```

该变量只覆盖插件开发服务，不改变监督者、后端、沙箱、CLI、测试驱动或生产构建。删除它后恢复各服务自己的声明。取值只接受 `node` 或 `bun`。

采用依据与混合链路验收见 [Bun 运行时记录](../notes/bun-runtime.md)。本次没有把生产构建或产品后端迁到 Bun。

核心浏览器回归可运行 `pnpm test:dev-web`：它使用独立临时数据库、真实 Node API 和 Bun Vite，验证登录退出、JSON 写入及并发 SSR 的身份与语言隔离。默认预览端口为 5186；占用时直接拒绝，不另找端口。首次运行需要已有 pnpm 安装树及 Playwright Chromium。该回归不读取开发环境文件，也不修改业务源码；HMR 的手工对照仍见上述记录。

## 后端接力

候选进程先构建装配和服务图，达到 prepared 栅栏后才允许接收请求。监督者把代理目标切到新候选，再终止旧候选；候选在准备阶段失败时，旧进程继续服务。协议消息和状态机实现在 `apps/server/src/dev`，测试覆盖准备、接力、服务 runner 和异常关闭。

## 文件变化

监督者区分浏览器 HMR、后端重载和装配变化。插件描述器、服务端源码或影响装配的输入触发候选后端；客户端模块交给 Vite。生成的浏览器聚合和消息 facade 使用相对路径并配静态 scan 输入，避免冷缓存时由 Vite 临时发现第二份 React 依赖图。

完整设计过程保存在[开发态监督者历史方案](../archive/designs/development-runtime-plan.md)。该文档记录施工阶段和失败尝试；本页描述当前使用方式。
