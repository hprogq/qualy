# P0 施工手册

## 0. 总览

**P0 目标一句话**:一条 ping 插件从 cordis.yml 出发,贯穿「后端契约 → 数据库迁移 → manifest → 前端页面」的完整闭环,并证明两件事:停用插件零重建生效、剔除插件后前端树摇成立。

### 0.1 会话地图

| #   | 主题                       | 风险             | 建议人工在场 |
| --- | -------------------------- | ---------------- | ------------ |
| 1   | 仓库奠基                   | 低               | 否           |
| 2   | cordis 启动闭环            | **高(hmr×tsx)**  | **是**       |
| 3   | 生成器基建 + database 插件 | 低               | 否           |
| 4   | server 插件 + oRPC v2 接入 | **高(beta API)** | **是**       |
| 5   | ping 后端全链路 + 契约聚合 | 中               | 否           |
| 6   | ui-registry + manifest     | 低               | 否           |
| 7   | web-runtime + 前端壳       | 中               | 建议         |
| 8   | 测试骨架 + 总验收固化      | 低               | 否           |

### 0.2 版本基线(全部精确锁定,不带 ^)

node LTS(≥24) / pnpm ≥11 / cordis `4.0.0-rc.7` / @cordisjs/plugin-loader、plugin-include、plugin-hmr、plugin-timer、plugin-logger-console(当前 rc/latest) / @orpc/server、contract、openapi、client 全家 `2.0.0-beta.21` / zod ^4 锁小版本 / drizzle-orm、drizzle-kit **成对** `1.0.0-rc.4`(v1,与 v0 教程混杂,陌生 API 先探针,见 notes/drizzle.md)、pg 8.22、@types/pg / vite、react、react-router / tsx、vitest、yaml。

已实测事实(cordis 行为、oRPC v2 破坏性变更等 12 条)见 **PLAN.md §4**,每次会话开场都会读到,此处不重复;与当次会话直接相关的会在该会话内点名。

### 0.3 目录结构(定稿,禁止自由发挥)

```
qualy-next/
  CLAUDE.md  PLAN.md  STATUS.md  cordis.yml  docker-compose.yml  drizzle.config.ts
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .gitignore
  scripts/
    lib/read-entries.ts
    gen-schema.ts  gen-contracts.ts  gen-plugins.ts  check-chunks.mjs
  db/                      # migrations/ 提交;schema.gen.ts 忽略
  docs/
    p0-tutorial.md  cordis-tutorial.md  cordis-4-handbook.md
    notes/                 # 实查记录(orpc-v2.md 等)
    reports/               # 每阶段验收报告
  packages/
    app/                   # 后端宿主
    web-runtime/           # 前端插件运行时(useApi/Slot/Provider)
    api-client/            # createApiClient + contracts.gen.ts(忽略)
    plugins/
      infra/   server/ database/ storage/ queue/ ai/ sandbox/ ui-registry/
      base/    auth/ org/ rbac/ dict/ gradebook/
      core/    question-type/ submission/ batch/ review/ settle/
      paradigms/ declaration/ import/ fixed/ peer/
      ai/      genform/ precheck/ review-assist/ explain/ qa/
      demo/    ping/       # 永久保留的冒烟插件,生产 yml 不含
  apps/web/                # 前端壳;src/plugins.gen.ts 忽略
```

命名与依赖规则:

- npm 包名统一 `@qualy/plugin-<名>`(不含层级;目录层级可挪,包名不变)。路由 ns = 组件前缀 = 包名尾段。
- **每新增一个插件包,必须同时做两件事**:cordis.yml 加条目;根 package.json `dependencies` 加 `"@qualy/plugin-<名>": "workspace:*"`。后者是 loader 按包名 import 与生成脚本 `import.meta.resolve` 能找到包的前提(pnpm 严格 node_modules,根只装根依赖)。忘加的症状:loader 报模块找不到 / gen 脚本静默跳过该插件。
- P0 只建 `infra/{server,database,ui-registry}`、`demo/ping` 四个插件目录,其余仅建空目录占位。

### 0.4 三条会话仪式(写入 CLAUDE.md,每会话自动执行)

1. **开场**:依次读 `CLAUDE.md → PLAN.md 相关节 → docs/p0-tutorial.md 当次会话节 → STATUS.md`,读完才动手。
2. **收场**:更新 `STATUS.md`(完成项/验收输出摘录/遗留问题/下一会话指针);按规范提交(中文 commit message,格式 `p0-s<N>: <做了什么>`)。
3. **实查沉淀**:凡 beta/rc 包行为与文档或记忆不符,用 `node -e "import('包').then(m=>console.log(Object.keys(m)))"` 实查,结论当场写入 `docs/notes/<包名>.md`。

### 0.5 CLAUDE.md 模板(会话 1 创建)

