# STATUS

阶段:**P1 基座迁移**(入场基线 tag p1-base,基线修复后 tag p1-ready,2026-08-02;P0 收官 tag v0.1.0-p0)

## 已完成

- [s1] 仓库奠基:git init(main);骨架文件就位;pnpm i 零报错;PG18+pgvector 容器 healthy 且 psql 连通;提交 4997321
- [s2] cordis 启动闭环:`pnpm dev`(bin.js + include 读 cordis.yml)装载 TS 冒烟插件 @qualy/plugin-ping;官方 @cordisjs/plugin-logger-console 输出日志;hmr 粒度重载可用(高风险项通过,未动用 tsup 退路);根 typecheck 门禁建立(TS 6.0.3);三视角复核 14 条发现已裁决(4 条现改、7 条修入教程/手册、不采纳 2 条、1 条推迟到 s7)

- [s3] 生成器基建 + database 插件:scripts/lib(read-entries 组展平+--all+漏装警告、codegen banner+write-if-changed)与 gen-schema 落地;@qualy/plugin-database(drizzle v1,Service.init 异步初始化+fail-fast,withRelations 视图工厂);ping 补 /schema(snakeCase.table,uuidv7 DB 默认主键)与 inject 门控;首个命名迁移建表并实测

- [s4] server 插件 + oRPC v2 接入:@qualy/plugin-server(OpenAPIHandler + CORSHandlerPlugin + onError 拦截;Service.init 绑定端口,disposal 等端口真释放;contribute/rebuild 全 effect,ns 冲突抛错);开场四条探针实录 notes/orpc-v2.md;HTTP 404 链路通

- [s5] ping 后端全链路:契约先行(oc.meta(openapi) GET /ping/hello)→ implement.$context<ApiContext> → contribute('ping');gen-contracts 生成器(exports["./contract"] 声明式发现,导出名约定 <ns>Contract)入 gen 管线;api-client(OpenAPILink@/fetch + createORPCClient + 类型标注);会话 4 收尾修令四条同批落地(server 请求兜底/db:reset/卷注释/vector 迁移备忘)

- [s6] ui-registry + manifest:@qualy/plugin-ui-registry(Service 'ui',static inject ['server'],addPage 全 effect + path 冲突抛错 + 确定性排序,RBAC 过滤留 P1 钩子);ping inject 'ui' 并 addPage(/ping,PingPage,admin,nav)
- [s7] web-runtime + 前端壳:@qualy/web-runtime(Provider/useApi/useManifest/Slot,react 为 peerDependency 防双实例);ping /client(thunk 表 + PingPage);gen-plugins 生成器;apps/web(vite 8 + react 19 + react-router 8,manifest 驱动路由,/api 代理);tsconfig 四程序分治(root node + web-runtime + ping/client + apps/web),typecheck 链式;check-chunks 树摇哨兵(头注注明依赖默认 [name]-[hash] 命名);契约 ns 定案改为按契约模块导出名派生(<ns>Contract,连字符包名陷阱实锤)

- [s8+收官令] P0 合卷:A 组修 CI(typecheck 前置 gen)、gen.ts 单入口(argv 共享根治 --all 只达链尾)、check-chunks/typecheck 声明化(根脚本零插件名)、**宿主拥有插件**(依赖与 cordis.yml 归位 packages/app,hoist 桥接实验失败后走结构正解;聚合方声明输入 + 生成器硬失败校验;hmr base 回锚修复 watcher 全盲);B 组 8 个 vitest(生命周期集成×3、PGlite PG18.3 迁移重放、生成器确定性×2、不变式、类型活性)+ 八项总验收归档 docs/reports/P0-REPORT.md + tag v0.1.0-p0;C 组角色表与两纪律入 CLAUDE、TanStack Query 接入(web-runtime 自持 manifest 生命周期,错误态可重试,@orpc/tanstack-query 同族锁定)

