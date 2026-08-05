# PLAN.md — 插件化综合素质测评系统 · 项目总纲

> 本文档是项目的唯一权威规划,供 Claude Code 及所有协作者使用。
> 其中的技术决策均经过充分论证与部分实测,**不要重新发起选型讨论**;
> 标注「实测」的结论可直接信任,标注「实查」的位置动手前先验证。

---

## 1. 项目概况

- **毕设题目**:《多模态大模型驱动的插件化综合素质测评系统的设计与实现》
- **英文题目**:Design and Implementation of a Plugin-Based Comprehensive Quality Evaluation System Driven by Multimodal Large Language Models
- **一句话描述**:一个高校综合素质测评(综测)系统——学生按章程申报材料、多级审核、量化计分、排名公示。系统以插件化架构实现题型/范式/能力的可插拔,以多模态大模型贯穿「章程生成题型 → 学生端预检 → 审核端辅助 → 分数解释」全流程。
- **基础**:在既有项目 Qualy 的多租户登录注册、树状组织架构(ltree)、RBAC 基础上改造。原 NestJS 宿主更换为 cordis,Service/Schema 层代码迁移复用,四层结构(errors/repo/service/router)保留在各插件内部。
- **性质约束**:本科毕业设计。单人开发,总工期约 10–14 周有效时间。**工作量控制优先于功能完备**,遇范围膨胀参照 §12 砍单顺序执行。
- **通用性立场**:架构做通用(活动-出题-作答-审核-计分-统计范式),命名与论文叙事聚焦综测。通用性作为论文「系统扩展性」章节,以 ACM 社团积分场景换配置验证。

## 2. 核心设计理念(所有实现决策的判据)

### 2.1 双层架构:代码插件层 × 配置层

系统分两层,归属判据只有一条:**看「谁在什么时候改它」,不看「它是不是代码」**。

- 程序员改、发版生效、影响所有题型 → **代码插件**(cordis 插件包)
- 管理员改、后台保存即生效、只影响单个题型/批次 → **配置**(数据库 jsonb)

### 2.2 计分函数 = 存在配置层里的代码(PAC 模型)

计分函数形式上是代码,生命周期上是配置(章程每年微调,管理员借助 AI 修改,不发版)。
类比:浏览器内置 PAC 引擎(代码),PAC 脚本(配置)。
落地:计分函数以 TS 源码字符串存库,经类型门禁与测试门禁后编译为 JS,由**沙箱执行器插件**运行。插件提供契约(函数签名、context 形状、限时限内存),配置提供实例。

### 2.3 范式 vs 题型:插件的粒度是范式

几十种题型收敛为约 6 种**交互范式**(代码):固定赋分、互评、材料申报审核、周期打卡、数据导入计算、混合录入。题型是范式扩展点上的**配置实例**(字段 schema + 计分函数 + 审核链定义)。少数交互特殊的「重题型」允许额外注册前端组件(渐进式:轻题型=纯配置,重题型=配置+组件)。

### 2.4 构建期装配哲学:一份 qualy.yml,三个生成物

选装插件是**构建/部署期决策**(方案 4)。qualy.yml 是唯一装配清单,被读两次:

- 构建期:三个生成脚本读它 → `db/schema.gen.ts`(Drizzle 聚合迁移)、`contracts.gen.ts`(oRPC 契约聚合)、`plugins.gen.ts`(前端组件注册表)
- 运行期:loader 读它装载后端插件

运行期**停用**插件零重建即生效(路由 404、manifest 条目消失、前端菜单隐藏);**新增**插件需重建——这与数据库迁移同节奏,是既定语义而非缺陷。

### 2.5 AI 三段式:生成 → 人工确认 → 沙箱执行

AI 只出建议与草案,人做决定。AI 生成计分函数必须通过类型检查 + 测试样例 + 管理员确认才可发布;AI 审批建议由人工裁决;绝不允许 AI 直接改分或直接通过审批。

### 2.6 effect 纪律

一切「有反动作」的操作(注册路由、定时器、往注册中心登记、开连接)必须包进 `ctx.effect`。这是插件可被干净卸载、依赖联动回卷成立的前提。Code review 见到裸副作用即打回。

### 2.7 发行与一键部署:构建清单与运行清单分离

「Web 勾选生成 qualy.yml → 直接跑」的发行愿景,靠双清单成立:

