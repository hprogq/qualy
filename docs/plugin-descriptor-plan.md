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

- ~~浏览器 chunk 注册表(apps/web 的 plugins.gen)保留~~ **2026-08-07 改判**:Vite 必须在
  构建期看到 import 图这一半仍然成立,但磁盘文件不必——`virtual:qualy/plugins` 由
  Vite 插件按已验证装配现算(物化进 node_modules 缓存,dev/build/浏览器测试同一逻辑),
  服务端 main.ts 不再生成任何前端源码;冲突检查(组件键/目录命名空间/消息 id/错误码)
  原样保留在 collector 里。
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
- ~~M3b-2b~~ **已完成 2026-08-07**,两刀:①database 走同一钩子——`Db.entities(entities,
{dependsOn, compositeForeignKeys, baselineDir})` 一个 feature 携带全部声明,
  entitiesEntry/loadEntityModules 路径机械死掉,generate/deploy/adopt 经
  `context.descriptors` 直接拿声明值(与运行时同一批常量);lock 投影
  `{entities(实体名,总是可得;表名可来自命名策略), baselineDir?, dependsOn}`,
  **无需 LOCKFILE_VERSION 升级**——contribution 形状归 provider 所有,唯一跨版本读者是
  `retainsPlugin`,`lockedOwnsObjects` 兼容旧 `entitiesEntry` 形状即可(detached 语义保住);
  能力扩展点带 `capability` 键,resolve 在写 lock 前拒绝「贡献了没人提供的能力」
  (运行时通道归 boot 完整性检查,与旧行为对齐:api/ui/login 本就没有 resolve 期检查)。
  ②`qualy.capabilityProvider` → `Plugin.capability(key, lazyLoad)` feature(CLI 做事时才
  import provider 模块,boot 永不付费);resolve 先 import 全部候选(清单 ∪ lock 召回)的
  描述器再发现 provider,一键一主与「模块 key 与声明不符」的校验原样保留;残留的
  package.json 声明按 orphaned 硬拒;test-layers 的 provider 入口门禁改从
  `Plugin.capability` 声明发现。

~~M4~~ **已完成 2026-08-07**:每插件自持 typed client,@qualy/api 与全局 api-client 已删(见文末)。

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

## 审计修复轮(2026-08-07,M3b-2 审计驱动)

内核四点:①`Plugin.service` 拓扑真实落地(键重复/缺提供/成环 assemble 期点名硬拒,
requires 即排序依据;`Plugin.layer` 保列表序垫底,是不导出 key 的基础设施逃生口);
②`boot` 相从 `ExtensionPhase` 删除(零使用者;装配器不编译的相位只会静默吞贡献,
启动后一次性工作归 Assembled 屏障);③descriptor.id 必须等于包 id,import 失败包裹插件名;
④ExtensionPoint 同 id 异形(phase/capability)硬拒;provider 的 compile 收
`Contributed<T>{pluginId, value}`(重复页面/组同码点名双方);prepare 相 compile 类型上
强制零 requirement(重载而非条件类型——上下文归型会把未解析条件宽化到约束,实测)。

一致性三件:⑤前端产物指纹(stage 写 `.qualy-assembly.json`,宿主提供 `AssemblyInfo`,
web 插件 production 拒绝错配/无指纹)+ `scripts/smoke-production.ts` 生产真启动进 CI;
⑥静态 `qualyApi` 与运行时 `/openapi.json` **全量**深比较——首跑即抓到匿名 schema 命名因
加组顺序漂移,gen-api 改走运行时同一依赖序并从描述器读组,`./api` 导出与 `Api.group`
声明双向核对;⑦CLI 分发:命名空间命令 = 描述器命令 ∪ 同名能力命令(别名同达,同名硬拒),
修复 CI 的 `qualy database check`。

常量:api 聚合身份收进 api-kit(`Api.local(group, ...)`),六处插件与两处测试的
`QUALY_API_ID`/`QUALY_API_PREFIX` 拼写清零;其余跨插件常量核查为契约词汇
(ADMIN_SHELL/PUBLIC 等),非债务。

