# Aube 2.2.0 spike

一次受控评估:能不能把包管理器从 pnpm 换成 Aube(jdx 的 Rust 实现,`mise registry` 里是
`aqua:jdx/aube`,2.2.0 发布于 2026-08-25)。**结论:现在不换。** 阻塞只有一条,但它是硬的;
除此之外的表现好得出乎意料。

基线是 pnpm 11.24.0 与它写的 `pnpm-lock.yaml`(见 STATUS.md「回到 pnpm 11」)。全部实测,
macOS arm64 + Linux x64(docker `node:24-bookworm`,`--platform linux/amd64`)。

## 结论表

| 关口                               | 结果                                              |
| ---------------------------------- | ------------------------------------------------- |
| 用 pnpm 的 lock 做 frozen install  | **失败**,两个独立原因                             |
| fresh resolution 与 pnpm 等价      | 版本层面**完全一致**;importer 层面分歧            |
| 全套门禁                           | typecheck、构建、浏览器套件全过;node 套件 894/896 |
| macOS arm64 / Linux x64            | 通过,两边写出**逐字节相同**的 lock                |
| Aube 写 lock → pnpm 11 frozen 读回 | **失败**(`ERR_PNPM_OUTDATED_LOCKFILE`)            |

## 阻塞:importer 里的自动装 peer

pnpm 与 Aube 都默认 `autoInstallPeers: true`,但对「哪些 peer 该记进 importer 自己的
dependencies」意见相反,而且是**两个方向都相反**:

- Aube **加**了 pnpm 没有的:`redis` 进 7 个 importer(它是 `@effect/platform-node` 的 peer)、
  `react`/`react-dom` 进根、`unplugin` 进 2 个 importer。
- Aube **删**了 pnpm 有的:`effect` 从三个 contract 包、`react` 从两个包——正是那些**自己在
  `peerDependencies` 里声明了它**的包。

于是两个方向的 frozen 检查都红:

```
# aube 读 pnpm 的 lock
× lockfile is out of date with package.json: packages/contracts/audit: manifest removed effect

# pnpm 11 读 aube 的 lock
ERR_PNPM_OUTDATED_LOCKFILE ... packages/core/telemetry: 1 dependencies were removed: redis@>=5.0.0 <7.0.0
```

这条对本仓库不是纸面差异。`apps/server/node_modules/redis` 在 Aube 树里**真的存在**,而没有任何
manifest 声明过它;装配层的插件解析恰恰建立在「没声明就 resolve 不到」之上
(`packages/core/assembly/src/metadata.ts` 从宿主 package.json 建 require)。反过来,
`packages/contracts/audit/node_modules/effect` 在 Aube 树里**不存在**,尽管该包声明了这条 peer——
今天不炸,只是因为根上也有一份 effect 兜着。

宽松回滚也救不回来:`pnpm install --no-frozen-lockfile` 能装上 Aube 写的 lock,但**不收敛**——
与原 lock 差约 100 行,`supports-color` 作为 `debug` 的可选 peer 渗进整片 babel 图。
(已排除是本地改动所致:把 patch 键改回原样重测,差异照旧。)真正的回滚路仍然是
`git checkout pnpm-lock.yaml`,那条永远有效。

## 次要不兼容:patch 键必须带版本

`patchedDependencies` 下 pnpm 接受不带版本的键,Aube 不接受:

```
× invalid patch key "@stylexjs/unplugin": missing version
```

改成 `'@stylexjs/unplugin@0.19.0'` 两边都认,代价是 lock 的 `patchedDependencies` 键跟着变。
patch 本身**确实生效**(实测 `interval.unref?.()` 在物化出来的两个文件里都在),lock 的 snapshot 键
也照 pnpm 的写法带了 `(patch_hash=...)`;只有虚拟store的目录名把 patch 身份丢了
(`@stylexjs+unplugin@0.19.0_unplugin@2.3.11`,没有 `patch_hash`)。同一版本同时以打过和没打过
两种形态出现在一个项目里才会撞车,少见,但值得知道。

## 好的部分,而且好得具体

