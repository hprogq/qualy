# 插件描述器计划(两阶段装配,替代服务端 codegen)

来源:docs/assembly-new.md 的审计意见,经核实采纳。裁决记录在此;进度记 STATUS.md。

## 模型

插件 = 不可变描述值 `Plugin.define(id, ...features)`,default export。三种东西严格分开:

- **Service**:单提供者运行时能力,照旧 `Context.Service` + Layer。插件用
  `Plugin.service(Tag, { requires: [Orm, ...], layer })` 提供 —— requires 是**真实 Tag 数组**,
  类型上是 layer R 的上界(Layer 对 RIn 协变,实际需要更多服务在插件自己的 typecheck 报错),
  运行时是拓扑排序的依据。取代 `qualy.runtime.dependsOn` 字符串。
- **ExtensionPoint**:一个 owner 多个贡献者的装配通道,分相:
  `prepare`(任何 Layer 构建之前收集、编译成值:实体、权限目录、UI 页面、API 契约)/
  `afterServices`(全部服务 Layer 之上闭合:API handlers、raw routes)/
  `boot`(现有 Assembled:镜像、预热)。核心只认协议,能力插件自定义扩展点与 Feature 构造器
  (`Postgres.entities`、`ReactUi.surfaces`、`Api.group`,未来 `Search.index`、`VueUi.page`)。
- **Feature**:插件参与装配的单位(贡献 / 提供扩展点 / 提供服务 / boot hook)。

**环的消解**:auth 构建期需要 Ui 只因为页面注册被做成了运行时服务调用。页面改为 prepare 期纯数据后,
auth 构建期不再需要 Ui,请求期 ui-registry handler → auth 的边不再有反向边。permissions 同理回到
"构建 Rbac 之前目录已完整"(装配器收集,不再需要屏障承担收集职责);rbac 的镜像仍是 boot hook。

## 保留的边界(不做的部分)

- **浏览器 chunk 注册表**(apps/web 的 plugins.gen)保留:Vite 必须在构建期看到 import 图。
- **@qualy/api 全局类型聚合**保留到 M4 再议:前端整个建立在全局 typed client 上,
  换每插件自持 client 是独立一轮前端改造(2026-08-07 用户裁决)。
- **database 的 assembly 只瘦声明解析半边**:structural diff、baseline、drop guard、adopt、
  migrator、retained/detached 语义与 lock 全部保留 —— 停用插件的表必须留在聚合里,
  只有 lock 记得"谁曾贡献过"。retained 集按 lock import 已安装包的描述器(disabled/detached
  的包仍在 node_modules,卸载即 resolve 硬失败,现有规则不变)。
- **整装配的编译期闭合证明**放弃(缺服务/坏 config = boot 错):插件内部与
  `Plugin.service` 的 requires 校验保住每一步的类型诚实,装配完整性移到 resolve/boot 与
  真启动测试(用户 2026-08-07 裁决,接受)。

## 里程碑(用户裁决:M1 先行,M2 分批,不一次切 8 个)

**M1 原型**(现有系统不动):`@qualy/plugin-kit` 内核 + 最小装配器,测试里只装
database+ui-registry+ping,验证审计四点:①ping 根 default-export 描述器;②CLI 能从描述器
发现实体(不启动任何服务);③页面不经 Ui 服务进目录;④handler 在完整服务图之上闭合并真实served。
ping 的 layer/apiHandlers 导出由描述器共享的常量派生(桥),主系统照旧经 runtime.gen 消费。

**M2 分批迁移**(每批独立绿、独立提交):

- 批 1:compat 派生助手(描述器 → legacy layer/apiHandlers 导出),ping 收口。
- 批 2:layout-default、auth-local(小插件)。
- 批 3:ui-registry、database(能力插件自己的描述器 + 扩展点正式化)。
- 批 4:auth、org、rbac(大插件)。
- 批 5(宿主切换,最大的一批):装配器接管 apps/server,杀 runtime.gen / entities.gen /
  routes.gen;ui 目录与权限目录退回 prepare 期值(屏障只留 boot hook);
  `Postgres.scope(entities)` 句柄收掉 withDatabase/entityManager/kyselyOf/query 四层样板;
  删 compat 助手;测试台换装配器。
- 每批过门禁:typecheck、node+browser 套件、真实启动。

**M3 CLI 统一**:resolve/lock 改读描述器(lock 记 feature 投影,retained 语义不变);
database assembly 删 package.json 声明解析;seed 改读描述器;`qualy run <cap> <cmd>` 动态命令;
Pre/Post 形式化为 phase;**作废"resolve 不 import 插件代码"纪律并改 CLAUDE**(描述器是纯值、
import 无副作用,但确实执行 TS —— 这是有意识的裁决)。

**M4(未裁决)**:每插件自持 typed client,删 @qualy/api 与全局 api-client,前端全量换装。

## 装配流程(终态)

```
qualy.yml + lock → 动态 import 各插件 default 描述器
→ prepare:收集/编译目录(实体、权限、UI、API 契约、config schema)
→ Tag → provider 映射,按 requires 拓扑构建服务 Layers
→ afterServices:在完整服务之上构建 handler Layers 与 raw routes
→ boot hooks(Assembled 原样)
→ 绑端口
```

类型擦除集中两点,均在装配器内部:运行时 HttpApi 聚合的 `add(group as never)`、
组合后 Layer 的 `Layer<any>`。插件侧零 cast。
