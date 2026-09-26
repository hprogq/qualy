# UI 组合模型(2026-08-02 概念冻结)

前端从「页面组件聚合器」升级为受控的 UI Composition Runtime。七个概念的边界一经冻结,
后续扩展只能沿这些概念进行,禁止绕过 registry 的任意 manifest 修改。

## 七概念

| 概念            | 定义                                                                                                                    | 现状                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component       | 构建内可懒加载的 React renderer,key 为 `<plugin>/<Name>`                                                                | plugins.gen 聚合,生成期命名空间校验                                                                                                                                                                                             |
| Page            | 一个可路由主内容单元 = 恰好一个主 Component;`{ id, path, component, layout }`                                           | id 必填(`org/tree` 式),layout 引用契约而非实现                                                                                                                                                                                  |
| Layout Contract | 语义布局协议(含版本):`app-shell/v1`、`workspace-shell/v1`、`user-detail-shell/v1`、`account-shell/v1`、`blank-shell/v1` | 定义于 @qualy/ui-contract                                                                                                                                                                                                       |
| Layout Provider | 契约的具体实现,由布局插件 registerLayout 注册                                                                           | @qualy/plugin-layout-default 提供两个默认实现                                                                                                                                                                                   |
| Collection      | 结构化数据表面,布局统一渲染(导航/未来面包屑)                                                                            | `app-shell/navigation-primary`、`workspace-shell/navigation`、`iam/user-detail-navigation`、`account-shell/navigation`(pageId 引用,manifest 期解析 path,页面消失项自动脱落);`iam/resource-grant-presenters`(键控 renderer 映射) |
| Slot            | 松耦合 renderer 表面,cardinality one/many                                                                               | `app-shell/header-actions`、`app-shell/user-menu`、`workspace-shell/context`、`iam/user-detail-header`、`account-shell/header`、`iam/resource-grant-renderer`                                                                   |
| Theme           | 视觉 token,与结构布局分离                                                                                               | CSS variables 已就绪(@qualy/ui/theme.css),Provider 注册缓建                                                                                                                                                                     |

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

## 第三个壳:用户详情(2026-09-20 扩展)

用户详情原是 auth 的一张页面自己包办 Banner、登录方式与角色授权,并直接读 rbac 的接口——那是插件化之后
不该存在的边。现在它是一个**布局契约** `user-detail-shell/v1`,与批次工作区同一种结构:

- 顶部同一排应用;下面是 **Banner 槽位** `iam/user-detail-header`(cardinality one,auth 提供:头像、姓名、
  编号、类型、所在单位、状态与整体动作);左侧是 **导航面** `iam/user-detail-navigation`(条目 path 带 `:userId`,
  由壳用当前路由填充,分组沿用 `navigationGroups`);右侧是页面。
- **每一节都是一张真正的 `Ui.page`**,由拥有那部分事实的插件声明并向导航面登记:auth 的基本资料 / 组织归属 /
  登录方式,rbac 的角色授权(`/organization/users/:userId/role-grants`),assessment 的参评批次 / 申报记录
  (`/organization/users/:userId/assessment/...`,分组 `assessment/user-detail`)。装配里没有某个插件,它的
  条目就不在 manifest 里,用户详情照常工作;auth 不写任何 `if (assessmentInstalled)`。
- 各节只共享地址里的 `userId`,不共享 `getUser()` 的数据:TanStack 自己去重,而一份跨插件的「用户是什么」
  的隐性契约正是要避免的东西。
- 实现上 layout-default 只有**一个** `RailShell`(导航面、上下文槽位、徽标槽位、是否为 Banner 作为 props),
  `WorkspaceShell` 与 `UserDetailShell` 是两个薄封装;不存在第三份壳代码。

**键控 renderer**:角色授权页把 `resource == null` 的组织授权与 `resource != null` 的专项授权分开(判据是
资源而不是 `validUntil`——时间范围与资源范围是正交维度)。专项授权由资源拥有者解释:插件向
`iam/resource-grant-presenters` 登记 `{namespace, type, renderer}`,页面按资源类型**精确查一个** renderer 并以
`PluginSurface` 渲染 `iam/resource-grant-renderer` 槽位中那一个 item(不是 `UiSlot` 全渲染——三个拥有者会各被问
两次别人的对象),没登记的类型显示平实的缺省文字。链接一律 `PageLink page=...`,renderer 查名称仍走自己的 API,
无权读取就退化为「来自一个测评批次」。**通用 `DELETE /iam/role-grants/{id}` 拒绝资源限定的授权**
(`GRANT_RESOURCE_BOUND`):它经资源拥有者的业务流程(如 assessment 的 removeStaff)撤销,拥有者保留着指向它的记录。

