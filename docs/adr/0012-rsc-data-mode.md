# ADR 0012：页面装配移到服务端，采用 React Router RSC Data Mode

- 状态：**提议**（2026-11-06，阶段 1 验证中；结论见文末）
- 相关：[浏览器公开面](../architecture/browser-surface.md)、[Web Release 协议](../architecture/web-release.md)、[ADR 0010](0010-ui-widget-platform.md)、[ADR 0011](0011-i18n-paraglide.md)、[Web 性能记录](../notes/web-performance.md)

## 背景

浏览器打开任何页面都要先自己发现产品结构：入口脚本取 `/api/app/manifest`，再按 manifest 拉布局与页面 chunk，再拉布局声明的 slot，页面挂载后才开始自己的查询。布局合并、slot 提前预取已经压掉了几段等待，但装配仍发生在浏览器，节流对照下 React 首次提交约 5.5 s、LCP 约 6.2 s。

服务端本来就掌握身份、租户、插件贡献和授权投影。让它在同一个请求里选好布局、页面和 slot，再把带正文的 HTML 交给浏览器，比浏览器重走一遍发现过程更直接。

框架选型已经结束：Next.js 要求文件路由，Waku 会替换 React Router，TanStack Start 的 RSC 仍是客户端主导组合。React Router 8.5 的 RSC Data Mode 接受运行时生成的路由配置，可以嵌入 Qualy 自己的宿主，插件描述器能直接成为路由输入，不需要第二套页面体系。

## 决定

**范围：** 迁移的是 Web 展示层的页面装配。Effect 业务后端、HttpApi 契约、插件描述器和 TanStack Query 都保留。

1. **描述器语义不变。** `Ui.page`、`Ui.layout`、`Ui.slot` 和登录渲染器的声明形状不变，不增加 `server: true` 一类字段。路由 id 直接使用 surface 身份（`surfaceLabel`）。
2. **`'use client'` 划定客户端边界。** 它是 React 的模块图机制：被客户端模块导入的依赖也在客户端执行，同一个无环境依赖的模块可以同时进入两个模块图。因此不能用「是否写了指令」推断整个 surface 在哪里执行，也不能把「加了指令」当成「已兼容 SSR」。
3. **完整的 surface 实现表只在 RSC 环境。** collector 一次收集，按环境输出：RSC 环境得到 surface → loader 表；浏览器只得到 `browserPlugins`。
4. **浏览器只接收组件引用。** RSC 按本次请求加载当前页面需要的布局、slot、动态 renderer 和登录 renderer，交付框架生成的 Client Reference；客户端再把它们适配成 `PluginSurface`、`UiSlot` 使用的运行时 registry。loader、闭包、服务端组件函数都不跨边界。引用集合按「当前页面需要」裁剪，不按「用户有权访问」：交付即披露。登录 renderer 依据当前租户下的登录方式投影选取，不向匿名访客交付全部已安装的登录实现。
5. **授权 manifest 与本次引用是同一份渲染快照，**随 RSC 结果一起更新。RSC 路径不再用一条独立的 manifest Query 去单独替换快照。服务端 QueryClient 按请求新建；浏览器的 QueryClient 在 RSC 导航之间保持稳定。
6. **请求上下文显式传递。** locale 的优先级是：文档 locale 头 → cookie → Accept-Language → 默认。RSC 和 SSR 是两个模块环境，各自建立请求级 scope，locale 作为显式输入从 RSC 传给 SSR，不通过全局单例拼接。首次文档请求的 release 取自本次构建身份。
7. **`Effect.run*` 只在渲染接入处。** 由统一的请求级适配执行；页面通过同一份 HttpApi 契约读取数据，不直接访问 repo 或其他插件的内部服务。第一版走网络 transport。取消、追踪和资源释放覆盖整条响应流，直到流结束、失败或被取消。
8. **错误分类。** 位于 Suspense 边界内的 Client Component 在 HTML SSR 中出错，可以降级为客户端渲染；RSC 执行、模块解析、props 序列化、认证和公共上下文中的错误不算可接受的降级。
9. **Server Functions 当前关闭。** 运行时不传 `decodeAction`、`decodeReply`、`loadServerAction`；渲染入口只接受 GET 和 HEAD；静态门禁拦截 `'use server'`。这是当前政策，不是永久架构原则；将来开放需要另立 ADR，说明它如何登记到插件描述器、如何遵守错误码和审计规则。
10. **服务端可执行产物随镜像固定。** release store 继续保存带哈希的客户端资源，供旧标签页使用；服务器不从可变目录加载可执行代码。

**非目标：** 进程内 transport、Effect Atom、偏好存储重做，以及 SPA 与 RSC 长期并行的双模式。迁移期间原 SPA 入口保留，只用于对照和回退；全部入口验证通过后，切换默认入口，并在同一个变更里删除被替代的启动链。

## 实施阶段

0. 文档身份一致性：在现有 SPA 上独立完成，不依赖本 ADR。
1. 最小插件切片：真实产品组合下的登录页、AppShell 页面加跨插件 slot、`GrantOrigin` 所在页面；验证三个构建环境、引用传递、消息与主题、开发体验和生产构建。
2. 批次概览与平台行为：首屏预取、水合，以及会话、版本、语言的恢复，时区和主题兼容。
3. 全部入口切换与发布验收：其余页面做必要的 SSR 兼容，切换默认入口，删除旧启动链，验证双版本发布和性能。

