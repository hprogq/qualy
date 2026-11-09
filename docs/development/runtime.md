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

候选先在旧后端仍运行时准备。准备成功后，旧后端退出，候选接手同一个本地端口；若准备失败，旧后端继续服务。对于仅替换后端的操作，Vite 不退出，并在已知的短暂切换期间等待再转发新请求。若新后端未就绪，等待有上限，真正的失败仍会报告。协议消息和状态机实现在 `apps/server/src/dev`。

旧后端为在途响应留出短暂的退出宽限。宽限结束后收掉仍打开的连接，已升级的 WebSocket 也在其中，浏览器走正常的重连逻辑。若旧进程仍未在监督者的退出期限内结束，监督者会单独报告强制停止，而不是只在接力完成后显示一段很长的耗时。

## 文件变化

监督者区分浏览器 HMR、后端重载和装配变化。插件描述器、服务端源码或影响装配的输入触发候选后端；客户端模块交给 Vite。生成的浏览器聚合和消息 facade 使用相对路径并配静态 scan 输入，避免冷缓存时由 Vite 临时发现第二份 React 依赖图。

修改后端插件的翻译时，监督者分别报告候选准备、旧进程退出和新进程启动的耗时；API 就绪后立即恢复转发，不等文件监听器重建。Vite 随后编译并一次发布整套消息；尚未使用这些模块的服务端环境不重载。若 HTML 或 RSC 导航 2.5 秒仍未收到响应头，开发日志会提示正在等待，不记录业务路径或查询参数。

插件文案同时供后端和网页使用，因此监督模式下 Vite 等候选后端就绪再发布文案；生成的多语言文件按一批更新，只发一次页面刷新。语言 key 不一致时，编译错误照常报告，原页面继续使用上一次可用的文案。仅浏览器使用的文案不等后端。Vite 的连接、模块热更新和逐文件刷新明细在 Debug 级别；终端仍会显示编译错误和浏览器警告。

完整设计过程保存在[开发态监督者历史方案](../archive/designs/development-runtime-plan.md)。该文档记录施工阶段和失败尝试；本页描述当前使用方式。