- [plugin-web 定案] 前端交付插件化(2026-08-02):server 增单槽 Connect 风格 fallback(effect 托管,/api 前缀内永不触发,next()→404、next(err)→日志+500)+ httpServer/port 暴露;新建 @qualy/plugin-web(mode auto 按 NODE_ENV 分流:development 挂 Vite middlewareMode 到宿主 server 共端口,production 用 sirv 服务 staged 产物;启用即必须可服务,缺产物/缺 vite 启动硬失败);apps/web 改名 @qualy/web-app 留守组合根,产物经 stage-web-assets 归插件 client-dist/(gitignored);独立 dev:web 与 /api 代理删除,dev 单进程。修复两坑:traceable 代理下服务可变槽重赋值不粘(fallback 撤销失效,改稳定容器盒,入 notes/cordis.md);sirv setHeaders 收请求路径致 html 壳误带 immutable(改无扩展名判定)

- [P1 入场收口] 基线冻结与三修复(2026-08-02):①装配清单更名 `packages/app/qualy.yml`(审计确认文件名在 cordis 库中零特殊化,仅弃用的 bin.js 有默认值;代码引用 main.ts/read-entries/plugin-add/codegen banner/两测试全量切换,归档文档与上游手册不动);②终端日志归一——db:migrate 换自研静音脚本(drizzle-orm migrate() 程序化调用,与 kit 台账实测兼容;注意 v1 必须 `drizzle({client})`,裸 `drizzle(pool)` 会被当 config 自建无凭据连接),vite 日志经 customLogger 走 `ctx.logger('vite')`;③web 壳补 index 重定向(首个 nav 项)与 404 页,根路径不再空白;④CI 增 `pnpm build` + staged assets 存在检查 + check-chunks 树摇门禁;⑤p1-tutorial.md 与 p1-migration-audit.md 入库(审计表已按真实旧仓校对路径),CLAUDE 切到 P1;⑥旧代码克隆 legacy/(gitignored,vitest 排除):qualy_old + algryth(RBAC 参考);⑦当前 HEAD 全量验收重跑并补记 P0-REPORT,打不可变基线 tag `p1-base`

- [P1 入场评审修复] 三项基线问题(2026-08-02,评审后、p1-ready):①CI no-op generate 改 `git status --porcelain`(git diff 漏 untracked 迁移目录);drop-guard 增 `--all` 全史扫描并入 CI(main push 上 `--base-ref origin/main` 差异为空、实际扫 0 文件;已批准的 destructive 迁移永远带 `-- destructive: approved` 标记,全扫恒干净);②packages/app 依赖自持:include/logger-console/timer 入 dependencies、hmr 入 devDependencies,根包剪掉全部 cordis 运行时依赖(根 dependencies 仅剩 tsx);③main.ts 清单路径 import.meta.url 锚定 + QUALY_CONFIG 外部清单覆盖(异 cwd 启动实证)。**重要实查**(loader rc.5 解析矩阵,见 notes/cordis.md):internal 路径按清单目录解析宿主依赖(monorepo 内启动必须 --expose-internals);无 internal 回退从 loader 包位置 plain import,pnpm 隔离下宿主直属依赖不可见——剪枝后静默零装载、退出码 0(实锤);外部清单路径只在独立部署扁平布局可用,生产清单不含 hmr

- [CI 竞态修复] generators 测试隔离(2026-08-02):CI 上 invariants 测试撞 YAML 重复键——根因是 generators 测试原地改写真实 qualy.yml(afterAll 恢复),vitest 测试文件并行,慢机器上 invariants 在 ping 带 disabled 的窗口读到清单再插一行成重复键(本地快、从未复现)。修法:read-entries 增 `--yml <path>` 注入(与 --all 同型),generators 的 disabled 用例改临时清单副本,仓库清单全程只读;教训并入注入化纪律——**测试禁止改写仓库跟踪文件**

## 验收输出摘录

