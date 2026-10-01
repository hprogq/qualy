# 登录页首屏 CSS 与 Lighthouse 实测

2026-10-02。输入是用户提供的 `localhost_3000-20261002T014835.json`
(Lighthouse 13.4.1、DevTools)。这是匿名跳转后的 `/login?next=%2Fassessment%2Fbatches`，
不是已登录批次页。LCP 元素是 `h1`「登录 Qualy」。

## 评分与实际录制

报告使用 mobile / simulate：RTT 150ms、throughput 1638.4Kbps、CPU slowdown 4。
模拟 FCP 2257ms、LCP 4845ms、TBT 60ms、CLS 0、performance 80；
实际录制 FCP 34ms、LCP 584ms。LCP breakdown 实际 TTFB 5.153ms、render delay 579.239ms。
关键请求链的 29ms 是实际本地记录，不是模拟移动网络的 LCP。

请求先后是入口与壳 CSS → manifest → 登录页懒 chunk → login-methods/session。
报告里 manifest 97–113ms、登录页 chunk 183–207ms、登录上下文 269–298ms。
模拟网络会放大这些依赖阶段；同源 preconnect 无法去掉它们。
主线程 Other 1702ms 不能仅凭分类就归因于业务代码。

## 壳 CSS 构成

用 Vite 的 PostCSS 解析实际 `s-Dj948cXW.css`，按顶层 `@layer` 汇总 UTF-8 bytes：

| 来源                                         | 未压缩 bytes |  占比 |
| -------------------------------------------- | -----------: | ----: |
| `mantine` 层                                 |       260046 | 68.3% |
| StyleX `priority1`–`priority11` 层           |        94013 | 24.7% |
| 其他：字体声明、基线、产品覆写、keyframes 等 |        26685 |  7.0% |
| 总计                                         |       380749 |  100% |

整个文件 Node 默认 Brotli 54630 bytes；报告实际传输 55035 bytes，包含响应开销。
分别压缩上述三组为 30532 / 21236 / 4239 bytes，不能相加当作整张表的压缩体积。
构建 gzip 数字与网络 Brotli 数字也不能直接比较。

[theme.css](../../packages/web/ui/src/styles/theme.css) 显式导入 Mantine core/dates 全量样式、
photo-view 样式和字体；[构建配置](../../apps/web/vite.config.ts) 则让 StyleX unplugin
把本次构建收集的规则全部追加到壳 CSS。这是当前适配器的聚合策略，不是 StyleX 必须采用的
页面加载方式。规则去重、编译期生成与运行时无注入是一组收益，首屏是否加载所有规则是另一项取舍。

另外两个 86919 / 99095 bytes 的 CSS 是 Monaco 规则；15470 bytes 的是 ALTCHA。
用户这份登录录制只请求了壳 CSS，没有请求这三个懒样式文件。

报告 unused-css-rules 为 0；对实际旧版本地页面做 Chromium CSS coverage，壳样式的
380749 code units 中 338876 被记为使用。`@layer` 聚合使这个统计不足以证明内部每个组件
选择器都命中；不把该结果作为保留全量组件样式的依据。

## 已实施的直接修复

[LoginPage](../../packages/plugins/base/auth/src/client/LoginPage.tsx) 原来在上下文从 pending
变成 ready 时把动画 key 从 `waiting` 换成 `home`/`method`。`AnimatePresence mode="wait"`
先退出 140ms，再进入 220ms，数据就绪也要经过这段显示过渡。
现在 key 只跟登录方式/列表的地址状态变化；首次数据到达时在原位置替换骨架，保留用户导航过渡。
初始地址已经指定 method 时也采用稳定 key。

浏览器测试通过实际延后返回的上下文验证原动画容器没有被重建、正式内容 opacity 为 1。
测试里的 Promise 只由测试 resolve、不会 reject；依据
`repos/effect/packages/effect/src/Effect.ts` 的 `promise` 构造器文档使用 `Effect.promise`。