**解析结果在版本层面完全一致。** `packages:` 421 对 421,**零差异**;`snapshots:` 422 对 422,
其中 14 个键不同——12 个纯粹是 peer 列表的排序(pnpm 写 `(react-dom)(react)`,Aube 写
`(react)(react-dom)`,同 peer 同版本)。只有两个是实质差异:`@lingui/core` 在 Aube 侧丢了
`@babel/core`/`@babel/types` 的 peer context;`@vitest/browser` 的 peer 集合不同。虚拟store两边都是
344 个目录。本仓库最在意的单实例全部成立:

```
react 19.2.8   react-dom 19.2.8   effect 4.0.0-rc.111
@mikro-orm/* 7.1.13   @mantine/* 9.5.2   kysely 0.29.5   vite 8.2.0   typescript 7.0.2
```

**门禁**:`typecheck` 零错;`test:browser` 225 passed;构建产出的 chunk 哈希与 pnpm 树**逐字节相同**
(`index-DkzEQYTp.js`、`shared-B4AE6Ojt.js` …);根 `prepare` 正常跑,`tsc --version` 仍是
`7.0.2+effect-tsgo.0.36.4`;`aube ignored-builds` 与 `allowBuilds` 策略**完全吻合**
(放行 argon2/esbuild,拒绝 cos-js-sdk-v5/msgpackr-extract);`pnpm-workspace.yaml` 的 catalog、
`packages`、`minimumReleaseAgeExclude` 都被原样读取。

**跨平台**:Linux x64 干净安装选对了全部平台产物(`@effect/tsgo-linux-x64`、`@esbuild/linux-x64`、
`@rolldown/binding-linux-x64-gnu`、`lightningcss-linux-x64-gnu`、argon2 的 `linux-x64` prebuild),
typecheck 在容器里也零错,而且写出的 lock 与 macOS 那份 **sha256 相同**(`14a48cd9…`)。

## 两个观察,不是结论

**一次装出了半棵树,却报成功。** 第一轮 Linux 安装后 `packages/plugins/base/auth-local/node_modules/argon2`
是**悬空软链**,`node_modules/.aube/argon2@0.45.1/` 整个不存在,而 `aube install` 退出 0 并打印了正常的
新增包清单。同一份仓库重装即修复,干净重跑也正常,**没能复现**,所以只当作一次观察记下来。相关的是随后
的诊断表现:`aube doctor` 点名了这棵树是 stale(还额外点出 `@effect/platform-node` 的 metadata 缺失),
而 `aube check` 说的是 `node_modules symlink tree is consistent (checked 0 packages)`——在一棵明确坏掉的
树上报了一致,而且检查了 0 个包。

**它顺手暴露了本仓库的一个潜在缺陷。** `tools/tests/assembly-resolve.test.ts` 有两个用例在 Aube 树下红,
根因不在 Aube:pnpm 会把**每个 workspace 包**都塞进 `node_modules/.pnpm/node_modules`,并由 bin shim
把那个目录写进 `NODE_PATH`,于是 vitest 里从任何地方——包括 testkit 造的、只链了 5 个插件的临时
workspace——都能 resolve 到 `@qualy/plugin-web`。这两个用例一直是靠这个副作用走到它们真正想断言的那步的。
实测:同一段代码脱离 vitest 直接跑,在 **pnpm 树下也 UNRESOLVED**。Aube 不设这个 `NODE_PATH`,
假象就没了。这与仓库自己「没声明就 resolve 不到」的纪律相抵触,值得单独修(在 `createWorkspace` 的链接
集合里补上该插件),与换不换包管理器无关。

## 什么时候重开这个评估

一条就够:**Aube 与 pnpm 对「自动装的 peer 是否进 importer」达成一致**,或者本仓库不再依赖
`autoInstallPeers`(把那些 peer 显式声明成 dependencies)。届时重跑本文的五道关口即可,尤其是最后一道——
能写出让 pnpm 11 `--frozen-lockfile` 读得下去的 lock,是「不再被锁死」这个诉求本身。

顺带定下的纪律已写进 STATUS.md:包管理器版本的变更单独成一次改动,只动版本号,跑完整门禁,并检查
lockfile diff;manifest 没动而 lockfile 大面积变化,默认视为异常。