- **构建清单**:发行构建按 full-manifest(全部官方插件的超集)跑三生成器与迁移——所有表都建、所有契约聚合、所有前端 lazy chunk 都在产物里。schema 生成器**恒按超集聚合**(迁移语义:停用不删表,详见 notes/drizzle.md 迁移策略);contracts/plugins 生成器区分开发(按 yml 过滤)与发行(`--all` 超集)。
- **运行清单**:用户的 qualy.yml 只负责启停与配置。停用零重建是 P0 已验收能力,启用同样零重建:后端代码在 node_modules 里等 loader 按名 import,前端 chunk 在产物里等 manifest 放行。
- **一键部署三件套**:纯静态配置生成器页(零后端;勾选插件、填配置,各插件的 Zod Config 经动态表单引擎自举渲染成表单)产出 qualy.yml + docker-compose.yml + .env 模板;multi-stage 镜像(builder: pnpm install + gen --all + vite build + drizzle-kit generate;runtime: 源码 + tsx 直跑 apps/server/src/main.ts,entrypoint 先 db:migrate 再启动;docker stop 发 SIGTERM,main.ts 的优雅关闭在此兑现);用户 qualy.yml 以 volume 挂载,改配置 = 改文件 + restart。
- **延伸路线**:create-qualy 脚手架为次要路径;终局是管理页在线启停插件(loader.write() 双向写回,ui-registry + RBAC 已备),放 P5 后,现有架构无需返工。
- **诚实边界**:第三方/自研插件不在超集镜像内,需自建镜像(构建期装配的固有代价,对应已否决的方案 2 语义),README 写明。整套内容即论文「系统部署与分发」一节素材。

## 3. 技术选型定案(含否决清单,勿重启讨论)

| 层         | 选定                                       | 版本纪律                    | 关键理由                                                                                               | 已否决                                                           |
| ---------- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 插件运行时 | cordis                                     | **锁 `4.0.0-rc.7` 不带 ^**  | 插件一等公民、inject 门控、热插拔联动、Standard Schema 直连 Zod;作者生态(Koishi/Hydro)开发者有维护经验 | NestJS(需自造插件语义)、方案2远程装插件市场                      |
| API 层     | oRPC                                       | **锁 `2.0.0-beta.21` 全家** | 契约先行 + OpenAPI + 端到端类型;对象式路由天然适配动态合并/卸载(命令式框架无法干净反注册)              | Hono RPC/Fastify/Express/tRPC/ts-rest                            |
| HTTP 宿主  | node:http + oRPC handler                   | —                           | server 插件持 fragments Map,rebuild 原子换 handler;非 RPC 流量(静态文件/回调)可旁挂薄 Hono             | —                                                                |
| 数据库     | PostgreSQL 16 + Drizzle                    | —                           | 强关系域(成绩/审核链/结果);jsonb 存配置与答案;pgvector 做章程 RAG                                      | MongoDB、Elasticsearch、Neo4j                                    |
| 校验       | Zod 4                                      | 锁小版本                    | 全链路单一 schema 语言:插件 Config、oRPC 契约、动态表单、AI 结构化输出                                 | JSON Schema 表单库(RJSF/JSON Forms)                              |
| AI SDK     | Vercel AI SDK v6                           | —                           | `generateText` + `Output.object()`(v6 弃用 generateObject)配 Zod;比 LangChain 薄且类型友好             | LangChain 核心、LangGraph(有界重试用 for 循环)、DeepAgents、Mem0 |
| 模型       | DashScope Qwen 系                          | —                           | 文本 qwen-max/plus;多模态 Qwen-VL;embedding text-embedding 系;OpenAI 兼容接入                          | —                                                                |
| 队列       | BullMQ + Redis                             | —                           | LLM 调用必须异步化;重试/限流/结果缓存(按材料哈希去重)                                                  | —                                                                |
| 对象存储   | MinIO                                      | —                           | S3 兼容,证明材料存储,VL 模型取件                                                                       | 裸文件系统(仅 P2 临时)                                           |
| 沙箱       | QuickJS-WASM(quickjs-emscripten)优先       | —                           | 纯计分函数无 IO,天然隔离限时限内存;备选 isolated-vm                                                    | vm2(已死)、裸 eval/new Function(禁止)                            |
| 可观测     | Langfuse 自托管                            | —                           | MIT 开源自托管一等公民;traces/datasets 直接供论文实验                                                  | LangSmith(闭源,自托管需企业合同)                                 |
| 前端       | Vite + React + react-router + RHF + Monaco | —                           | 壳 + manifest 数据驱动 + 注册表 lazy;Monaco 内置 TS worker 做计分函数编辑                              | SSR、qiankun/iframe 微前端、真 LSP 服务器                        |
| 编排       | Docker Compose                             | —                           | pg/redis/minio/langfuse 一键                                                                           | —                                                                |