用户运行中的服务仍给出旧入口 `e-NCyELQh7.js`。独立无登录 Chromium 探针的英文 LCP 392ms
只用于核对旧请求链，不是修复后基线；没有宣称 80 分已提高或固定减少 360ms LCP。

## 后续测量边界

Mantine 策略裁决见下文：保留全量 core，只有 dates/photo CSS 跟懒组件走。
下一轮如有真实需求，再独立实验 StyleX 的共享壳与路由规则拆分。现有 unplugin 没有
一个可直接打开的 per-route CSS 开关；实现需要保留常量解析、原子规则去重、priority
层顺序和动态 import 的 CSS preload。不通过按 class 名猜所属页面来拆，也不先切成
几十张很小的样式表。先获取同一真实后端条件下的登录/已登录批次页 trace 或生产 RUM，
比较 LCP/FCP、首屏请求与 Brotli；不以一次 80 分建立评分门禁。
当前 JS 门禁不包括 CSS/字体，见 [预算说明](../adr/0011-i18n-paraglide.md)。

## Mantine 样式对照实验与维护成本裁决

2026-10-02 后续实施，安装版本 Mantine 9.6.1。显式的全量 CSS import 不会因组件 JS
被树摇就自动删除对应选择器；Mantine 的组件代码、CSS 是分开的发布入口。
官方提供分组件 CSS 及依赖说明，见上面的链接和
[global styles](https://mantine.dev/styles/global-styles/)。

实读安装产物的 `@mantine/core/esm/index.mjs`、`components/Button/Button.mjs`、
`components/Modal/Modal.mjs`、内部相对 import 的递归依赖，以及
`@mantine/dates/esm/components/PickerInputBase/PickerInputBase.mjs`。
例如 Button 需要 UnstyledButton/Loader，Modal 需要 ModalBase/Overlay/Paper/ScrollArea 等。
Checkbox/Radio 的 Card、独立 Indicator 是 compound exports，Qualy 的适配组件没有渲染它们，
不为这些附加组件保留 CSS。没有改 vendored 上游文件或引入 CSS codegen。

先尝试每个 UI 适配组件导入自己的依赖 CSS。原 widgets/dates 分包正则还会匹配 CSS，
把它们一起归入共享 chunk；改成只匹配 JavaScript 后得到细分方案。
该方案登录页静态 CSS closure 为 10 个请求/188654 raw bytes/35583 Brotli bytes。
页面真实录制还包括每个响应的头开销，不能只看变小的壳 CSS。

用户的 localhost:3000 在测试期间停止，最初转发 API 的临时对照出现 500，所有这些错误页
Lighthouse 分数均排除。之后使用有界匿名登录 fixture：真实构建的 HTML/JS/CSS、Brotli
资源，固定 20ms manifest/login-methods 响应与匿名 401 session。每个版本先用 Chromium
确认登录方法按钮出现，再跑 Lighthouse 13.5.0 mobile/simulate 三次；没有真实库、CAS
图标或用户数据操作。这用于比较 CSS 策略，不能与用户 DevTools 13.4.1 的 80 分直接比较。

| 策略                             | 登录 CSS 请求 | CSS 传输 bytes | LCP 中位数 ms | FCP 中位数 ms | 性能分中位数 |
| -------------------------------- | ------------: | -------------: | ------------: | ------------: | -----------: |
| 原全量样式                       |             1 |          54852 |       4606.42 |       1501.36 |           83 |
| 分组件导入、CSS 随 widget 共享池 |             2 |          39220 |       4540.62 |       1651.30 |           83 |
| 分组件、CSS 随消费边界细分       |            10 |          37789 |       4693.68 |       1651.16 |           82 |
| 共享 core 子集、懒日期/图片 CSS  |             1 |          38033 |       4507.37 |       1501.67 |           84 |

没有选择 10 请求方案：它虽然少传输一些字节，但这次对照没有改善 LCP。
上述三次实验同时改变了 core 子集与 dates/photo 的加载边界，不能把原全量与子集的
约 99ms 差值全部归因于 core 裁剪。手工组件依赖清单会复制 Mantine 内部依赖事实，
升级时可能出现 TypeScript 无法发现的缺样式状态，因此不把它作为最终方案。

最终保留全量 `@mantine/core/styles.layer.css`，壳仍只有一张初始样式表；移除手工
`widgets.css`，撤回试验中的 CSS 分包正则修改、多 sheet 启动修改和 41 KiB 硬预算。
既有 widgets/dates JavaScript 共享池及 JS 门禁保持原状。
三个日期适配器各自导入 full dates sheet，图片适配器导入 photo-view sheet。
四个适配器引用窄 CSS 类型声明，供消费 workspace 源码的包一起检查，不引入
vite/client 全局类型。

图片适配器是纯 re-export；如果保留 `sideEffects: false`，生产树摇会跳过它携带的 CSS。
已把该模块加入 UI package 的 sideEffects 白名单，并在实际产物确认 full photo-view sheet
单独存在。仅靠开发态测试不足以发现这种生产 CSS 丢失。

为补齐缺失对照，使用全量 core + lazy extras 与正确保留图片 CSS 的最终子集产物各
测量 10 次。每轮交替版本顺序，两者使用同一匿名 fixture、Lighthouse 13.5.0、mobile
simulate、同一 Brotli 压缩条件。每个版本先验证登录方法出现，每份报告要求
login-methods 请求返回 200，排除错误页；没有其他构建或测试并行争用 CPU。
这次结果如下，CSS 传输包含响应头；Brotli 文件体积另列。

| 策略                              | 次数 | 初始 CSS 请求 | CSS 传输 B |       LCP 中位数（范围）ms |       FCP 中位数（范围）ms | 性能分中位数（范围） |
| --------------------------------- | ---: | ------------: | ---------: | -------------------------: | -------------------------: | -------------------: |
| 全量 core + lazy extras（方案 E） |   10 |             1 |      51934 | 4604.42（4600.33–4608.78） | 1876.30（1500.98–2251.44） |        82.5（81–83） |
| 手工 core 子集 + lazy extras      |   10 |             1 |      38033 | 4505.70（4504.00–4509.04） |  1951.11（901.11–2101.44） |          83（82–84） |

方案 E 壳 `s-Ko0PgcSZ.css`：351890 raw / 51712 Brotli bytes。相对原全量壳
54630 Brotli bytes 少 2918 B（5.3%）；子集再少 13901 B。实际日期样式独立存在于
`a-C9N3-j7Q.css`，图片样式独立存在于 `a-qIT1EIL9.css`，登录报告不请求这两张样式表。

子集在本 fixture 中的 LCP 优势稳定为 98.72ms（2.14%），不是这次采样噪声；但 FCP
并未获益，且两者 FCP/评分有明显波动。这个有限的 synthetic 改善不抵消手工复制
Mantine 组件依赖 closure 的持续维护风险，因此最终选择方案 E。不能将这个 LCP 差值
当作生产设备的固定收益，也不能承诺真实站点达到 90/95 分。

原始 20 份报告、逐次摘要与有界 fixture 脚本保留在本地 gitignored 的
`apps/web/.qualy/bundle-investigation/css-e-vs-subset-*`，没有作为生产机制提交。
localhost:3000 未运行，本次没有真实后端或线上 RUM 验证；后续应在一致的真实响应条件
下复测登录与已登录批次页。这些 synthetic 数据不构成生产 RUM 结论。

验收边界：Chromium 全套在子集实验阶段通过 125 文件/1597 测试；最终 full core
另外执行定向表单、弹层、日期、图片验收。额外 WebKit 6 文件测试在原始代码与最终代码
均为相同 7 项失败/48 项通过，失败名称集合逐项一致：4 项时间键盘输入、checkbox Space、
Select/Dialog Escape，以及 `oklch(...27.325)` 与 `oklch(...27.325001)` 精度断言。
图片查看器新测试在 WebKit 通过。这些既有失败没有被称为本轮通过，也没有混入 CSS 改动
修改交互或放宽断言。