```markdown
# CLAUDE.md

本项目:插件化综合素质测评系统(毕设)。当前阶段:P0(见 docs/p0-tutorial.md)。

## 每次会话必做

1. 开场读:本文件 → PLAN.md 相关节 → docs/p0-tutorial.md 当次会话节 → STATUS.md
2. 遵守 PLAN.md §9 全部工程纪律(锁版本/实查代替记忆/effect 纪律/命名纪律/契约洁癖)
3. 收场:更新 STATUS.md,提交格式 `p0-s<N>: <描述>`,中文注释与提交信息

## 禁止

- 重启技术选型讨论(PLAN §3 已定案)
- 照搬 oRPC v1 教程(v2 破坏性变更见 PLAN §4.8)
- 裸副作用(必须 ctx.effect)
- 自由发挥目录结构(以 docs/p0-tutorial.md §0.3 为准)
```

### 0.6 STATUS.md 模板

```markdown
# STATUS

阶段:P0 / 最近会话:s<N>(<日期>)

## 已完成

- [s1] 仓库奠基:pnpm i 零报错;pg 连通

## 验收输出摘录

- s1: `psql -h localhost -U qualy -c 'select 1'` → 1 row

## 遗留/阻塞

- (无)

## 下一会话

- s2:cordis 启动闭环,注意 hmr 风险预案
```

### 0.7 通用开场提示词模板(你发给 Claude Code 用)

> 执行 P0 会话 <N>。先按 CLAUDE.md 开场仪式读文档;严格按 docs/p0-tutorial.md「会话 <N>」节操作,目录与命名不得自由发挥;完成后跑该节全部验收命令并把输出贴进 STATUS.md;遇到 <本会话风险点> 按预案处理,限时后记录并停下,不要硬闯。

---

## 会话 1 · 仓库奠基

**目标**:骨架文件全部就位,不写任何业务代码。

**步骤**:

1. `git init && pnpm init`;创建 §0.3 全部目录(空目录放 `.gitkeep`)。
2. `pnpm-workspace.yaml`(共享框架依赖统一走 catalog,各包内写 `"cordis": "catalog:"`,禁止写具体版本;插件独享依赖正常声明):

```yaml
packages:
  - packages/*
  - packages/plugins/*/*
  - apps/*
catalog:
  cordis: 4.0.0-rc.7
  "@cordisjs/plugin-loader": 1.0.0-rc.5
  "@cordisjs/plugin-include": 1.0.4
  "@cordisjs/plugin-hmr": 1.0.15
  "@orpc/server": 2.0.0-beta.21
  "@orpc/contract": 2.0.0-beta.21
  "@orpc/openapi": 2.0.0-beta.21
  "@orpc/client": 2.0.0-beta.21
  zod: 4.4.3
  tsx: 4.23.1
```

3. `tsconfig.base.json`(Node 侧基准;web 侧包自行 extends 并覆写 `"types": []` 或 `["vite/client"]`、lib 加 DOM、`"jsx": "react-jsx"`。不用 NodeNext:cordis 生态 d.ts 内部相对导入无扩展名,NodeNext 解析不了,见 docs/notes/cordis.md。相对导入带 .ts 扩展名是软约定):

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "Preserve",
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
  },
}
```

根 `tsconfig.json` 是 solution 式类型检查入口(不参与构建),include 覆盖 scripts/db/packages 各 src 与 client;根 scripts 配 `"typecheck": "tsc -p . --noEmit"`,列入每次会话验收。

4. `docker-compose.yml`(P0 仅 pg;redis/minio 注释占位):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      { POSTGRES_USER: qualy, POSTGRES_PASSWORD: qualy, POSTGRES_DB: qualy }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: {} }
```

5. `.gitignore`:`node_modules`、`dist`、`**/*.gen.ts`、`.env*`。
6. 按 §0.5/§0.6 创建 CLAUDE.md 与 STATUS.md;PLAN.md 与三份 docs 由人工放入。
7. 根 `package.json` scripts 骨架:

```jsonc
{
  "scripts": {
    "dev": "node --expose-internals --env-file-if-exists=.env --import tsx packages/app/src/main.ts",
    "dev:web": "pnpm --filter web dev",
    "gen": "tsx scripts/gen-schema.ts && tsx scripts/gen-contracts.ts && tsx scripts/gen-plugins.ts",
    "db:generate": "tsx scripts/gen-schema.ts && drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "test": "vitest run",
  },
}
```

**验收**:`pnpm i` 零报错;`docker compose up -d` 后 `psql postgres://qualy:qualy@localhost:5432/qualy -c 'select 1'` 返回 1 row;`git log` 一条 `p0-s1` 提交。

---

## 会话 2 · cordis 启动闭环(高风险:hmr)

**目标**:cordis CLI 装载 TS 冒烟插件,hmr 粒度重载可用。

**步骤**:

1. 根 package.json 增加依赖(版本进 catalog):`cordis`、`@cordisjs/plugin-loader`、`@cordisjs/plugin-include`、`@cordisjs/plugin-logger-console`、`@cordisjs/plugin-timer`(hmr 的 peer,提供 ctx.debounce)、`tsx`、`zod`;dev 依赖 `@cordisjs/plugin-hmr`。dev 脚本需带 `--expose-internals`(hmr 依赖 loader.internal,见 docs/notes/hmr.md)。
2. `packages/plugins/demo/ping` 建包,package.json:

```jsonc
{
  "name": "@qualy/plugin-ping",
  "type": "module",
  "sideEffects": false,
  "exports": { ".": "./src/index.ts" },
}
```

`src/index.ts` 最小版(插件统一**具名导出**形态:模块命名空间即对象插件,loader 无 default 导出时整体使用,name/inject/Config/apply 各自有完整类型;禁用 default 导出函数 + 属性赋值,default 解包后元属性会丢失。函数插件体不要有返回值,返回值会被当作 effect 清理函数):

```ts
import type { Context } from "cordis";
import { z } from "zod";

export const name = "ping";

export const Config = z
  .object({ greeting: z.string().default("hi") })
  .prefault({});

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  ctx.logger.info("ping plugin loaded: %s", config.greeting);
  ctx.effect(() => {
    const t = setInterval(() => ctx.logger.info("heartbeat"), 30_000);
    return () => clearInterval(t);
  }, "heartbeat-timer");
}
```

3. 根 package.json dependencies 加 `"@qualy/plugin-ping": "workspace:*"`(§0.3 规则)。
4. 根 `cordis.yml`:

```yaml
- name: "@cordisjs/plugin-logger-console"
- name: "@cordisjs/plugin-timer"
- name: "@cordisjs/plugin-hmr" # 仅 dev;生产 yml 不含
  config:
    root: ["packages", "cordis.yml"] # 定则:loader 装载的代码目录 + 全部装配清单;include 零自监听,yml 热更靠 hmr watcher,见 notes/hmr.md
- name: "@qualy/plugin-ping"
  config: { greeting: "hello" }
```

(loader 启动后会写回 yml 并为每个条目补 `id:` 字段,属预期行为,id 提交进 git。)

5. `packages/app`(@qualy/app,后端宿主):`src/main.ts` 复刻 cordis bin.js 的四行逻辑(Context + baseUrl + Loader + include),再挂 SIGINT/SIGTERM 优雅关闭——根 `ctx.fiber.dispose()` 级联释放全部插件 effect,5s 超时与二次信号强退,成功后 exit(0)。dev 脚本指向它;直跑 node_modules/cordis/bin.js 属背景知识(bin 零信号处理,Ctrl+C 是硬杀,pnpm 会报 ELIFECYCLE)。SIGTERM 对应 docker stop,为部署铺路(PLAN §2.7)。
6. `pnpm i && pnpm dev`。

**验收**:启动打印「ping 插件已装载: 你好P0」;修改 greeting 字符串保存,观察 hmr 触发该插件重载(日志重新打印,进程不重启);把 config 改成 `greeting: 123`,启动报 ValidationError 并指明字段(验完改回)。

**风险预案(限时 2 小时)**:若 hmr 对 tsx 装载的 TS 模块监听异常——现象为改文件无反应或全量崩溃——退路:ping 包加 `tsup --watch` 产出 dist,exports 与 yml 指向 dist 产物,hmr 监听 js。无论走哪条路,把结论与理由写入 `docs/notes/hmr.md`,STATUS.md 记录决定。**不要在此消耗超过 2 小时。**

---

## 会话 3 · 生成器基建 + database 插件

**目标**:schema 聚合流水线通,pg 里建出 ping_logs 表。

**步骤**:

1. `scripts/lib/read-entries.ts`:

```ts
import fs from "node:fs";
import YAML from "yaml";
export interface Entry {
  name: string;
  config?: any;
  disabled?: boolean;
}
export const readEntries = (): Entry[] =>
  YAML.parse(fs.readFileSync("cordis.yml", "utf8")).filter(
    (e: Entry) => !e.disabled,
  );
export const hasExport = (name: string, sub: string) => {
  try {
    import.meta.resolve(`${name}/${sub}`);
    return true;
  } catch {
    return false;
  }
};
```

2. `scripts/gen-schema.ts`:

```ts
import fs from "node:fs";
import { readEntries, hasExport } from "./lib/read-entries.ts";
const lines = ["// 由 gen-schema.ts 生成,勿手改"];
for (const e of readEntries()) {
  if (e.name.startsWith("@qualy/") && hasExport(e.name, "schema"))
    lines.push(`export * from '${e.name}/schema'`);
}
fs.mkdirSync("db", { recursive: true });
fs.writeFileSync("db/schema.gen.ts", lines.join("\n") + "\n");
console.log("schema.gen.ts 写入完成");
```

(设计前瞻,见 PLAN §2.7:三个生成器都要支持 `--all` 模式——发行构建按全量超集聚合、忽略 disabled;开发默认按 yml 过滤。落地时给 readEntries 加参数即可,本会话实现该参数但 dev 流程不使用。)