## 4. 已实测验证的事实(直接信任,勿重新调研)

以下均在 Node 22 实机验证(2026-07):

**cordis 4.0.0-rc.7**

1. 依赖门控:声明 `inject` 的插件在依赖服务未就绪时停 PENDING 不执行,就绪自动执行。
2. 热插拔联动:卸载被依赖服务 → 依赖方 effect 全释放、状态**回卷 PENDING**;服务恢复 → 依赖方自动重新执行回 ACTIVE。
3. Zod 直连:`plugin.Config = z.object(...)` 装载时校验、填默认值,非法抛 ValidationError。
4. 事件语义:bail/serial 首个非 undefined 胜出并短路;parallel 全并发;**waterfall 是洋葱中间件**——`ctx.waterfall(name, ...args, inner)` 最后一参为默认实现,监听器签名 `(...args, next)`,不是返回值接力。
5. effect:生成器多段 yield,释放顺序 **LIFO**;事件监听本质是 effect,卸载自动移除。
6. 多实例:同插件多次 plugin() = 多 fiber,各持独立 config(3.x fork 的替代)。
7. CLI:`NODE_OPTIONS='--import tsx' node node_modules/cordis/bin.js` 直接装载 qualy.yml 中**相对路径的 .ts 插件**,配置正常注入。qualy.yml 条目字段:id/name/config/disabled/inject/intercept/isolate/group。

**oRPC 2.0.0-beta.21** 8. **破坏性变更:`oc.route()` 已移除**,路由声明为 `oc.meta(openapi({ method, path }))`(`openapi` 自 `@orpc/openapi`)。网上 v1 教程此处全部失效。9. 入口:`OpenAPIHandler` 在 `@orpc/openapi/node`;`RPCHandler`、`NodeHttpHandler` 在 `@orpc/server/node`。10. 最小闭环已通:contract → `implement(contract)` → `impl.x.y.handler` → `new OpenAPIHandler(router)` → `handler.handle(req,res,{prefix,context})` → HTTP 200。11. 存疑待验:middleware 定义的 errors 并入 procedure 类型——v1 作者明确拒绝过该特性,v2 是否改变**未证实**。规避方案:公共 errors 定义在 base builder(`os.errors({...})`),procedure 从 base 派生。

**其他** 12. npm 官网页面有反爬,查包信息用 `registry.npmjs.org` API 或直接下 tarball 读 d.ts;beta/rc 期 API 以 `node -e "import('包').then(m=>console.log(Object.keys(m)))"` 实查为准,勿凭记忆或教程。

## 5. 系统架构

### 5.1 插件依赖五层(上层 inject 下层)

- **L4 AI 能力**:ai-genform(章程→题型)、ai-precheck(预检)、ai-review-assist(多模态助审)、ai-explain(分数解释)、ai-qa(章程问答/pgvector)
- **L3 范式**:paradigm-declaration(材料申报审核)、paradigm-import(导入计算)、paradigm-fixed(固定分)、paradigm-peer(互评)
- **L2 测评核心**:question-type(题型中心/版本/范式注册表)、batch(批次)、review(审核链引擎)、settle(结算)、submission(提交)
- **L1 基座领域**(源自 Qualy):auth、org(ltree 组织树)、rbac、dict(数据字典)、gradebook(成绩库)
- **L0 基础设施**:server(oRPC)、database(Drizzle+pg)、storage(MinIO)、queue(BullMQ)、ai(AI SDK 封装)、sandbox、ui-registry

非主干关键边:范式 inject 题型中心+审核链;paradigm-import 额外 inject gradebook;ai-genform inject sandbox+question-type;settle inject question-type+gradebook;ai-qa inject database(pgvector)。

### 5.2 仓库结构(pnpm workspaces)