- s2 启动:`[I] hmr watching [ '.' ]` + `[I] ping ping plugin loaded: 你好P0`
- s2 hmr:改 ping 源码保存 → `[I] hmr reload plugin at packages/plugins/demo/ping/src/index.ts` → 插件体重新执行,进程不重启,心跳定时器无重复(effect 清理干净)
- s2 yml 热应用:改 greeting 保存 → 运行中进程打出新问候;loader 写回 yml 补 id 字段(预期行为)
- s2 校验:greeting: 123 → `[E] include ValidationError: invalid config: Invalid input: expected string, received number (at greeting)`;旧实例存活,改回后自动恢复
- s2 类型门禁:`pnpm typecheck` → 零错误
- s3 生成:`pnpm gen` → db/schema.gen.ts(banner+re-export);再跑输出 "unchanged, skipped"
- s3 迁移:`pnpm db:generate --name ping-logs` → `20260727175710_ping-logs/migration.sql`(v1 目录结构);`pnpm db:migrate` → applied;`\d ping_logs` → id uuid 默认 uuidv7()、created_at timestamptz(snakeCase 映射实证)
- s3 uuidv7:裸 SQL insert 返回 `019fa4b9-80c7-7467-...`(版本位 7,DDL 兜底路径实证)
- s3 门控联动:ping 装载被 db 的 Service.init(含 select 1 探活)门控;yml 停用 database → ping 回卷;恢复 → 01:58:33 ping 自动重载
- s3 类型门禁:`pnpm typecheck` → 零错误

- s4 启动:`[I] server http server listening on :3000` → database connected → ping loaded
- s4 链路:`curl -i localhost:3000/api/anything` → `HTTP/1.1 404 Not Found`(空 fragments,链路通)
- s4 hmr 端口安全:改 server 源码 → `hmr reload` → `http server closed` → `http server listening on :3000` → curl 仍 404,无 EADDRINUSE(disposal await close 实证)
- s4 实查:CORS 插件 v2 名为 CORSHandlerPlugin(v1 的 CORSPlugin 已亡);onError 在 @orpc/server 根;OpenAPIHandler 泛型 Router<ApiContext>;四条探针全文 notes/orpc-v2.md
- s4 类型门禁:`pnpm typecheck` → 零错误
- s5 (a):`curl --get .../api/ping/hello --data-urlencode name=毕设` → `{"msg":"hello, 毕设"}`(裸 UTF-8 不编码会 400,属客户端编码责任)
- s5 (b):ping_logs 计数随请求递增,中文值落库
- s5 (c):api-client 类型化客户端 `c.ping.hello({name:'client'})` → `{ msg: 'hello, client' }`
- s5 (d):yml 停用 ping → 同 curl 404(贡献点 effect 摘除,零重建热生效);恢复 → 200 + ping 重载日志
- s5 关键实测:rc.7 服务访问受 inject 声明约束(cannot get property without inject),handler 必须闭包自插件 ctx;OpenAPILink 在 /fetch 子路径;RouterContractClient/JsonifiedClient 是纯类型导出(值探针盲区);弃用需 meta.path 印章的 client factory;sed -i 换 inode 会弄丢 yml watcher(脚本改 yml 用 python 原地重写)
- s5 类型门禁:`pnpm typecheck` → 零错误;类型活性验收(@ts-expect-error 错误调用)入 vitest
- s6 manifest:`curl /api/ui/manifest` → pages 含 /ping(PingPage/admin/public)+ nav Ping(order 10)
- s6 停用双重消失:yml 停用 ping → manifest 空 + /ping/hello 404(effect disposal 实证);恢复经重启路径回全(yml watcher 写回后失效怪癖二次复现,已归档 notes/hmr.md,勿会话中途深挖)
- s7 构建:`pnpm build` → `dist/assets/PingPage-*.js 0.26 kB` 独立 chunk;`node scripts/check-chunks.mjs` → present
- s7 树摇负测:停用 ping → build 产物无 PingPage chunk(check-chunks exit 1),index 体积同步减小;恢复 regen 正常
- s7 冒烟:vite dev 起壳(title Qualy),`localhost:5173/api/ui/manifest` 经代理返回 pages ['/ping'];浏览器人工走查留给人
- s7 类型门禁:四程序链(root/web-runtime/ping-client/apps-web)全绿
- plugin-web 测试:`pnpm test` → 11/11 通过(新增 fallback 槽生命周期 + 生产态 spa/缓存头/硬失败三断言组)
- plugin-web dev 冒烟:`pnpm dev` 单进程 → `curl :3000/` 返回 vite 注入 react-refresh 的 HTML,`/api/ui/manifest` 正常,`/api/nope` 404
- plugin-web 生产冒烟:`pnpm build`(gen --all → web-app build → staging)后 NODE_ENV=production 启动 → `/` no-cache、`/ping` 200(spa 回退)、哈希资源 `public,max-age=31536000,immutable`
- plugin-web 类型门禁:`pnpm typecheck` → 零错误(tc: 0)

