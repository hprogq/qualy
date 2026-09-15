# 挂载式 `.env`(FIFO)

日期:2026-09-16。实测环境:macOS 27,Node 24.20.0,Vite 8.2.0,Docker Compose v5.5.0。

Qualy 只使用标准的 `.env` / process environment 接口。**普通磁盘 `.env` 是默认方式,完全支持。**
开发者怎么保管自己的密钥是个人选择——普通 `.env`、shell 环境变量、任何 secret manager 都可以,
仓库不假设、不要求其中任何一种,也不包含任何 secret manager 的项目级配置。

本文只处理其中一种情况对运行时的影响:secret manager 可以把 `.env` **挂载为命名管道(FIFO)**,
每次有人打开就写入内容,密钥因此不落盘。1Password Environments 是一个兼容的例子,但不是项目
要求、不是推荐安装步骤,也不是依赖。

## 一、FIFO 不是「放在别处的文件」

先做最小复现实验,再决定代码。三条事实都是实测的(脚本见下):

| 行为                     | 普通文件 | FIFO                       |
| ------------------------ | -------- | -------------------------- |
| `fs.existsSync`          | true     | **true**                   |
| `fs.statSync().isFile()` | true     | **false**(`isFIFO()` 才是) |
| `fs.readFileSync`        | 可重复   | **每次消耗 writer 的一轮** |
| 无 writer 时读           | 立即返回 | **无限阻塞,无超时无报错**  |

```bash
mkfifo .env
while true; do printf 'PORT=3111\n' > .env; done &   # 一次 open 一轮
node -e "console.log(require('fs').readFileSync('.env','utf8'))"   # PORT=3111
kill %1
timeout 3 node -e "require('fs').readFileSync('.env','utf8')"      # exit 124:一直挂着
```

`node --env-file=.env`、`node --env-file-if-exists=.env`、`process.loadEnvFile()`
三者行为一致:FIFO 能读、读一次消耗一轮、没有 writer 时同样无限阻塞。
`util.parseEnv` 对内容没有任何特殊之处。

**所以「再读一遍」不是把同一件事做两次,而是换了一个问题,而且可能没有答案。**

## 二、开发态因此只读一次

改动前,`apps/server/src/dev/host.ts` 在每次 stage(后端重载、session 重载)都重新
读一次 `.env`,并且把 `.env` 放进 chokidar 的 bootstrap 监视目标——`.env` 一变就重建
整个 session。在 FIFO 下这两条都站不住:

- 每次 reload 都去 open 一次管道,writer 停了就整个 supervisor 卡死,终端上什么都
  不说;
- 「监视 `.env` 的变化」对管道没有意义,而且真的触发时,重建出来的世界用的是新一轮
  的值,和还在跑的进程已经用过的值不是同一份。

现在:

- `apps/server/src/dev/env.ts` 是唯一的读取点,`developmentEnv({envFile, manifest,
shell, notice})` 一次读入,返回不可变快照;
- `host.ts` 在模块顶层读一次,`env` 与 `origin` 都是 `const`,后端/Vite/其他 dev
  service 的每一次 fork 与每一次 reload 都继承同一份;
- `.env` 从 watch plan 的 bootstrap 里移除,`classify('/repo/.env')` 现在返回 `null`;
- 优先级不变:**`.env` 是基线,shell 里显式写的变量覆盖它**;
- `NODE_ENV` / `QUALY_DEV_SUPERVISED` / `QUALY_CONFIG` 的逻辑一个字没动。

**改环境变量 = 重启 `pnpm dev`。** 这本来就是老实的语义:一个进程已经用过的值,
再读一遍也收不回来。

一条 UX:`.env` 是 FIFO 时,启动会先打印

```text
dev  .env is a mounted environment; reading it once for this session
```

再去 open。理由是上表最后一行——没有 writer 时这一步无限阻塞,有这行的话终端上至少
留着「在等什么」,没有的话看起来就是 `pnpm dev` 无故不动。`statSync` 不会 open 管道,
所以这个判断本身是安全的。

## 三、Vite:`envDir: false`

先审计:全仓库 `import.meta.env` **零使用**(shell 的配置是运行时从服务端取的,
不烤进 bundle)。所以 Vite 这一侧没有任何东西需要 env file 提供。

读 pinned 的 vite@8.2.0 产物,两条事实:

- `envDir` 默认是 `resolvedRoot`,对 `apps/web` 就是 `apps/web/`——仓库根的 `.env`
  **本来就不在 Vite 的读取集合里**,`root` 也不在它的 chokidar 目标里;
- dev server 会 `chokidar.watch([... getEnvFilesForMode(mode, envDir) ...])`,并且
  `handleHMRUpdate` 里 `isEnv` 为真时直接 `restartServerWithUrls(server)`。

另外 vite 8 的 `loadEnv` 自己就认 FIFO:

```js
if (!stat || (!stat.isFile() && !stat.isFIFO())) return []
```

所以 `envDir: false` 在当前布局下不改变任何已发生的行为,它买的是**未来不会发生**:
往 `apps/web/` 放一个 `.env` 不会被读、不会被监视、不会触发 dev server 自重启。
代价为零——`import.meta.env` 的 `MODE` / `DEV` / `PROD` / `BASE_URL` 不受影响,
那四个不是从 env file 来的(`resolveConfig` 里 `env: {...userEnv, BASE_URL, MODE,
DEV, PROD}`)。

## 四、其他入口不受影响

| 入口                        | 怎么读 `.env`                    | FIFO 下                 |
| --------------------------- | -------------------------------- | ----------------------- |
| `pnpm dev`                  | `developmentEnv()` 一次          | 一次,session 内冻结     |
| `pnpm start`                | `node --env-file-if-exists=.env` | 一次,进程生命周期内冻结 |
| `pnpm qualy` / `pnpm seed`  | `process.loadEnvFile()`          | 一次                    |
| `docker compose`            | `env_file: - .env`               | 实测 v5.5.0 正常读取    |
| `tools/lib/qualy-server.ts` | `--env-file-if-exists=.env`      | 每次 spawn 一次         |

都是「进程起来时读一次」,没有一个会在运行中重读。

## 五、口径

1. Qualy 支持普通 `.env` 与 secret manager 挂载的环境;普通文件是默认,行为不变。
   `.env.example` 仍然是 schema 与参考,不删。
2. 挂载的环境可能是 FIFO,可能只能可靠读取一次,所以 dev supervisor 在 session 启动时
   读一次并冻结;**改了环境变量后重启 `pnpm dev`**。
3. 在 Qualy 自己的 Node 进程里(`pnpm dev`、`pnpm start`、CLI、seed),shell 里已经设置的
   变量优先于 `.env`(`--env-file-if-exists` 与 `process.loadEnvFile` 实测均不覆盖已有变量)。
   `docker compose` 的 `env_file` 不在此列,按 Compose 自己的规则。
4. 选择哪个 secret manager、它怎么挂载,属于每个开发者自己的机器配置,不进仓库。
   仓库里没有、也不需要任何这类工具的配置文件或 hook。
5. 如果 `.env` 是管道而另一端没有 writer,任何读它的命令都会停在打开那一步。
   `pnpm dev` 会先打印 `.env is a mounted environment`,那行之后不动就是这种情况。

## 附:项目级 1Password 配置的撤回(2026-09-16)

第一版曾提交 `.1password/environments.toml`(`mount_paths = [".env"]`),把一个 secret manager
的挂载路径写成了项目级约定。已撤回:secret manager 的选择属于每个开发者,不属于仓库。
上面的 FIFO 兼容设计与之无关,原样保留。