3. 依赖(先实查版本进 catalog):`drizzle-orm`、`drizzle-kit`、`pg`、`@types/pg`(pg 8.x 不带类型声明,strict 下缺它必报 TS7016)、`yaml`。database 包 dependencies 写 drizzle-orm、pg(catalog:),devDependencies 写 @types/pg;根 devDependencies 加 drizzle-kit、yaml(db:generate 与 gen 脚本的直接依赖,pnpm 严格 node_modules 下必须显式声明)。`packages/plugins/infra/database`(包名 `@qualy/plugin-database`,根加 workspace 依赖,yml 加条目并置于 ping 之前;Config 必须给默认值,否则 yml 无 config 时启动即 ValidationError 退出):

```ts
import { Context, Service } from "cordis";
import type { AnyRelations } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

declare module "cordis" {
  interface Context {
    db: Database;
  }
}

const localFallback = "postgres://qualy:qualy@localhost:5432/qualy";

export default class Database extends Service {
  static Config = z
    .object({
      url: z.string().default(() => process.env.DATABASE_URL ?? localFallback),
    })
    .prefault({});

  private pool!: Pool;
  private views = new WeakMap<AnyRelations, unknown>();
  drizzle!: NodePgDatabase;

  constructor(
    ctx: Context,
    private config: z.infer<typeof Database.Config>,
  ) {
    super(ctx, "db");
    if (!process.env.DATABASE_URL && config.url === localFallback) {
      ctx.logger.warn("DATABASE_URL is not set, falling back to %s", localFallback);
    }
  }

  async *[Service.init]() {
    const pool = new Pool({ connectionString: this.config.url });
    pool.on("error", (error) => this.ctx.logger.error("idle client error: %s", error.message));
    // dependents activate only after init completes, so this await is a real gate
    await pool.query("select 1");
    this.pool = pool;
    this.drizzle = drizzle({ client: pool });
    yield () => pool.end();
  }

  withRelations<TRelations extends AnyRelations>(relations: TRelations): NodePgDatabase<TRelations> {
    let view = this.views.get(relations) as NodePgDatabase<TRelations> | undefined;
    if (!view) {
      view = drizzle({ client: this.pool, relations });
      this.views.set(relations, view);
    }
    return view;
  }
}
```

要点:异步初始化必须放 `async *[Service.init]()`,构造器 effect 拦不住依赖方(notes/cordis.md);v1 的 pg 驱动无 `schema` 选项(RQB v2 改 relations,notes/drizzle.md);类插件的 name 即类名(hyphenate 后作 logger 名),不能覆写 static name。

4. ping 包补 `./schema` 导出与 `src/schema.ts`(pingLogs 表统一用 `snakeCase.table`:id `uuid().primaryKey().default(sql\`uuidv7()\`)`(PG18 原生,DDL 兜底一切写入路径)、name text notNull、createdAt timestamptz defaultNow notNull),dependencies 加 `"drizzle-orm": "catalog:"`(pnpm 严格 node_modules 下不声明则解析失败),并补具名导出 `export const inject = ["db"]`(暂不使用 db,仅验证门控)。
5. 根 `drizzle.config.ts`:schema 指 `./db/schema.gen.ts`,out `./db/migrations`,dialect postgresql,url 取 `process.env.DATABASE_URL`(strict 下需断言或 fallback)。顶部必须自行加载 .env(drizzle-kit 独立 CLI 不经过 dev 脚本的 --env-file):

```ts
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
```

6. `.env` 写 `DATABASE_URL=postgres://qualy:qualy@localhost:5432/qualy`(已在 gitignore)。

**验收**:`pnpm gen`(本会话 gen 管线只含 gen-schema;**不写占位空壳脚本**,gen-contracts/gen-plugins 在会话 5/7 落地时再加入管线;生成器统一走 scripts/lib/codegen.ts 的 writeGenerated,自带 banner、write-if-changed 与 mkdirSync)→ `pnpm db:generate --name <名>`(**迁移必须命名**)`&& pnpm db:migrate` → `psql ... -c '\d ping_logs'` 显示表结构且 id 默认值为 uuidv7();`pnpm dev` 正常(ping 被 db 的 Service.init 门控;停用 database 条目 ping 回卷、恢复后自动重载);`pnpm typecheck` 零错误。

---

## 会话 4 · server 插件 + oRPC v2 接入(高风险:beta API)

v2 完整文档（文档最前面为TOC，然后是详细内容，共14000+行）见 `docs/orpc-v2-docs.md`。

**目标**:HTTP 链路通(空路由 404),contribute/rebuild 机制就位。

**开场实查仪式(必做,结果写 `docs/notes/orpc-v2.md`)**:

```bash
node -e "import('@orpc/server').then(m=>console.log('server:',Object.keys(m).join(',')))"
node -e "import('@orpc/server/plugins').then(m=>console.log('plugins:',Object.keys(m).join(',')))"
node -e "import('@orpc/server/node').then(m=>console.log('node:',Object.keys(m).join(',')))"
node -e "import('@orpc/openapi/node').then(m=>console.log('openapi/node:',Object.keys(m).join(',')))"
```

已实测基线(PLAN §4.8–4.10):`oc.route()` 已移除,路由用 `oc.meta(openapi({ method, path }))`;`OpenAPIHandler` 在 `@orpc/openapi/node`;闭环模式 contract → `implement` → handler → `handler.handle(req,res,{prefix,context})`。**CORSPlugin/onError 的确切位置以本次实查为准。**