```
qualy-next/
  qualy.yml            # 唯一装配清单
  docker-compose.yml
  drizzle.config.ts     # schema 指向 db/schema.gen.ts
  scripts/              # read-entries / gen-schema / gen-contracts / gen-plugins
  db/                   # schema.gen.ts(生成物,gitignore)+ migrations/
  packages/
    app/                # 后端宿主(依赖与 dev 脚本)
    plugin-*/           # 全部插件,每包 exports: . | ./contract | ./schema | ./client(均可选)
    api-client/         # createApiClient + contracts.gen.ts(生成物)
  apps/web/             # 前端壳(含 plugins.gen.ts 生成物)
```

### 5.3 插件包导出契约(命名纪律)

- `.` server 入口(cordis 插件);`./contract` oRPC 契约片段(**禁止依赖 drizzle**);`./schema` Drizzle 表;`./client` 前端组件 thunk 表(**只导出 `components = { Name: () => import(...) }`,禁止顶层副作用与顶层重型 import,package.json 标 `sideEffects: false`**)。
- 路由命名空间 = manifest 组件前缀 = 包名尾段去 `plugin-`(如 `@qualy/plugin-ping` → ns `ping`)。contribute 的 ns 冲突直接抛错。

## 6. 关键机制设计规范

### 6.1 题型双层机制(系统心脏)

**FieldConfig 是单一事实源**,一份字段配置派生三样:

1. **Zod schema**(运行时):同一派生函数前后端共用——前端 RHF `zodResolver`,后端提交接口写库前校验;jsonb 只存已验证数据。
2. **前端渲染**(注册表):自研 FieldConfig 格式 + 组件注册表 + `useFieldArray` 处理重复组;不用 RJSF/JSON Forms。
3. **.d.ts 类型声明**(编辑/门禁):`fieldConfigToDts()`,select 选项生成**字面量联合类型**;Monaco `addExtraLib` 注入获得补全与红线(内置 TS worker,单文件纯函数够用,不架 LSP);保存时后端 `@typescript/vfs` 内存 tsc 复检,过则 `ts.transpileModule` 编译存库(TS 源码 + JS 产物双列)。

**版本化**:题型配置每次修改产生新版本;提交记录与计分函数钉死配置版本;字段配置变更触发对现存函数重跑类型检查,不过标「待修复」禁用于新批次。发布门禁三道:类型 + AI 生成的测试样例(管理员可补)+ 属性检查(分数∈[0,满分]、同输入两跑一致、限时限内存)。类型门禁同时限定计分函数语法为**可擦除子集**(禁 enum、namespace、class 参数属性等非可擦除语法),计分纯函数用不上这些,且为转译层未来降级到 Node 原生 stripTypeScriptTypes 保留退路(类型检查仍走 TS6 程序化 API)。

### 6.2 计分与数据

- 取数用 SQL,计分用沙箱 JS:gradebook 服务负责「主修/首考/非公选」过滤整形,计分函数收干净输入做纯计算。
- 计算结果落库 + 按需失效重算(成绩修改→关联综测分标脏),不做查询时实时算。
- 阶梯规则(1 项 0.5/2 项 0.8/3 项封顶 1)写在计分函数里,**不发明配置 DSL——函数就是 DSL**。
- 附件不进 jsonb:附件表存元数据,answers 存引用 ID。

### 6.3 事件语义映射(cordis 五模式的用途约定)

| 模式      | 本项目用途                                                      |
| --------- | --------------------------------------------------------------- |
| emit      | 领域广播:`submission/created`、`batch/settled`(通知型)          |
| parallel  | 结算后善后:等所有插件完成再归档                                 |
| bail      | 注册中心路由:`paradigm/resolve` 首个应答的范式接手              |
| serial    | 投票否决:`submission/check` 首个返回否决理由即拒绝              |
| waterfall | 可拦截默认行为:`review/assign` 审核分派(回避插件包装)、配置保存 |

### 6.4 审核链

审核链**定义**是题型配置(节点顺序 + RBAC 角色引用,管理员可视化编辑);**推进引擎**是 review 插件代码。分派走 waterfall 扩展点;互评等「延迟聚合」范式在窗口关闭时聚合计分,范式接口区分「即时计分」与「延迟聚合」两种生命周期;固定分范式证明「作答可选」的抽象干净度。

### 6.5 server 插件模式(已定稿,照抄 P0 手册 D4 代码)

fragments Map + contribute(ns, router) 全 effect 化 + rebuild 原子换 handler;HTTP 服务器只建一次;每请求 context 注入 `{ cordis: ctx }`;OpenAPI 文档随 rebuild 自动更新。

### 6.6 ui-registry 与前端壳

