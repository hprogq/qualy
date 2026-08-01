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