## 会话中定下的约定(已写入 CLAUDE.md / docs/notes/)

- 共享框架依赖走 pnpm catalog;esbuild 构建脚本经 `pnpm approve-builds` 精确批准
- 插件 Config 末尾必挂 `.prefault({})`(zod 4 语义)
- tsconfig:base 用 module Preserve + types ["node"](cordis d.ts 与 NodeNext 不兼容,实测定案);web 侧覆写 types 清空;`.ts` 扩展名为软约定;根 tsconfig.json 是 solution 检查入口,`pnpm typecheck` 列入每会话验收
- TypeScript 只用 6.x(P2 vfs 门禁需 Strada API);不建 @qualy/tsconfig 共享包(触发条件见 CLAUDE.md)
- dev 脚本含 `--expose-internals`(hmr 依赖 loader.internal,生产脚本不得携带);hmr 需 @cordisjs/plugin-timer(peer)
- 插件包不写 package.json `cordis` 字段(市场元数据,运行时只认 inject);插件包对 cordis 声明 peerDependencies(防双实例),运行时依赖正常 dependencies
- plugin-timer 在 dependencies(运行时基础设施);hmr 保持 devDependencies——已知不一致:提交的 cordis.yml 引用了 dev-only 的 hmr,生产装配拆分(cordis.dev.yml include)推迟到 P0 尾声处理
- 复核修入教程的未来地雷:s3 需 @types/pg/drizzle 依赖声明与 database Config 默认值;s3 占位 gen 脚本不落盘;s4 server 关停返回 Promise 防 EADDRINUSE;s7 前置根 tsconfig solution 化 + client 依赖自声明 + 先 create vite 再 gen
- 插件形态定案(s2 尾声,与 Chat 四组对照实测共同确认):统一具名导出 `name/inject/Config/apply`,模块命名空间即对象插件,禁用 default 函数 + 属性赋值;对象型 Config 顶层 `.prefault({})`,禁止 `.default({})` 替代(Zod 4 短路语义,缺失时字段默认静默失效);函数插件体勿隐式返回值(返回值会被当作 effect 清理函数,非函数抛 Invalid effect)。教程 s2/s3/s5/s8 示例已统一,坑速查表补三行
- 启动入口定案(s2 尾声):packages/app/src/main.ts 接管 cordis bin(SIGINT/SIGTERM 优雅关闭,根 fiber dispose 级联清理,实测 Ctrl+C 退出码 0 无 ELIFECYCLE;根 fiber dispose 后状态仍 ACTIVE 属特例勿断言);hmr root 收窄为 packages;代码注释与日志一律英文
- 发行愿景定案入 PLAN §2.7:构建/运行双清单分离,生成器需 --all 模式(s3 落地),超集镜像 + 静态配置生成器 + volume 挂载 yml 三件套;--expose-internals 为 dev-only,Dockerfile 必查项

- hmr watch 集合定则(s2 尾声):root = loader 装载的代码目录 + 全部装配清单,当前 `["packages", "cordis.yml"]`;include 零自监听,yml 热更完全依赖 hmr watcher(曾因收窄 root 丢过配置热更)。已知上游怪癖:源码重载会把插件配置回退到启动值,真改 yml 值或重启 dev 恢复(notes/hmr.md)

## 遗留/阻塞

- 旧 Qualy Postgres 容器已改名 qualy-postgres-old 保留(卷 qualy_postgres_data 为 P1 数据源,勿删)
- (无新增阻塞)

## s3 定下的约定(已入 CLAUDE.md / docs/notes/)