**步骤**:根 package.json 加 oRPC 四包 `2.0.0-beta.21`;建 `packages/plugins/infra/server`(`@qualy/plugin-server`,根 workspace 依赖 + yml 条目置于 database 之后 ping 之前),代码:

```ts
import { Context, Service } from "cordis";
import { createServer, type Server } from "node:http";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { z } from "zod";
// CORSPlugin / onError 按实查结果 import

declare module "cordis" {
  interface Context {
    server: ServerService;
  }
}
export interface ApiContext {
  cordis: Context;
}

export class ServerService extends Service {
  static Config = z.object({
    port: z.number().int().default(3000),
    prefix: z.string().default("/api"),
  });
  private fragments = new Map<string, any>();
  private handler!: OpenAPIHandler<ApiContext>;
  private http!: Server;

  constructor(
    ctx: Context,
    private config: z.infer<typeof ServerService.Config>,
  ) {
    super(ctx, "server");
    this.rebuild();
    ctx.effect(() => {
      this.http = createServer(async (req, res) => {
        const r = await this.handler.handle(req, res, {
          prefix: this.config.prefix as `/${string}`,
          context: { cordis: this.ctx },
        });
        if (!r.matched) {
          res.statusCode = 404;
          res.end("Not Found");
        }
      });
      this.http.listen(this.config.port);
      this.ctx.logger.info("http server listening on :%d", this.config.port);
      // 必须返回 Promise 等端口真正释放:cordis 会 await 处置返回值,
      // 返回裸 this.http.close() 时旧 fd 未释放就重建监听,hmr 重载或改 port 热更时 EADDRINUSE 崩进程
      return () =>
        new Promise<void>((resolve) => {
          this.http.closeAllConnections();
          this.http.close(() => resolve());
        });
    });
  }

  contribute(ns: string, router: any) {
    return this.ctx.effect(() => {
      if (this.fragments.has(ns)) throw new Error(`路由命名空间冲突: ${ns}`);
      this.fragments.set(ns, router);
      this.rebuild();
      return () => {
        this.fragments.delete(ns);
        this.rebuild();
      };
    }, `route:${ns}`);
  }

  private rebuild() {
    this.handler = new OpenAPIHandler(Object.fromEntries(this.fragments), {
      /* plugins/interceptors 按实查补 */
    });
  }
}
export default ServerService;
```

**验收**:`pnpm dev` 后 `curl -i localhost:3000/api/anything` 返回 404(链路通、无路由);`docs/notes/orpc-v2.md` 已含四条探针输出。

---

## 会话 5 · ping 后端全链路 + 契约聚合 + api-client

**目标**:契约先行的 GET 接口落库返回;停用插件 = 接口真 404。

**步骤**:

1. ping 包 exports 补 `"./contract": "./src/contract.ts"`,`src/contract.ts`(**禁止依赖 drizzle**):

```ts
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

export const pingContract = {
  hello: oc
    .meta(openapi({ method: "GET", path: "/ping/hello" }))
    .input(z.object({ name: z.string().optional() }))
    .output(z.object({ msg: z.string() })),
};
```

2. `src/index.ts` 全量替换:

```ts
import type { Context } from "cordis";
import { implement } from "@orpc/server";
import { z } from "zod";
import { pingContract } from "./contract.ts";
import { pingLogs } from "./schema.ts";
import type { ApiContext } from "@qualy/plugin-server";

export const name = "ping";
export const inject = ["server", "db"];

export const Config = z
  .object({ greeting: z.string().default("hi") })
  .prefault({});

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  const impl = implement(pingContract).$context<ApiContext>(); // $context 形态若不符,以类型提示实查为准并记 notes
  ctx.server.contribute(
    "ping",
    impl.router({
      hello: impl.hello.handler(async ({ input, context }) => {
        await context.cordis.db.drizzle
          .insert(pingLogs)
          .values({ name: input.name ?? "world" });
        return { msg: `${config.greeting}, ${input.name ?? "world"}` };
      }),
    }),
  );
}
```

3. `scripts/gen-contracts.ts`(替换占位):

```ts
import fs from "node:fs";
import { readEntries, hasExport } from "./lib/read-entries.ts";
const imports = ["// 由 gen-contracts.ts 生成,勿手改"],
  fields: string[] = [];
for (const [i, e] of readEntries().entries()) {
  if (!e.name.startsWith("@qualy/") || !hasExport(e.name, "contract")) continue;
  const ns = e.name.split("/").pop()!.replace("plugin-", "");
  imports.push(`import * as m${i} from '${e.name}/contract'`);
  fields.push(`  ${ns}: Object.values(m${i})[0]!,`);
}
imports.push(
  "",
  "export const appContract = {",
  ...fields,
  "} as const",
  "export type AppContract = typeof appContract",
);
fs.writeFileSync(
  "packages/api-client/src/contracts.gen.ts",
  imports.join("\n") + "\n",
);
console.log("contracts.gen.ts 写入完成");
```

