# UI 组合模型(2026-08-02 概念冻结)

前端从「页面组件聚合器」升级为受控的 UI Composition Runtime。七个概念的边界一经冻结,
后续扩展只能沿这些概念进行,禁止绕过 registry 的任意 manifest 修改。

## 七概念

| 概念            | 定义                                                                          | 现状                                                                                                                |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Component       | 构建内可懒加载的 React renderer,key 为 `<plugin>/<Name>`                      | plugins.gen 聚合,生成期命名空间校验                                                                                 |
| Page            | 一个可路由主内容单元 = 恰好一个主 Component;`{ id, path, component, layout }` | id 必填(`org/tree` 式),layout 引用契约而非实现                                                                      |
| Layout Contract | 语义布局协议(含版本):`app-shell/v1`、`workspace-shell/v1`、`blank-shell/v1`   | 定义于 @qualy/ui-contract                                                                                           |
| Layout Provider | 契约的具体实现,由布局插件 registerLayout 注册                                 | @qualy/plugin-layout-default 提供两个默认实现                                                                       |
| Collection      | 结构化数据表面,布局统一渲染(导航/未来面包屑)                                  | `app-shell/navigation-primary` 与 `workspace-shell/navigation`(pageId 引用,manifest 期解析 path,页面消失项自动脱落) |
| Slot            | 松耦合 renderer 表面,cardinality one/many                                     | `app-shell/header-actions`、`app-shell/user-menu`、`workspace-shell/context`                                        |
| Theme           | 视觉 token,与结构布局分离                                                     | CSS variables 已就绪(@qualy/ui/theme.css),Provider 注册缓建                                                         |

## 两个壳,一条边界(2026-08-12 扩展)

原来只有一个 `admin-shell/v1`,于是「产品有哪些应用」「当前这件事能做什么」被塞进同一根侧边栏,
而学生一路背着一根他打不开任何页面的空栏。现在按**停留时长**分成两个契约:

- **`app-shell/v1`**:顶部一行应用(测评 / 工作台 / 资源库 / 组织与权限),下面一行是当前应用的分区,
  再下面是页面。**没有常驻侧边栏**——三四个页面的应用不值得为它常年占一列。
- **`workspace-shell/v1`**:同一排应用不变,下面是**上下文栏**(正在操作哪个对象)与**导航栏**
  (对它能做什么)。进入一个批次才出现,离开就消失。

两条新规则,都是为了让壳继续不认识业务:

1. **workspace 导航条目的 path 带参数**(`/assessment/batches/:batchId/phases`),
   由壳用**当前路由的 params** 填充;填不出来的条目**不渲染**(宁可缺,不可指向字面量 `:batchId`)。
2. **上下文栏是 Slot**(`workspace-shell/context`,cardinality one):壳不知道什么是批次,
   由知道的插件贡献一个组件;它自己从路由读参数,与它旁边的页面读法一致。

导航解析(pageId → path、页面不可见即脱落)因此从「只认 primaryNavigation」改为认
`navigationCollections` 列出的每一个导航面——新增导航面必须同时进这张表,否则条目带着未解析的
pageId 上网。

## 规则

- 页面声明 navigation 语法糖 → registry 展开为导航贡献;特殊导航项(外链)直接 contribute
  (NavigationItem 双形态:pageId 内链 / path 外链)。
- 所有公开逻辑 ID 命名空间化(`^ns(/seg)+$`),registry 注册时校验;重复 ID/path/contract 硬失败。
- 贡献无加载顺序语义:token 即契约,未知 key 的贡献不渲染(不报错)。
- manifest 是授权后投影:permission/public 等内部声明不出服务端(RBAC 过滤会话 7 接入同一投影点)。
- 无 provider 的布局所引用页面从 manifest 脱落并告警。
- 前端错误分层隔离:Slot 逐项 ErrorBoundary+Suspense(一个铃铛崩溃不拖垮壳),
  Layout/渲染器缺失 fail closed 显示占位。