## 第四个壳:「我的」(2026-09-23 扩展)

「我的」是**当前登录用户自己的**一级入口,不是用户详情页换个路由:布局契约 `account-shell/v1`(layout-default 实现,
与用户详情同一个 RailShell:上方 Banner 槽位 `account-shell/header`,左侧导航面 `account-shell/navigation`)。

- **只接受本人数据或自助操作**:挂进来的页面只读写当前登录用户自己的东西(资料、登录方式、自己的参评 / 材料),
  不出现任何管理控件,可见性一律 `AUTHENTICATED`,不要求任何权限;背后是 `/iam/self/*` 这类不带用户 id 的自助接口,
  与 `/iam/users/{userId}/*` 管理接口分权。与用户详情**共享展示组件**(邮箱与验证状态、入口的「账号」列),不共享路由与授权。
- 顶栏入口是 auth 往 `app-shell/navigation-primary` 放的一个**无分组**条目(无分组即「一页一个应用」,order 很大所以排在最后);
  没有 auth 的装配就没有「我的」。`accountNavigation.key` 在 `navigationCollections` 里,pageId → path 照常解析。
- 其他插件要加「我的 → …」:声明 `layout: ACCOUNT_SHELL` 的页面并往 `account-shell/navigation` 放条目,不改 layout-default 或 auth。

## 工作区侧栏借给打开的对象(2026-09-26 扩展)

参评名单打开一位参评人后,批次侧栏(各分区)对正在读的这个人没有话说,而这个人的身份、站位、两半账户的切换、
上一位 / 下一位与回名单才是读者需要站在工作旁边的东西。做法不是新增布局契约(页面仍是同一张
`assessment/batch-results`,`?participant=` 深链不变),而是 `workspace-shell/v1` 多一项**可选能力**:

- 协议在 `@qualy/web-runtime`(与 `ScreenFootScope` / `ScreenFillScope` 同类):壳挂 `ScreenAsideScope offered`,
  页面用 `<ScreenAside>` 把内容放进壳的侧栏位置,`useScreenAsideOffered()` 告诉页面此刻有没有可借的栏。
  认领按计数(路由切换时新旧两屏重叠),在绘制前认领,侧栏不会先闪一帧导航再换。
- layout-default 的 RailShell 只在工作区形态、宽度 ≥ 1024 时出借;借出期间画 280px 的栏并不再画导航,
  归还即恢复。用户详情 / 「我的」两壳不出借(分区本就在页面自己的量度里)。
- 借出的栏是一个地标:`<ScreenAside label>` 给它起名(参评人详情用参评人姓名),壳把名字挂在 `<aside>` 上;
  页面自己在 main 里另放一个(可视隐藏的)标题说明这是谁的哪一半账户,按地标或按标题导航都找得到当前的人。
- 借出期间 main 不再保留滚动条槽位(`scrollbar-gutter` 回到 auto):借栏的页面自己铺满高度、在内部各栏滚动,
  保留的槽位只会在右缘留一道空条;不借栏的页面照旧保留,居中量度在页面之间不跳。
- **没有栏可借时,页面把同样的内容画在自己流里**(平板为工作区上方的头部,手机再把事实折叠到姓名后面);
  业务插件因此只依赖 web-runtime 的协议,不依赖布局实现,换一个不支持出借的壳也照常可用。
- 借出的栏里放什么由页面决定:参评人详情在身份与切换下方还放了参评名单(跟随当前人居中、可搜索),
  协议不变,壳仍只知道「有一栏被借走、它叫什么」。

同批次:工作区侧栏的收起状态按浏览器记住(`qualy:workspace-rail-folded`),宽表格页面收起一次即持续有效。

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