- drizzle v1 成对锁 1.0.0-rc.4:表定义一律 snakeCase.table(定义期 casing);禁 drizzle()/config 的 casing 选项;RQB v2(pg 驱动无 schema 选项),关系 API 走 ctx.db.withRelations;陌生 API 先探针(v0/v1 教程混杂)
- 主键统一 UUIDv7 数据库侧生成(PG18 uuidv7() 进 DDL,兜住裸 SQL 路径);$defaultFn 仅在需预生成 ID 时叠加;时间戳 createdAt/updatedAt + withTimezone
- Service 异步初始化必须放 async *[Service.init](<>)(构造器 effect 拦不住依赖方,实测);服务缓存若绑定 disposal 资源须在同一 disposal 清空(重载安全);寄生副作用不用单独 effect 化
- 迁移必须命名:pnpm db:generate --name <名>;gen 管线只含已落地生成器,不写占位空壳;生成物统一走 scripts/lib/codegen.ts(banner + write-if-changed)
- 服务日志本分:启动(目标+耗时,凭据脱敏)、拆除、异常(传整个 error 对象);查询级日志走 logQueries 配置开关
- 迁移策略定案(2026-07-31,三组实验):gen-schema 恒超集聚合,停用不删表(实测停用 ping 后 generate 零变更;过滤聚合下 --explain 实证会计划 DROP);删除 yml 条目 = 显式 DROP 审阅动作;手工 SQL 走 pnpm db:custom(--custom 空迁移实测可用)
- ORM 终审结案维持 drizzle:Orchid 的 rake-db 生成器把外来表纳入改名/删除候选且无范围过滤(双插件实验实锤);翻案条件与全过程归档 notes/drizzle.md;git 已连 github.com/hprogq/qualy 并推送;仓库 AGPL-3.0
- 数据层 v3 治理栈曾按 A→H 六提交建成,随即被**数据层简化令**回退(2026-08-01):完整栈归档于 tag `archive/data-governance-v3`(2c6e8dc),回退动因、删除/保留清单与**约束性触发表**见 docs/notes/data-layer-retrospective.md。现行形态:零生成物聚合(resolveSchemaEntries 读 yml 全量 + qualy.database.schemaEntry 声明)、db:generate + drop-guard、db:generate:custom 手工 SQL 通道、dev 先 migrate 后 start、CI 六步精简版。冻结规则与元规则已入 CLAUDE.md。历史文档(architecture/database.md、orm-review.md)描述的是 v3 形态,查阅时以 tag 与 retrospective 为准
- 注意:main 历史含 amend 重写,远程需 force-with-lease 推送

## 代码审查修复轮(2026-08-01,基于 99e5814)

- entry 合并:schema.entry.ts 删除,schemaEntry 直指 src/db/schema.ts,exports["./schema"] 与 schemaEntry 不一致即抛错(跨插件引用与 kit 聚合共用同一文件)
- 测试注入化:readEntries/resolveSchemaEntries 支持 ymlPath,不变式测试改写 os.tmpdir 临时 yml,不再读写仓库真实 cordis.yml
- drop-guard 增 --base-ref(git diff <ref>...HEAD),CI checkout fetch-depth: 0 后按 origin/main 扫描;本地默认 git status 行为不变
- 死物清理:ping 的 behaviorDir 与两包 dependsOn 删除;read-entries 头注修正;codegen.ts 与 .gitignore 的 *.gen.ts 加防误删标注
- 确认项:tsc 通过且 include 覆盖 scripts/**(含 tests,vitest 导入参与类型检查);notes/hmr.md 已含 --expose-internals 必要性与 dev-only/生产禁带;pnpm-workspace 的 allowBuilds 字段对 pnpm 11.8 有效(实证:approve-builds 写入该字段后 esbuild postinstall 正常执行)
- prettier 最小配置(semi:false/singleQuote/printWidth:100)+ 全量格式化独立提交

## 下一会话(P1 会话 1)

- 按 docs/p1-tutorial.md 会话 1 执行:迁移边界、四插件骨架(@qualy/plugin-org/auth/rbac/dict)与 server 请求上下文。**搬家不重写,超时即镀金**。旧代码只读参考在 legacy/(qualy_old + algryth);旧数据在 qualy-postgres-old 容器(卷 qualy_postgres_data)。提交格式冲突已裁决:教程的 `p1-s<N>` 不用,一律英文 Conventional Commits(CLAUDE.md 优先)
- 浏览器人工走查(P0-REPORT 第 3 项)在 P1 第一个 commit 前人工补记:/ping 页面与导航、改 PingPage 文本验 HMR、停用 ping 后导航与路由消失、恢复、控制台无 React 双实例/Router/chunk 错误