4. `packages/api-client`(`@qualy/api-client`;依赖 @orpc/client、@orpc/contract、@orpc/openapi):

```ts
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/client"; // 位置实查,不符记 notes
import type { ContractRouterClient } from "@orpc/contract";
import { appContract, type AppContract } from "./contracts.gen.ts";

export function createApiClient(url: string) {
  const link = new OpenAPILink(appContract, { url });
  return createORPCClient<ContractRouterClient<AppContract>>(link);
}
export type AppClient = ReturnType<typeof createApiClient>;
```

**验收四连**:`pnpm gen && pnpm dev` 后 (a) `curl 'localhost:3000/api/ping/hello?name=毕设'` 200 且含问候;(b) `psql -c 'select count(*) from ping_logs'` 递增;(c) 根下写临时脚本 `node --import tsx -e "import('./packages/api-client/src/index.ts').then(async m=>{const c=m.createApiClient('http://localhost:3000/api');console.log(await c.ping.hello({name:'client'}))})"` 输出 msg;(d) **cordis.yml 将 ping 置 `disabled: true`,重启后 (a) 的 curl 变 404,恢复后再 200**。

---

## 会话 6 · ui-registry + manifest

**目标**:manifest 由插件贡献点驱动,匿名可访问。

**步骤**:建 `packages/plugins/infra/ui-registry`(`@qualy/plugin-ui-registry`,workspace 依赖 + yml 条目):`src/contract.ts` 定义 `getManifest`(GET `/ui/manifest`,input 空对象,output `{ pages: PageOut[], nav: NavOut[] }` 的 zod);`src/index.ts`:

```ts
import { Context, Service } from "cordis";
import { implement } from "@orpc/server";
import { uiContract } from "./contract.ts";
import type { ApiContext } from "@qualy/plugin-server";

declare module "cordis" {
  interface Context {
    ui: UiRegistry;
  }
}

export interface PageDecl {
  path: string;
  component: string;
  layout: "admin" | "blank";
  public?: boolean;
  permission?: string;
  nav?: { label: string; icon?: string; order?: number };
}

export class UiRegistry extends Service {
  private pages = new Map<string, PageDecl>();
  constructor(ctx: Context) {
    super(ctx, "ui");
    const impl = implement(uiContract).$context<ApiContext>();
    ctx.inject(["server"], (ctx) => {
      ctx.server.contribute(
        "ui",
        impl.router({
          getManifest: impl.getManifest.handler(() => this.build()),
        }),
      );
    });
  }
  addPage(p: PageDecl) {
    return this.ctx.effect(() => {
      this.pages.set(p.path, p);
      return () => this.pages.delete(p.path);
    }, `page:${p.path}`);
  }
  private build() {
    const visible = [...this.pages.values()]; // P1 在此接 RBAC 过滤
    return {
      pages: visible.map(({ nav, ...rest }) => rest),
      nav: visible
        .filter((p) => p.nav)
        .map((p) => ({ path: p.path, ...p.nav! }))
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    };
  }
}
export default UiRegistry;
```

ping 插件 inject 加 `'ui'`,函数体加:

```ts
ctx.ui.addPage({
  path: "/ping",
  layout: "admin",
  component: "PingPage",
  public: true,
  nav: { label: "Ping 演示", order: 10 },
});
```

**验收**:`curl localhost:3000/api/ui/manifest` 返回含 /ping 的 pages 与 nav;yml 停用 ping → manifest 两处条目消失(同时接口 404,双重验证贡献点 effect 化)。

---

## 会话 7 · web-runtime + 前端壳

**目标**:前端由 manifest 驱动渲染,插件组件独立 chunk,树摇可证。

**前置(本会话必做)**:web 侧 .tsx 进仓后根 tsconfig 的单工程 include 会把它们扫进 Node 侧编译(无 jsx/DOM)而挂掉 typecheck。把根 tsconfig.json 改为真 solution(根 `{ "files": [], "references": [...] }`,typecheck 脚本改 `tsc -b`),Node 侧一个子 tsconfig(scripts/db/插件 src/api-client),web-runtime 与各插件 client 各自 tsconfig(extends base,覆写 jsx: react-jsx、lib 加 DOM、types: [])。另外顺序固定:先 `pnpm create vite` 脚手架(vite 对非空目录会交互确认),再跑 `pnpm gen` 产出 plugins.gen.ts。

**步骤**:

1. `packages/web-runtime`(`@qualy/web-runtime`;依赖 react,类型依赖 @qualy/api-client;tsconfig 自建 extends base + `"jsx": "react-jsx"`):