- `ctx.ui.addPage({ path, layout: 'admin'|'blank', component, public?, permission?, nav? })`、`addWidget(slotId, { component, order })`、(题型)`addRenderer(typeKey, componentName)`——全字符串、全 effect。
- manifest 接口**匿名可访问**:未登录返回 public 子集(登录页 + login.methods 插槽);登录后重拉获得 RBAC 过滤的完整视图。权限过滤在服务端。
- 壳只含:双布局(Admin/Blank)、设计系统与 Provider、manifest 驱动路由、`<Slot id/>` 组件、动态表单引擎。**登录页属于 auth-core 插件**,登录方式(密码/CAS/扫码)是 `login.methods` 插槽的部件插件。
- 树摇机制:禁用插件不进 gen → 不进模块图(零字节);启用插件内组件 thunk 自动分 chunk;Monaco 等重依赖在组件内再嵌套动态 import。渲染器查不到 → console.warn + 动态表单降级(容错兜底)。

### 6.7 AI 能力管线(五场景)

| 场景          | 管线                                                                                                                                                                         | 要点                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| genform       | 贴章程 → pgvector 召回相关条款 → Output.object(FieldConfigSchema) → 单独生成计分函数源码 → vfs 类型检查 + 沙箱跑 AI 同产测试用例 → 失败带诊断回喂修复(≤3 轮)→ 管理员确认发布 | 有界 for 循环,不引入 LangGraph          |
| precheck      | 提交触发 BullMQ → VL 读材料 → 结构化输出{完整性,风险项[]}                                                                                                                    | 措辞用「预检提示」,**不给通过率百分比** |
| review-assist | VL 按题型字段 Zod 提取 → 代码比对申报值 vs 提取值 → 差异 + streamText 建议稿                                                                                                 | 与「材料问题定位」同模块                |
| explain       | 沙箱执行轨迹(命中分支/中间值)+ 函数注释 → 自然语言                                                                                                                           | 成本最低                                |
| qa            | 章程按条款切块 → embedding → pgvector →(rerank)→ 带引用回答                                                                                                                  | 复用于 genform 的召回                   |

工程通则:LLM 调用一律走队列不占 HTTP 请求;按材料哈希缓存 VL 结果;Langfuse 从 P4 开头接入采集全部调用(token/延迟/成本),datasets+scores 支撑论文实验。

## 7. 业务域模型

实体链:**方案**(分类/权重/各类封顶)→ **题型**(引用范式;字段 schema + 计分函数 + 审核链,版本化)→ **批次**(实例化方案;时间窗 + org 子树圈人)→ **提交** → **审核任务** → **得分记录** → **总分**(结算:分类封顶 + 权重聚合 → 公示申诉 → 归档冻结)。

数据字典(竞赛名单/证书表/活动库)独立维护,表单字段以数据源引用;每年更新改字典不动题型。

真实题型域参考(需求分析素材,论文第二章):品德行为(基础 8 分人人有含未登录新生、学生互评 1 分匿名、献血/社会实践/志愿服务材料申报、青年大学习按期扣分);学业水平(平均学分绩=主修首考非公选×0.75 四舍五入、挂科每科-1、全科 85+/80+ 加分——以上导入计算型);专业竞赛/科研/证书/学生干部/校园文化活动/文体实践/论文(材料申报审核型,竞赛名单动态字典)。

## 8. 开发路线图(P0–P5)

| 阶段            | 时长     | 交付                                                                                               | 验收关键                                                           |
| --------------- | -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **P0 装配骨架** | 1–1.5 周 | monorepo + cordis 闭环 + server/database + 三生成器雏形 + 前端壳最小版 + ping 全链路 + vitest 模板 | 详见 p0-manual.md 的 8 条清单;核心:停用零重建、剔除后树摇成立      |
| **P1 基座迁移** | 1–2 周   | Qualy auth/org/rbac → 三插件 + dict;manifest 接 RBAC                                               | 登录/组织树/授权走通;不同角色见不同导航。**搬家不重写,超时即镀金** |
| **P2 双层机制** | 2–3 周   | question-type + sandbox + 类型门禁链(Monaco+vfs) + paradigm-declaration + submission               | **手写**「献血分」题型端到端;改字段配置旧函数飘红待修复            |
| **P3 流程闭环** | ~2 周    | review + batch + settle + 公示申诉基础 + gradebook + paradigm-import + MinIO 转正                  | 一个批次全流程;导入成绩自动算学分绩/挂科                           |
| **P4 AI 链路**  | 2–3 周   | ai + queue 插件;五 AI 场景按 genform→precheck→assist→explain→qa 顺序;Langfuse 开头接入             | 答辩主线演示:贴章程→生成→确认→发布→填报→预检→建议稿                |
| **P5 收尾实验** | ~2 周    | peer/fixed 范式、打磨、Langfuse 实验数据、ACM 场景换配置验证、(可选)运行时前端加载演示             | 论文实验章节数据齐;通用性实证                                      |

