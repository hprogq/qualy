# @cordisjs/plugin-hmr 1.0.15 实查结论(2026-07-27)

结论:**hmr × tsx 在 Node 24 下可用,无需 tsup 退路**。风险预案未触发。

前提条件(缺一不可):

1. node 启动参数加 `--expose-internals`(已写入根 dev 脚本)。hmr 依赖 `ctx.loader.internal`(Node 内部 ESM CascadedLoader,经 `require('internal/modules/esm/loader').getOrInitializeCascadedLoader()` 获取),缺失时构造器直接抛 `--expose-internals is required for HMR service`。备选方案是 `node-addon-require-builtin` 原生插件,未采用。
2. 装载 `@cordisjs/plugin-timer`(hmr 的 peerDependency,提供 `ctx.debounce`)。hmr 通过装饰器 `Inject("loader")`、`Inject("timer")` 声明依赖,门控生效,yml 顺序无关。

实测行为:

- 修改插件 TS 源码保存 → `hmr reload plugin at packages/plugins/demo/ping/src/index.ts` → 仅该插件 fiber 重载,进程不重启,旧 effect(心跳定时器)干净释放,无重复心跳。
- hmr 自身配置用 schemastery 而非 zod(root 默认 `["."]`,debounce 100ms),与业务插件的 zod Config 并存无冲突。
- `node_modules/` 与 `node:` 开头的模块被 hmr 排除,externals 变更触发全量重载(未实测)。

- **watch 集合的定则:loader 装载的代码目录 + 全部装配清单文件**,当前为 `root: ["packages", "cordis.yml"]`。原因:include 插件**自身零文件监听**,cordis.yml 的热应用靠 hmr watcher 的 change 回调命中 `include.filename` 后调用 `include.refresh()` 实现(源码实证);root 里漏掉 yml 就会静默失去配置热更(踩过:曾收窄为仅 packages)。默认 `["."]` 则会监听整个仓库根(docs、db 等),编辑文档也进 watcher 扫描。packages 之外的启动入口 main.ts 属 externals,本就需手动重启。未来新增 include 文件(如 cordis.dev.yml)必须同步加进 root。
- **已知坑(rc 上游怪癖,实测两轮稳定复现):源码触发的插件重载会把该插件配置回退到进程启动时的值**——hmr 以 `oldFiber.config` 复插,该值不随 include 驱动的 yml 热更同步。且回退后仅 touch yml 无法修复(entry 层 options 无 diff 不触发更新),需真改一次 yml 值或重启 dev。日常影响小(改完源码顺手重启即可),但排查"配置怎么变回去了"时先想到它。

- 工具坑:`sed -i ''` 等原子替换会换 inode,watcher 可能从此丢失 cordis.yml(实测:一次 sed 后 yml 编辑不再触发热更,且当次还引发了全量 reconcile 连 server 都重启)。脚本改 yml 用保 inode 的写法(python `open(path, 'w')` 原地截断重写);手工编辑器保存无此问题。

生产 yml 不含 hmr 与 timer 条目;`--expose-internals` 仅存在于 dev 脚本,生产启动脚本与 Dockerfile(见 PLAN §2.7)不得携带,写 Dockerfile 时列为必查项。
