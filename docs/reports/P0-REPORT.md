# P0 总验收报告(2026-08-02)

> 逐条真实执行,命令输出原样摘录。环境:macOS / Node 24.18.0 / pnpm 11.8.0 / PG 18.4(容器 pgvector/pgvector:pg18-bookworm)。
> 基线提交见 tag `v0.1.0-p0`;八项定义出自 docs/p0-tutorial.md 会话 8。

## 1. 一条龙启动

```
$ docker compose up -d && pnpm dev
[✓] migrations applied successfully
[I] hmr watching [ 'packages' ] in /Users/hangqi/Workspace/Web/qualy/
[I] server http server listening on :3000
[I] database connected to localhost:5432/qualy (27ms)
[I] ping ping plugin loaded: hello
```

dev 脚本内置"先 migrate 后 start";数据库探活门控依赖方(Service.init)。**通过**

## 2. 接口 200 落库

```
$ curl --get localhost:3000/api/ping/hello --data-urlencode name=P0验收
{"msg":"hello, P0验收"}
$ psql -tc 'select count(*) from ping_logs'
26        # 随请求递增,中文值往返无损
```

**通过**

## 3. manifest 驱动前端

```
$ curl localhost:3000/api/ui/manifest
{"pages":[{"path":"/ping","component":"PingPage","layout":"admin","public":true}],
 "nav":[{"path":"/ping","label":"Ping","order":10}]}
```

浏览器人工走查(侧边栏「Ping」、页面显示问候):**由人工完成,留空**。接口侧**通过**

## 4. 停用零重建

```
yml 置 ping disabled: true(运行中热应用,无重启无重建)
$ curl -i /api/ping/hello         → HTTP/1.1 404 Not Found
$ curl /api/ui/manifest           → {"pages":[],"nav":[]}
恢复条目
$ curl -i /api/ping/hello         → HTTP/1.1 200 OK
```

路由与 manifest 双重消失/恢复,全程热生效(贡献点 effect 摘除)。**通过**

## 5. 树摇成立(两态)

```
启用态:$ pnpm build && tsx apps/web/scripts/check-chunks.ts
  dist/assets/PingPage-*.js 0.26 kB    → PingPage: chunk present(exit 0)
停用态:yml disabled → gen → build → check-chunks --expect-absent PingPage
  → PingPage: absent as expected(exit 0)
```

禁用插件不进模块图,chunk 零字节。**通过**

## 6. hmr 粒度重载

```
改 ping 源码保存 →
[I] hmr reload plugin at packages/plugins/demo/ping/src/index.ts
进程不重启;server 插件重载序列 closed → listening 无 EADDRINUSE(见 notes/hmr.md、notes/orpc-v2.md)
```

**通过**

## 7. 配置校验拦截

```
yml greeting: 123(热应用)→
[E] include ValidationError: invalid config:
  - Invalid input: expected string, received number (at greeting)
旧实例存活,改回自动恢复;启动期同错则拒绝启动(s2 实测)
```

**通过**

## 8. vitest 全绿

```
$ pnpm test
Test Files  6 passed (6)
     Tests  8 passed (8)
```

覆盖:server/ui-registry/ping 生命周期(真 HTTP,临时端口,冲突拒绝,disposal 断言)、
PGlite(PG 18.3)全新库重放迁移 + uuidv7 断言 + RQB v2 查询、
生成器确定性(双跑 byte-identical、disabled/--all 两态)、
不变式(停用不改变 schema 聚合)、api-client 类型活性(@ts-expect-error 哨兵)。**通过**

---

八项全部通过(第 3 项接口侧通过,浏览器走查留人工)。P0 两大灵魂命题闭环:
**停用插件零重建生效**(第 4 项)与**剔除插件后前端树摇成立**(第 5 项),均有自动化哨兵看护(vitest + check-chunks)。

---

## 附:当前 HEAD 补充验收(2026-08-02,P1 入场基线 p1-base)

原报告验收于 v0.1.0-p0,其前端项描述的是独立 Vite 服务与 /api 代理。此后架构变更:
server 增单槽 Connect fallback、@qualy/plugin-web 单进程交付(dev 挂 Vite middleware、
prod 走 sirv staged 产物)、traceable 代理可变槽修复、装配清单更名 qualy.yml、
静音迁移脚本与 vite 日志归一、web 壳补 index 重定向与 404 页。旧 tag 不动,
在当前 HEAD 重跑全量验收后另打不可变基线 tag `p1-base`。

静态门禁(逐条实跑):

```
pnpm install --frozen-lockfile → 0
pnpm gen → 0
pnpm typecheck → 0
pnpm test → Test Files 8 passed / Tests 11 passed
pnpm build → 0(gen --all → @qualy/web-app build → staging)
test -f packages/plugins/infra/web/client-dist/index.html → 0
tsx apps/web/scripts/check-chunks.ts → PingPage: chunk present
drizzle-kit check → Everything's fine
drizzle-kit generate(no-op)→ No schema changes;git diff db/migrations 干净
drop-guard → ok (0 file(s) scanned)
```

运行时三态(NODE_ENV 分流,单端口 3000):

```
dev:     / 200(Vite middleware),/ping 200,/api/ping/hello?name=P1 → {"msg":"hello, P1"},/api/not-found 404
prod:    / 200 HTML 且 Cache-Control: no-cache;/ping 深链 200 text/html;
         /api/not-found 404 "Not Found"(不回落 index.html);
         哈希资源 Cache-Control: public,max-age=31536000,immutable
headless(qualy.yml 停用 plugin-web): / 404,/api/ping/hello 正常 → 启用即必须可服务、停用即显式 headless 成立
```

新增测试覆盖:server fallback 槽生命周期(注册/api 内不触发/二次注册拒绝/dispose 撤销)、
plugin-web 生产态(spa 回退、缓存头两断言、缺产物启动硬失败)。

浏览器人工走查仍留人工(P1 第一个 commit 前补:/ping 页面、HMR、停用 ping 后导航消失、
控制台无 React 双实例/chunk 错误)。