论文咬合:开题在 P0–P1;中期卡 P3 末;P4 边做边写第四章;P5 写实验与成稿。git 提交从 P0 规范(即工作量证明)。

## 9. 工程纪律(Claude Code 必须遵守)

1. **锁版本**:cordis `4.0.0-rc.7`、oRPC `2.0.0-beta.21` 精确锁定;升级单独分支验证。
2. **实查代替记忆**:beta/rc 包的导出与 API 一律 `node -e "import('x').then(m=>console.log(Object.keys(m)))"` 现场确认;禁止照搬 v1 教程(`oc.route` 陷阱)。
3. **effect 纪律**(§2.6):裸副作用 = bug。
4. **命名纪律**(§5.3):ns/组件前缀/包名尾段三统一;服务名即契约,声明合并集中在各包入口。
5. **契约洁癖**:`./contract` 与 `./client` 不得依赖 drizzle/node 专属模块。
6. **测试模板**:每插件至少一个「装载→断言注册→卸载→断言清理」vitest(ctx.provide 打桩依赖)。
7. **不轮询 fiber.state**:就绪判断用 `await fiber`。
8. **敏感数据**:ORPCError 的 message/data 会发给客户端,禁放敏感信息;沙箱输入输出过 Zod,类型检查不替代运行时校验。
9. **语言规范**:代码标识符、注释、日志、CLI 输出一律英文;提交信息英文 Conventional Commits(scope 用对外模块名);项目文档与 UI 字符串用中文;文档产出到 docs/。

## 10. 风险登记与降级预案

| 风险                               | 预案                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| cordis rc / oRPC beta API 变动     | 锁版本;契约层隔离(最坏退 oRPC v1 只伤 server 插件百行胶水)                                                                          |
| hmr 对 tsx 装载 TS 的监听异常      | 限时 2h 排查;退路 tsup --watch 出 dist,yml 指向 dist                                                                                |
| oRPC v2 middleware errors 未如预期 | base builder `.errors()` 派生模式规避(§4.11)                                                                                        |
| 沙箱选型受阻                       | QuickJS-WASM 优先,isolated-vm 备选;接口抽象为 ctx.sandbox 服务可换实现                                                              |
| 工期崩                             | 砍单顺序:运行时前端加载演示 → ai-qa → paradigm-peer → 公示申诉细节。**不可砍底线**(标题承诺):双层机制 + 沙箱 + genform + 多模态助审 |
| AI 输出质量不稳                    | 三道门禁兜底;precheck/assist 仅建议不决策;Langfuse datasets 持续回归                                                                |

## 11. 参考文档索引

- `docs/cordis-tutorial.md`:cordis 使用教程(NestJS 风格,含五事件模式场景与速查表)
- `docs/cordis-4-handbook.md`:cordis API 完全手册(d.ts 级参考)
- `docs/p0-manual.md`:P0 逐日施工手册(D0–D9,含实测坑速查)

## 12. 术语表

| 术语               | 含义                                                        |
| ------------------ | ----------------------------------------------------------- |
| 范式 paradigm      | 交互模式的代码实现(申报审核/导入计算/互评/打卡/固定分/混合) |
| 题型 question-type | 范式扩展点上的配置实例,版本化                               |
| 贡献点             | 后端插件以字符串声明的 UI 元数据(页面/导航/插槽部件/渲染器) |
| 插槽 slot          | 前端具名扩展位,部件按 order 渲染(如 login.methods)          |
| manifest           | 按登录者权限过滤后的 UI 元数据集合,匿名可得 public 子集     |
| 双层机制           | 代码插件层 × 配置层(§2.1)                                   |
| 三生成物           | schema.gen / contracts.gen / plugins.gen(§2.4)              |
| 三道门禁           | 计分函数发布前:类型检查 + 测试样例 + 属性检查               |