**止损条件：** 只有修改 React Router 或 plugin-rsc 的内部协议、维护私有补丁、自行解析 Flight、为热更新自造大型协调器，或者必须向浏览器公开完整实现表，才能继续时，就停止，并在下文写明阻点。

## 阶段 1 结论

**结论：带限制通过（2026-11-06，分支 `spike/rsc-data-mode`）。** 真实产品组合的贡献已经在 RSC 环境完成授权装配。全程只使用公开接口：plugin-rsc 的三个入口和按环境配置，React Router 的 `matchRSCServerRequest`、`routeRSCServerRequest` 和 `shouldRevalidate`，Vite 的 `applyToEnvironment`。没有修改框架内部协议，没有自行解析 Flight，也没有维护私有补丁。原 SPA 的聚合模块逐字节不变，SPA 构建通过分包和预算门禁。

### 已证实

- **登录页。** 服务端在同一个请求里，以访客身份读取登录方式和会话状态，并且只交付这些方式用到的登录 renderer。首屏 HTML 里有租户名、主登录方式、其他方式和共享设备选项，不再是等待骨架。水合后复选框和切换登录方式都正常，邮箱表单可以输入；切换后客户端状态保留。
- **AppShell 和 AccountShell 页面。** 布局、顶栏、侧边导航、跨插件 slot（auth 插件的 `account-header`、用户菜单）和页面标题都在服务端 HTML 里。水合后，客户端 Query 正常加载列表。
- **消息。** HTML 渲染阶段按请求 locale 输出中文或英文。生产 handler 按 `Accept-Language` 选择了 en-US。
- **生产构建。** 三个环境都能构建，输出在 `apps/web/dist-rsc/`。生产 handler 可以用 Node 的 `Request` 直接调用：`/login` 返回 200，正文完整；`.rsc` 返回 Flight；POST 返回 405。
- **最小披露。** 匿名文档只交付 7 个 surface 引用：布局、登录页、本地登录 renderer，以及 manifest 对匿名访客开放的抽屉和用户菜单 slot。HTML 里没有插件源码路径。
- **错误分类。** 客户端组件只在 SSR 时抛错，会由 HTML 渲染器记录，浏览器改为客户端渲染，页面可以继续使用。把函数当作 props 跨边界传递，服务端返回 500。平台组件在渲染阶段读取 `window`，整页失败。三种情况的结果都符合分类。
- **取消。** 读者中断请求后，渲染发出的读取请求随 Effect fiber 一起中断，不记为失败，服务端随后正常响应。
- **开发体验。** 编辑客户端组件后热更新正常，输入保留，没有整页刷新。RSC 开发服务是独立进程，后端重启不影响它。

### 限制与阶段 2 的输入

1. **服务端模块的热更新没有接通。** plugin-rsc 会发出 `rsc:update`，接到 `useRevalidator` 之后也会发出重新验证请求并返回 200，服务端单独请求新文档时也已经是修改后的内容，但已经水合的页面没有显示新内容。在时间盒内没有查明原因，相关代码没有保留。
2. **只改 search 的导航不在服务端重新渲染页面**（`pageRevalidation`）。原本由服务端重新渲染时，登录页的分步视图停在了旧视图上，原因同样没有查明。现在的规则和离开确认一致，都只以 pathname 为准。
3. **StyleX 不进入 rsc 环境。** 客户端模块在 rsc 环境里被替换成引用之前，StyleX 已经读过它，于是汇总 CSS 时找不到它引用的常量。因此目前服务端组件不能使用 StyleX 样式。
4. **引用集合目前是"授权的全部 slot 条目"。** 管理员的每份文档要交付 22 个引用，其中包括 `/account/roles` 用不到的公式计算器编辑器。页面不声明自己使用的 slot。建议仿照 `Ui.layout({ slots })` 讨论页面级的 slot 声明。
5. **`GrantOrigin` 没有被开发数据触发。** 两种宿主下结果一致：没有带范围来源的任职记录。grant presenter 的引用已经交付；"客户端在服务端交付的引用里局部选择 renderer"这一机制，已由登录 renderer 验证。
6. **在 SSR 里出现 React 告警** "multiple renderers concurrently rendering the same context provider"，原因待查。
7. **还没做的事项：**
   - CSP nonce 和响应头；
   - 会话清理时的 `Set-Cookie` 透传（`readApi` 目前丢弃所有响应头）；
   - 时区；
   - 暗色和 system 主题的水合；
   - `onManifestMismatch` 和 `useBlocker` 的探针；
   - Effect 宿主挂载：独立 handler 已经通过，嵌入 Effect 宿主留待阶段 2；
   - 生产构建的不透明文件名、分包和预算；
   - 服务端渲染错误按 surface 和请求关联。
8. **web-rsc 的类型。** 服务端模块需要 Node 类型，目前用 `/// <reference types="node" />` 进入插件的浏览器 tsconfig 程序。插件服务端页面的类型检查边界还需要决定。