```tsx
import {
  createContext,
  useContext,
  Suspense,
  type LazyExoticComponent,
  type ComponentType,
} from "react";
import type { AppClient } from "@qualy/api-client";

export type Manifest = Awaited<ReturnType<AppClient["ui"]["getManifest"]>>;
export interface Runtime {
  client: AppClient;
  manifest: Manifest | null;
  registry: Record<string, LazyExoticComponent<ComponentType<any>>>;
}
const RuntimeContext = createContext<Runtime | null>(null);
export function RuntimeProvider({
  value,
  children,
}: {
  value: Runtime;
  children: React.ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}
export function useRuntime() {
  const r = useContext(RuntimeContext);
  if (!r) throw new Error("必须在 RuntimeProvider 内使用");
  return r;
}
export const useApi = () => useRuntime().client;
export const useManifest = () => useRuntime().manifest;
export function Slot({ id }: { id: string }) {
  const { manifest, registry } = useRuntime();
  const widgets = (manifest as any)?.widgets?.[id] ?? []; // P0 恒为空,P1 启用
  return (
    <>
      {widgets.map((w: any, i: number) => {
        const C = registry[w.component];
        return C ? (
          <Suspense key={i} fallback={null}>
            <C />
          </Suspense>
        ) : null;
      })}
    </>
  );
}
```

2. ping 包 exports 补 `"./client": "./client/index.ts"`,并声明 client 侧依赖:`"@qualy/web-runtime": "workspace:*"` 与 `"react": "catalog:"`(catalog 补 react/react-dom/react-router 精确版本;§0.3 规则:插件带 client 目录必须自声明 react 与 web-runtime,pnpm 严格 node_modules 下靠根解析必失败)。`client/index.ts` 只导出 thunk 表:

```ts
export const components = { PingPage: () => import("./PingPage.tsx") };
```

`client/PingPage.tsx`(**只依赖 web-runtime,禁止反向 import 壳**):

```tsx
import { useEffect, useState } from "react";
import { useApi } from "@qualy/web-runtime";
export default function PingPage() {
  const api = useApi();
  const [msg, setMsg] = useState("…");
  useEffect(() => {
    api.ping.hello({ name: "前端" }).then((r) => setMsg(r.msg));
  }, []);
  return <h2>{msg}</h2>;
}
```

3. `scripts/gen-plugins.ts`(替换占位;与 gen-contracts 同构,收集 `/client` 的 components 并合并 spread,输出 `apps/web/src/plugins.gen.ts` 导出 `export const components = {...}`)。
4. `apps/web`:`pnpm create vite apps/web --template react-ts`;依赖加 react-router、@qualy/api-client、@qualy/web-runtime;vite.config 加 dev 代理 `'/api' → 'http://localhost:3000'`;`src/App.tsx`:

```tsx
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Outlet } from "react-router";
import { createApiClient } from "@qualy/api-client";
import { RuntimeProvider, type Manifest } from "@qualy/web-runtime";
import { components } from "./plugins.gen";

const client = createApiClient("/api");
const registry = Object.fromEntries(
  Object.entries(components).map(([k, t]) => [k, lazy(t as any)]),
) as any;

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    client.ui.getManifest({}).then(setManifest);
  }, []);
  const runtime = useMemo(() => ({ client, manifest, registry }), [manifest]);
  if (!manifest) return null;
  const pages = (l: string) =>
    manifest.pages.filter((p: any) => p.layout === l);
  return (
    <RuntimeProvider value={runtime}>
      <BrowserRouter>
        <Routes>
          <Route element={<AdminLayout nav={manifest.nav} />}>
            {pages("admin").map((p: any) => {
              const C = registry[p.component];
              return (
                <Route
                  key={p.path}
                  path={p.path}
                  element={
                    C ? (
                      <Suspense fallback="加载中">
                        <C />
                      </Suspense>
                    ) : (
                      <p>渲染器缺失:{p.component}(降级)</p>
                    )
                  }
                />
              );
            })}
          </Route>
          {/* blank 布局同构;P0 无 blank 页可留空 */}
        </Routes>
      </BrowserRouter>
    </RuntimeProvider>
  );
}
function AdminLayout({ nav }: any) {
  return (
    <div style={{ display: "flex" }}>
      <nav style={{ width: 200 }}>
        {nav.map((n: any) => (
          <div key={n.path}>
            <Link to={n.path}>{n.label}</Link>
          </div>
        ))}
      </nav>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}
```

5. `scripts/check-chunks.mjs`(树摇验证器):

```js
import fs from "node:fs";
const dir = "apps/web/dist/assets";
const hit =
  fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /PingPage/.test(f));
console.log(hit ? "PingPage 独立 chunk ✓" : "PingPage chunk 不存在 ✗");
process.exit(hit ? 0 : 1);
```

**验收(全部命令化)**:(a) 后端起、`pnpm dev:web`,浏览器人工走查:侧边栏「Ping 演示」、页面显示问候(此条留给人);(b) `pnpm gen && pnpm --filter web build && node scripts/check-chunks.mjs` → ✓;(c) yml 停用 ping,`pnpm gen` 后重新 build,`node scripts/check-chunks.mjs` 退出码 1(✗ 即树摇成立),恢复。

---

## 会话 8 · 测试骨架 + 总验收固化

**目标**:插件测试模板落地;P0 报告归档;打 tag。

**步骤**:

