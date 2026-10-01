# 开发态进程模型

`pnpm dev` 运行 `apps/server/src/dev/host.ts`。它是开发监督者，不是生产入口：监督者保持 Vite 与后端服务，后端源码变化时启动候选进程，在候选完成准备后切换流量并关闭旧进程。

## 进程分工

```text
browser → Vite (:5173)
             ├─ Web modules / HMR
             └─ /api, /health → current backend candidate

dev host
  ├─ watches backend and assembly inputs
  ├─ starts plugin-declared development services
  └─ stages and accepts backend candidates
```

Vite 是 `@qualy/plugin-web` 声明的开发服务，由监督者管理，但不随每次后端重载退出。开发态后端不服务 SPA；生产态由 Web 插件服务已经 stage 的 release。

## 后端接力

候选进程先构建装配和服务图，达到 prepared 栅栏后才允许接收请求。监督者把代理目标切到新候选，再终止旧候选；候选在准备阶段失败时，旧进程继续服务。协议消息和状态机实现在 `apps/server/src/dev`，测试覆盖准备、接力、服务 runner 和异常关闭。

## 文件变化

监督者区分浏览器 HMR、后端重载和装配变化。插件描述器、服务端源码或影响装配的输入触发候选后端；客户端模块交给 Vite。生成的浏览器聚合和消息 facade 使用相对路径并配静态 scan 输入，避免冷缓存时由 Vite 临时发现第二份 React 依赖图。

完整设计过程保存在[开发态监督者历史方案](../archive/designs/development-runtime-plan.md)。该文档记录施工阶段和失败尝试；本页描述当前使用方式。