| 机制                                                                                   | 触发条件                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 多 Provider + 租户布局策略                                                             | 第二个布局实现插件真实出现                                                  |
| Theme Provider 注册与切换                                                              | 第二套主题或租户品牌定制需求出现                                            |
| ~~页面级 Slot(user-detail/tabs 等)~~                                                   | 已于 2026-09-20 以布局契约 + 导航面落地(见「第三个壳」),不做页面级 Tab Slot |
| Slot config schema 校验                                                                | 首个携带 config 的贡献出现                                                  |
| runtime bootstrap 插件(/runtime/bootstrap 聚合 viewer/tenant/ui + app/page 扩展 token) | 会话 7(依赖 RBAC 过滤;届时 me+manifest 合并、revision/ETag、加载 Shell)     |
| ui:validate 装配校验 CLI                                                               | manifest 与构建组件目录出现真实脱节事故                                     |
| Collection/Slot 版本升级(v2)                                                           | 首次破坏性协议变更                                                          |

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

## 增补裁决:主体缺席(2026-09-26,用户在线裁决)

用户试用时打开一个不存在的用户详情 / 批次地址:壳照常画出横幅、侧栏与底栏,只在横幅或内容区里挂一句
红色提示,侧栏还留着一串永远等不到能力集的骨架条。问题在于壳没有「它围绕的那个对象不在了」这个概念,
而页头、各分区各自对同一个失败再报一次。裁决:给围绕单个对象的壳(`workspace-shell/v1`、
`user-detail-shell/v1`,实现是 layout-default 的 RailShell)增加一项**可选能力**「主体缺席」,
与工作区能力过滤、侧栏出借同类,协议在 `@qualy/web-runtime`(`subject.tsx`),契约 ID 不变。

- **谁说**:对象的读取者,也就是填上下文槽位的那个贡献(批次的 BatchContextBar、用户的
  UserDetailHeader)。它发现主资源不存在、无权查看或首次读取就失败时,渲染
  `<SubjectAbsence><LoadFailure …/></SubjectAbsence>`,把「要显示什么」一并交出;壳只负责收起,
  永远不知道对象是什么、为什么不在。页面组件不做发布者(壳缺席时会卸载页面)。
- **壳做什么**:保留产品顶栏作为出口(手机上工作区原本让位给批次头部的顶栏也回来),收起上下文带、
  侧栏 / 人员分区、分区横条与工作区底栏(手机上底栏换成应用栏),在页面原位置放发布者给的状态。
  **上下文带只隐藏不卸载**:发布者就在带里,卸载它会撤回发布、壳展开、发布者重挂再发布,形成闪烁循环。
  发布在绘制前完成(layout effect + portal 到壳给的座位),侧栏不会先闪一帧。
- **默认不缺席**:没有发布者时照常渲染(与能力过滤的「未发布即隐藏」相反,因为这里挡的是整块内容)。
  认领按计数,路由切换时新旧两屏重叠也不误判;壳外的 `SubjectAbsence` 就地渲染内容,
  所以 `app-shell/v1` 下的详情页(角色、用户类型、公式)直接用同一组件整块替换内容区即可。
- **什么算缺席**(`@qualy/web-runtime` 的 `failure-kind.ts` / `useLoadFailure().subject`):主资源
  404(缺失码由拥有者**显式列出**,不按 `_NOT_FOUND` 后缀猜——批次页里找不到某个阶段不是批次缺席)
  与 403 随时算;断网、503、其他失败只在还没读到过数据时算——已经显示着的对象不因一次断线被收起,
  但被别人删掉就收起。地址里的 id 形状不对(`isRecordId`,与 typed client 编码参数同一个 schema)
  直接算缺失,不发请求。
- **话术**:整页 / 区块状态统一用 `@qualy/ui/resource-state`(无文案原语:缺失、无权、离线、
  服务不可用、读取失败五种,各有图标;整页尺寸标题获焦,区块尺寸不抢焦点,默认不画边框,放在裸页面上时
  `framed`)。通用中文话术在 web-i18n(`common/load/*`),拥有者可按名词覆盖标题(「找不到该批次」);
  缺失与无权**不给重试**,只给回去的路;宿主的「页面无法访问」与页面崩溃也改用同一原语。
  整页尺寸的状态在显示期间把自己的标题交给浏览器标签页(「找不到该用户 - Qualy」),状态消失后恢复页面名。
  `AsyncSection` 的出错态随之改为带标题、按类型决定是否重试的样子;旧的一句话写法仍兼容,但只画成
  「图标 + 说明字号的一行 + 重试」,不升格为标题(那些句子多是写操作的说法,放大成标题反而更刺眼)。
  通用缺失提示不带代词(「可能已被删除，或链接有误」),拥有者只覆盖标题时对人也读得通。