**缓建(带触发条件)**:描述器纯度静态扫描(effect LSP 已抓悬空 effect,import 错误已
包裹;触发:第一个第三方插件或首次纯度事故);prepare 相互依赖建模(现为并行 mergeAll,
类型已禁 requirement;触发:第一个需要读别的 prepare 结果的 provider);跨组同路径同方法
碰撞检查(组标识符已一键一主;触发:首次真实撞路径)。

## Ui.page 单点声明轮(2026-08-07,审计第三轮采纳)

`Ui.react(module)` = ClientComponentRef 纯数据(不跨进程传 React 值——Node/浏览器双 realm、
函数不可序列化、RSC 级魔法不值得);`Ui.page` 一次声明页面全部事实,`ui.ts`/`pages.ts`/
`messages.ts`/client components 表全灭。键 `<plugin>/<Basename>` 由 componentKey 派生,
四个消费方同源,wire 不变。客户端按 id 引用注册面(manifest 解析路径),同插件组件互引
保持普通 import。类型检查前移:typecheck 内组件引用检查器(存在/包内/React 组件/页面零
必需 props),红绿已验;`Ui.vue`/`Ui.svelte` 是未来的兄弟构造器,renderer 字段已开放。
缓建:IDE language-service 即时诊断(触发:API 稳定后);slot/layout 的 props 契约级
断言(触发:第一个带 props 契约漂移事故)。

## M4 + 预装配收官(2026-08-07,审计第四轮)

**M4(typed client 下放)**:每插件 `src/client/api.ts` 导出 `Api.local(...groups)`
(auth 聚合含 rbac 的 accessApiGroup,页面按其真实调用面声明);组件经 web-runtime 的
`useApi(xApi)` / `useApiQuery(xApi)` 消费(WeakMap 缓存 client 与 query utils),错误型
`ApiResult<typeof xApi, 'group', 'endpoint'>`。@qualy/api(gen-api 类型聚合)与
@qualy/api-client 包删除;api-client 的 effect client/query 原语并入
`@qualy/web-runtime/api`。测试 stub 经 `RuntimeProvider clientFor` 注入,类型仍受真
client 面约束(`ClientOf<typeof authApi> & ClientOf<typeof accessApi>`)。

**i18n 预装配**:client/index.ts 与 client/i18n.ts 的运行时聚合改为构建期——描述器
`Ui.i18n('./client/i18n.ts')`(external 相)声明聚合模块,virtual module 静态 import
其 catalogs/errorMessages;catalogs.test 按声明发现。至此**仓库零 codegen**
(唯一生成物 = db/migrations 的 SQL;virtual:qualy/plugins 是 vite 期现算,物化在
apps/web/.qualy/,gitignored)。

**`./api` 与 `src/api.ts` 保留理由(审计遗留判断)**:它不再是生成器钩子,而是
HttpApiGroup 契约叶子——服务端实现(Api.group)与浏览器 typed client(Api.local)
共用的单一声明点,也是跨插件聚合(auth 引 rbac 组)的 import 面;删它等于把契约
内联进 server 实现,client 将 import 服务端代码。

**物理重组**:packages/ 分类为 core(plugin-kit/assembly/api-kit)、contracts、
web(runtime/i18n/ui)、build/web(@qualy/web-build:vite 插件、collect、stage);
CLI → apps/cli,runner → apps/server/src/run.ts,其余脚本 → tools/
(fixtures/quality/repo/tests/lib)。包名全部不变,只动物理路径。experiments/ 删除。

**冷缓存双 React 定案**:vitest browser root 从仓库根改为 apps/web(拥有 react 的包,
dedupe 与 @vitejs/plugin-react 的 optimizeDeps 此前从根解析 react 全部静默失败);
生成模块的 import 从绝对文件路径改为相对 `.qualy/` 的相对路径(绝对路径在 vite 是
root 相对 URL,扫描器与 dev server 均不跟进),并加静态 import 的 scan 孪生文件
(聚合本体是动态 import,扫描器不跟);依赖自此全部在首扫期发现,中途 re-optimize
reload(冷缓存 7 测挂)消失,冷跑两次 + 热跑 13/13。
