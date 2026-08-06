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
  (`Db.entities`、`Ui.surfaces`、`Api.group`,未来 `Search.index`、`VueUi.page`)。
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
- ~~批 5(宿主切换)~~ **已完成 2026-08-07**:装配器接管 apps/server(src/assembly.ts 走
  verify 后的 resolution 动态 import 描述器),runtime.gen / entities.gen / routes.gen 全部消失;
  PermissionCatalog / LoginDrivers / Ui 均为 prepare 期编译值,屏障只剩 rbac 镜像等 boot hook;
  `Db.scope` 已在 ping 验证(全插件调用点清扫另记);compat 助手删除;
  测试台换装(harness 用 serviceLayer + compileCatalog 的真实目录)。
- 每批过门禁:typecheck、node+browser 套件、真实启动。

**M3 CLI 统一**,拆两批:

**M3a 动态命令**(先做)。命令结构的裁决,按大型项目先例:

| 模型                                                        | 代表                                         | 取舍                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| 平铺 + PATH 发现(`git foo` / `cargo foo`)                   | git、cargo、kubectl 插件                     | 核心与扩展命令同名冲突要靠约定;发现机制基于二进制,不适用单进程 CLI                      |
| `run <task>` 间接层                                         | npm run、nx run                              | 为"任意用户脚本"设计的防冲突层;qualy 的命令来自插件声明,不是任意字符串,多打一层纯是成本 |
| **名词优先两级**(`docker buildx build`、`rails db:migrate`) | docker CLI 插件、rake namespace、oclif topic | 命名空间即所有权;qualy 的「一键一主」规则已经天然保证命名空间唯一                       |

**裁决:名词优先两级,不加 `run`**——现有 `qualy database <cmd>` 就是这个形状,推广之:

```
qualy resolve | plan | generate | deploy      # 生命周期,核心持有(保留字)
qualy <namespace> <command> [args]            # 插件命令,来自描述器
qualy list                                    # 发现:核心动词 + 全部命名空间与命令
```

规则:①命名空间一次认领、一个所有者(与 ExtensionPoint/能力键同规则,冲突点名双方硬拒);
②核心动词是保留字,命名空间不得占用;③`aliases` 支持(`db` → `database`,docker 同款);
④命令实现**惰性加载**(`load: () => import(...)`,oclif 同款)——描述器保持轻,服务端 boot
不因 CLI 命令背上迁移器;⑤命令声明 context 档位:`assembly`(只要 resolution)/
`capability`(CapabilityWorkContext,现有 database 命令的档)/ 将来 `runtime`
(起服务不绑端口,rails runner 同款——等第一个需要服务的命令出现再建);
⑥`effect/unstable/cli`(Command/HelpDoc/Completions)暂不引入:feature 形状已兼容
(name/summary/run),等需要 typed options 或补全时整体换壳,不影响插件侧。

实施:`@qualy/plugin-kit/cli` 定义 `CliCommands` 扩展点与 `Cli.command` 构造器;
scripts/qualy.ts 作为 CLI 宿主解释该点;database 描述器给出首个动态命令
`qualy db migrate`(= deploy 的迁移半边);`qualy web build`(alias `ui`)等
staging 脚本归属挪进 web 插件后再上(所有权先于命令)。

**M3b 声明源统一**,拆三批:

- ~~M3b-1~~ **已完成 2026-08-07**:resolve 为全部 accounted 插件 import 描述器
  (`resolution.descriptors`,**作废"resolve 不 import 插件代码"纪律**——描述器是纯值、
  import 无副作用,但确实执行 TS,有意识的裁决);runtime-plan 改读描述器
  (dependsOn/config 通道来自描述器,qualy.runtime 全数删除);testkit 合成包
  default-export 描述器字面量。
- ~~M3b-2a~~ **已完成 2026-08-07**:契约加可选钩子 `contributionFromDescriptor`
  ——钩子存在即**单源**,同键的 package.json 声明按 orphaned 硬拒,不做回退链。
  permissions 首个换轨:rbac assembly provider 经 `Plugin.contributionsOf(descriptor,
PermissionDeclarations)` 读声明,lock 记 `{owner, codes}`(评审 diff 直接看到码面),
  resolve 期用运行时同一个 `compileCatalog` 查重(正则源码扫描、catalogFile/exports
  一致性检查全删);auth/org/rbac 的 `qualy.contributions.permissions` 删除;
  seed(scripts/lib/permission-entries.ts)改读描述器,owner 来自声明本身。
  lock 只变内容不变版本(contribution 形状归 provider 所有)。
- **M3b-2b(下一轮)**:database 走同一钩子——`Db.entities` 携值 + dependsOn +
  compositeForeignKeys,`Db.baseline` feature 化,entitiesEntry/loadEntityModules
  路径机械死掉,lock 投影 `{tables, baseline shas, dependsOn}`(LOCKFILE_VERSION 升级);
  `qualy.capabilityProvider` → `Plugin.capability(key, lazyLoad)` feature;
  metadata.ts 的 contributions/provider 解析随之删除;retained 语义不变
  (retained 集按已安装包 import 描述器)。

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
