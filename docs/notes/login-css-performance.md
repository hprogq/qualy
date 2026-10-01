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

## 下一轮优先级

1. 先实验 Mantine core 按实际组件导入 `styles/*.layer.css`，保留其 global styles 与依赖组件。
   日期/图片查看样式跟真正消费它们的懒边界走。Mantine 官方支持
   [分组件样式](https://mantine.dev/styles/mantine-styles/)，但必须包含依赖组件，不能只删总表。
   验证 dark/mobile、输入框、弹层、日历与图片查看器，并检查首屏 CSS 请求/压缩体积。
2. 再实验 StyleX 的共享壳与路由规则拆分。现有 unplugin 没有一个可直接打开的 per-route
   CSS 开关；实现需要保留常量解析、原子规则去重、priority 层顺序和动态 import 的 CSS preload。
   不通过按 class 名猜所属页面来拆，也不先切成几十张很小的样式表。
3. 用同一生产预览与同一 Lighthouse 版本各录制三次，分别保留登录和已登录批次页的报告/trace。
   对比 median LCP/FCP、首屏 JS/CSS/font 请求和 Brotli，不以一次 80 分直接立评分门禁。
   当前 JS 门禁不包括 CSS/字体，见 [预算说明](../adr/0011-i18n-paraglide.md)。