1. 根 devDependencies 加 vitest;`packages/plugins/demo/ping/tests/ping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Context } from "cordis";
import * as ping from "../src/index.ts";

describe("plugin-ping", () => {
  it("装载注册路由与页面,卸载后全部清理", async () => {
    const ctx = new Context();
    const routes = new Map(),
      pages = new Map();
    ctx.provide("server", {
      contribute: (ns: string, r: any) =>
        (ctx as any).effect(() => {
          routes.set(ns, r);
          return () => routes.delete(ns);
        }),
    });
    ctx.provide("ui", {
      addPage: (p: any) =>
        (ctx as any).effect(() => {
          pages.set(p.path, p);
          return () => pages.delete(p.path);
        }),
    });
    ctx.provide("db", {
      drizzle: { insert: () => ({ values: async () => {} }) },
    });

    const fiber = ctx.plugin(ping, { greeting: "测" });
    await fiber;
    expect(routes.has("ping")).toBe(true);
    expect(pages.has("/ping")).toBe(true);
    await fiber.dispose();
    expect(routes.size).toBe(0);
    expect(pages.size).toBe(0);
  });
});
```

同构地给 database/server/ui-registry 各补一个最小「装载→就绪→卸载→清理」测试(server 测 contribute 冲突抛错与卸载后 fragments 清空,可不起真 http:端口 0 或将 listen 包在可注入开关后)。

2. 逐条执行下表并将命令输出摘录进 `docs/reports/P0-REPORT.md`:

| #   | 验收项            | 命令                                                              |
| --- | ----------------- | ----------------------------------------------------------------- |
| 1   | 一条龙启动        | `docker compose up -d && pnpm gen && pnpm db:migrate && pnpm dev` |
| 2   | 接口 200 落库     | curl + psql count                                                 |
| 3   | manifest 驱动前端 | 会话 7(a) 人工走查记录                                            |
| 4   | 停用零重建        | yml disabled → curl 404 + manifest 无条目                         |
| 5   | 树摇成立          | check-chunks 两态(✓/✗)                                            |
| 6   | hmr 粒度重载      | 改 greeting 观察日志(附 notes/hmr.md 结论)                        |
| 7   | 配置校验拦截      | 非法 config → ValidationError 截屏/输出                           |
| 8   | vitest 全绿       | `pnpm test`                                                       |

3. `git tag v0.1.0-p0`;STATUS.md 收场,指针指向 P1。

---

## 附 · 坑速查(实测来源,新增路径类)

| 症状                              | 原因与解法                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `oc.route is not a function`      | v2 移除,改 `oc.meta(openapi({ method, path }))`                                         |
| loader 报找不到 `@qualy/plugin-x` | 忘在根 package.json 加 `workspace:*`(§0.3 双动作规则)                                   |
| gen 脚本静默跳过某插件            | 同上,`import.meta.resolve` 解析失败被 hasExport 吞掉                                    |
| 启动报不认识 .ts                  | 忘了 `NODE_OPTIONS='--import tsx'`                                                      |
| drizzle-kit 找不到 schema         | 先 `pnpm gen`;聚合文件是生成物且被 gitignore                                            |
| 插件偶发「服务未就绪」            | 缺 `inject` 声明;禁止假设 yml 顺序即就绪顺序                                            |
| 前端 import 壳失败/循环依赖       | 插件 client 只准依赖 `@qualy/web-runtime`,禁止反向引用 apps/web                         |
| beta 导出位置对不上               | `node -e "import('x').then(m=>console.log(Object.keys(m)))"` 实查并记 docs/notes/       |
| 升级后行为变化                    | rc/beta 精确锁版本;升级单独分支                                                         |
| config 缺失时字段默认值不生效     | 顶层被写成 `.default({})`;Zod 4 中它短路跳过字段解析,必须用 `.prefault({})`             |
| 启动/重载报 Invalid effect        | 函数插件体隐式返回了非函数值(箭头函数单表达式体慎用);插件返回值会被当作 effect 清理函数 |
| 相对导入报 TS2835/TS2307          | 补 `.ts` 扩展名(软约定);别把 base 切回 NodeNext,cordis 生态 d.ts 不兼容                 |
| 改 cordis.yml 不热更了            | hmr root 漏了装配清单;include 零自监听,root 必须含 cordis.yml(见 notes/hmr.md)          |
| 改完源码后插件配置"变回去了"      | hmr 源码重载以启动时 config 复插,不随 yml 热更同步;真改一次 yml 值或重启 dev 恢复        |
| drizzle 代码出现陌生 API          | v0/v1 教程混杂,先跑导出探针再信(casing/RQB/迁移结构 v1 全变了,见 notes/drizzle.md)      |
| 服务字段在依赖方里是 undefined    | 异步初始化写在了构造器 effect 里;必须搬进 `async *[Service.init]()`(见 notes/cordis.md) |
| 停用插件后 generate 想 DROP 表    | schema 聚合必须恒超集(gen-schema 已定案);只有从 yml 删除条目才显式产出 DROP 并人工审阅  |
| 要写 function/trigger 等手工 SQL  | `pnpm db:custom --name <插件>-<描述>`(drizzle-kit generate --custom 空迁移,同账本)     |