- **读屏与标题层级**:整页状态靠焦点移到 h1 播报,不再同时是 `role="alert"`(否则念两遍);区块状态默认
  `role="status"`(礼貌播报、不抢焦点),只有「按了重试、答复仍是失败」时才升为 `alert`。区块标题的层级跟着
  所在位置:裸页面上(`framed`)是 h2,卡片或对话框里默认 h3(`AsyncSection` 按 `framed` 推断,
  `LoadFailure size="section"` 用 `headingLevel` 指定),字号 14px,不比卡片头更响。
  手机断点与壳同一个常量(`breakpoints.phone`,767.98px),480 到 767 之间按钮同样纵排占满宽。
- **宿主的「暂无可用页面」也有出口**:没有任何可打开的页面时没有壳也就没有抽屉,宿主把
  `app-shell/drawer-sign-out` 槽单独放进状态的动作里,已登录者可以退出登录;匿名访客没有可退出的会话,不画。
- **无权与不存在可以是一句话**:拥有者若不愿泄露「这个 id 存在」,服务端把范围外的对象也答 404
  (用户已如此),界面就只说「找不到」;批次按用户裁决同样合并为 404 与一句合成话术。平台不替拥有者决定。

## 增补裁决:满屏工作台放弃滚动条槽(2026-09-26)

用户反馈:我的申报与审核详情在 PC 端右侧留着一条滚动条槽,而这两页只在各自的窗格里滚动,整屏滚动条永远不会出现。
RailShell 挂 `ScreenFillScope`,页面用
`useClaimScreenFill(宽度条件)` 声明自己在内部滚动(我的申报、审核详情在各自页面加这一行,骨架阶段也要声明),
壳即把 main 的 `scrollbar-gutter` 回到 auto(只改槽位不改 overflow,极矮窗口仍可滚动);AppShell 的满屏声明同样放弃槽位。
普通页面照旧保留槽位,居中量度在页面之间不跳。

## 增补裁决:应用内离开拦截归平台(2026-09-26)

用户反馈:编辑态(如阶段安排)下点侧栏去别的页面,未保存的修改静默丢失,应当先询问是否保存。
声明式 `BrowserRouter` 没有拦截点(react-router 的 `useBlocker` 只在 data router 里可用),各页面各自拦截又必然漏掉某条路。
宿主路由因此换成 `GuardedBrowserRouter`(react-router 8.3 的
`unstable_HistoryRouter` + `UNSAFE_createBrowserHistory`,与 `BrowserRouter` 同一实现、只是 history 由外部给出;
升级 react-router 时先跑 leave-gate / leave-guard 两套用例),所有 push / replace / 后退都经同一个闸门。页面只写
`useLeaveGuard({ when: 有未保存修改, onSave? })`:默认只拦「换了路径」的移动(同页 query 变化照常,
项目配置页按 query 的「按住」逻辑不受影响),弹框三选一「保存后离开 / 放弃修改 / 继续编辑」(不给 `onSave`
时只有后两者),同时注册 `beforeunload`;保存后自己要跳转的页面用返回的 `bypass` 包住那次跳转,
身份切换(`useSessionTransition`)不受拦截。测试 harness 用同一闸门的内存版,插件测试里同样会弹出询问。

闸门的几处细节(2026-09-27 审查后补):

- **同时有多个守卫**(一屏两个编辑器)时,只要有一个会丢东西就拦下,问一次:「保存后离开」依次保存每一个,
  全部成功才放行,中途失败就停在原页;只要有一个没有 `onSave`,就只给「放弃修改 / 继续编辑」。
  等待回答期间某个守卫撤下(它自己保存了),问题继续为剩下的守卫而问。
- **只有 POP 才算撤回落地**:浏览器后退被撤回、撤回还在路上时,页面自己做的 push / replace
  (比如后退后马上写 query)先排队,等回到页面自己的那条记录后再照常经过闸门,不会写到被撤回的那条记录上,
  路由也不会漏听。
- **页面自己走的 `go()`**(`bypass` 里或确认离开后重走)只放行预期的那一步:按步数匹配,且约 1 秒内有效;
  越界的 `go()` 浏览器根本不回应,不会让读者下一次真正的后退被静默放过。
- 满屏声明 `useClaimScreenFill` 与 `useClaimScreenFoot` 都在 layout effect 里认领:路由切换在 transition 里提交,
  被动 effect 可能晚于第一帧绘制,那一帧会带着滚动条槽或壳的底栏。
