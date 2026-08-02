# UI 组合模型(2026-08-02 概念冻结)

前端从「页面组件聚合器」升级为受控的 UI Composition Runtime。七个概念的边界一经冻结,
后续扩展只能沿这些概念进行,禁止绕过 registry 的任意 manifest 修改。

## 七概念

| 概念            | 定义                                                                          | 现状                                                                               |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Component       | 构建内可懒加载的 React renderer,key 为 `<plugin>/<Name>`                      | plugins.gen 聚合,生成期命名空间校验                                                |
| Page            | 一个可路由主内容单元 = 恰好一个主 Component;`{ id, path, component, layout }` | id 必填(`org/tree` 式),layout 引用契约而非实现                                     |
| Layout Contract | 语义布局协议(含版本):`admin-shell/v1`、`blank-shell/v1`                       | 定义于 @qualy/ui-contract                                                          |
| Layout Provider | 契约的具体实现,由布局插件 registerLayout 注册                                 | @qualy/plugin-layout-default 提供两个默认实现                                      |
| Collection      | 结构化数据表面,布局统一渲染(导航/未来面包屑)                                  | `admin-shell/navigation-primary`(pageId 引用,build 期解析 path,页面消失项自动脱落) |
| Slot            | 松耦合 renderer 表面,cardinality one/many                                     | `admin-shell/header-actions`(首个真实消费者:auth/UserMenu)                         |
| Theme           | 视觉 token,与结构布局分离                                                     | CSS variables 已就绪(@qualy/ui/theme.css),Provider 注册缓建                        |

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