## 依赖方向(必须遵守)

```text
业务插件      → @qualy/ui-contract(+ ctx.ui 注册)     × 禁止依赖布局实现插件
布局实现插件  → @qualy/ui-contract / web-runtime / ui  × 禁止依赖业务插件
ui-registry   → @qualy/ui-contract                     × 禁止依赖业务插件
apps/web      → web-runtime / ui-contract(纯路由引擎,无布局 DOM)
```

## 缓建触发表

| 机制                                                                                   | 触发条件                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 多 Provider + 租户布局策略                                                             | 第二个布局实现插件真实出现                                              |
| Theme Provider 注册与切换                                                              | 第二套主题或租户品牌定制需求出现                                        |
| 页面级 Slot(user-detail/tabs 等)                                                       | 首个跨插件页面扩展需求(如用户详情追加 Tab)                              |
| Slot config schema 校验                                                                | 首个携带 config 的贡献出现                                              |
| runtime bootstrap 插件(/runtime/bootstrap 聚合 viewer/tenant/ui + app/page 扩展 token) | 会话 7(依赖 RBAC 过滤;届时 me+manifest 合并、revision/ETag、加载 Shell) |
| ui:validate 装配校验 CLI                                                               | manifest 与构建组件目录出现真实脱节事故                                 |
| Collection/Slot 版本升级(v2)                                                           | 首次破坏性协议变更                                                      |

明确不做:微前端/Module Federation/远程 JS 加载、插件独立 Router/Tailwind、
任意 manifest 深合并、贡献间依赖图、拖拽布局编辑器。

## 增补裁决:工作区能力过滤(2026-08-13,用户批准)

批次工作区暴露的导航撞上了 manifest 模型:manifest 是**按 principal** 的授权投影,而「审核入口
该不该出现在这个批次的侧栏」是**按批次**的问题。裁决为三层分工,并扩展一个冻结概念:

1. **资格(manifest 层)**:页面可见性 `permissionOf(code)` 的语义定义为「**该 principal 在至少
   一个有效授权上下文中对该码具有 effective authority**」——resource 限定的授权也算一个上下文
   (rbac 的 `getProfile` / `effectiveRows('anywhere')` 据此把 `held` 放宽为 any-context;通用
   判定 `canAt` 等继续排除 resource 授权)。rbac 代数里没有 deny,批次层的 accepted−denied
   细化归第二层——这不是放宽的漏洞,是层次分工。
2. **批次能力投影(服务端)**:`getBatch` 携带 `capabilities: {personal, review, record, manage}`。
   它是 **workspace navigation capability**,不是权限码镜像:粗粒度、与 authorizeAction 同一套
   `batchAuthority` / 成员行算术单源计算,**不掺 PhaseGate**(能力=你在这一轮是谁;gate=此刻
   能做什么;阶段推进不得让侧栏条目忽隐忽现)。`personal` 表示成员行存在(excluded 保留历史,
   §32.56),不叫 participate 以免与「当前可参与」混淆。**列表如需 capabilities 必须批量投影**
   (principal + batchIds → 一次/常数次查询),禁止逐批次 authorization;当前列表不带。
3. **NavigationItem 扩展一个字段**:`capability?: string`(命名空间化 token,如
   `assessment/review`)。shell 只做集合匹配,不认识 token 的含义;workspace shell 挂
   `WorkspaceCapabilityScope`,工作区上下文的拥有者(assessment 的 BatchContextBar)把服务端
   投影映射成 token 集合发布。**loading/ready 是契约的一部分**:未发布时带 token 的条目一律
   不渲染(fail closed,绝不闪现后收回),不带 token 的条目不等待;无发布者的工作区里带 token
   的条目永不出现。

深链语义:路由存在 ≠ 资源授权成立;页面必须区分「有身份但当前无事可做」与「没有身份」两种话术
(unauthorized 不得伪装成 empty),守门的仍然是 API。
