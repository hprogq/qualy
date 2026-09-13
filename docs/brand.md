# Qualy 品牌标识

标志是一个由八段同形扇环组成的圆环,其中一段——尾巴——沿它所朝的方向滑出到环外,于是环有了豁口、Q 有了尾巴,两者是同一个零件。字标 "Qualy" 里的 Q 由标志本身充当,后面四个字母 `ualy` 用与环相同的词汇(正圆环带、直杆、平切)构造,**没有字体、没有导出、没有生成物**:几何全部在 `packages/web/brand/src/geometry.ts` 里运行时计算。

代码在 `packages/web/brand`(`@qualy/brand`),叶子子路径 `./mark` `./wordmark` `./loader` `./geometry`,无 barrel。静态素材在该包 `assets/mark.svg` 与 `assets/wordmark.svg`,favicon 在 `apps/web/public/favicon.svg`(另有 Safari 与主屏用的 `favicon.png` 32 / `apple-touch-icon.png` 180,白底圆角方上放黑 Q),全部由 `pnpm brand:export` 从几何写出。

## 几何(冻结)

单位是模数 `s` = 线宽。坐标是 SVG 常规:x 右 y 下,角 0° 在 x 正方向、顺时针为正,环心为原点。

### 环与零件(八段)

| 项     | 值                                                                                      |
| ------ | --------------------------------------------------------------------------------------- |
| 外轮廓 | 半径 `3s` 的圆                                                                          |
| 内轮廓 | 椭圆 `rx = 2s, ry = 2.1s`(`innerStretch` 1.05:横向笔画削薄 0.1s,圆形并列直笔的光学修正) |
| 扇环   | 八段 `sector(k)`,k = 0..7,各覆盖 `[22.5° + 45k, 67.5° + 45k]`;sector 0 中心在 45°(右下) |
| 内点   | 各段按**各自角度**在同一个椭圆上求点(径向射线与椭圆的交点),不是旋转复制                 |
| 路径   | 外圆弧(顺时针)→ 径向直线到内椭圆 → 内椭圆弧(逆时针)→ 闭合;切口径向平切,无圆角           |
| 尾巴   | sector 0 沿 45° 平移 `1.5s`,即 `(1.0607s, 1.0607s)`;与环外沿的空隙约 0.55s              |
| 画布   | `8s × 8s`,环心 `(4s, 4s)`;零件沿任一轴最远到环心外 `3.832s`,画布内                      |
| 效果   | 无阴影、无渐变、无描边、无圆角、无滤镜;一切以填充表达,`fill-rule: nonzero`              |

自检:s = 16、环心 (64, 64) 时 sector 0 外弧起点 (108.35, 82.37)、终点 (82.37, 108.35)。

**静态与活的分开画**(`src/segments.tsx`):静态标志与字标用**一条连续路径**画 sector 1–7(角域 67.5°–382.5° 的环带,内轮廓仍是同一个椭圆,`bandPath`),加尾巴一条,`data-seg="1-7"` 与 `"0"`——一个填充没有接缝。八段独立路径(`data-seg="0".."7"`,0 是尾巴,1..7 从底部起顺时针到右侧)只用于 Loader 与 `Wordmark live`,它们只出现在 ≤ 48px,相邻填充的抗锯齿缝在那里不可见。`live` 开启的那一帧隐藏连续路径、显示八段,两者同色同形;退出时反过来。不加描边、不做角度重叠(描边改线宽,重叠在动画里会在接缝叠出更深的线)。

### 字母 ualy(构造式)

只用三种零件:正圆环带、直杆、平切;没有斜线、钩、spur。基线 y = 0,y 向下为正。

| 量   | 值                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| cap  | `6s / 1.03 = 5.825s`(环外径 6s 上下各溢出 1.5%)                                                            |
| 环心 | `(3s, −cap/2)`,环左缘在 x = 0                                                                              |
| x 高 | `4s`                                                                                                       |
| 小碗 | 外半径 `2s`,内轮廓 `rx = s, ry = 1.05s`(与环同一条 stretch 规则)                                           |
| 直杆 | 宽 `s`                                                                                                     |
| u    | 左杆 `[x, x+s] × [−4s, −2s]`,右杆 `[x+3s, x+4s] × [−4s, −2s]`,碗心 `(x+2s, −2s)` 取下半环带;一条顺时针轮廓 |
| a    | 完整小环带(外圆顺时针、内椭圆逆时针),碗心 `(x+2s, −2s)`;右杆 `[x+3s, x+4s] × [−4s, 0]` 同向叠加(并集)      |
| l    | `[x, x+s] × [−cap, 0]`,顶与 cap 齐                                                                         |
| y    | 与 u 相同的 ⊔,再叠加右杆延长 `[x+3s, x+4s] × [−4s, +1.5s]`,下端平切                                        |

参考路径(s = 16、基线 y = 120)与实现的角点逐一相同(`tests/geometry.test.ts` 钉住),只有小碗内弧的半径从圆改成了椭圆。

### 间距:面积法(运行时计算)

目标是相邻字母之间的**白色面积**看起来相等,不是线性距离相等。`wordmarkLayout(s, { k, kern, innerStretch })`:

- 五个元素按序 `Q(环 + 尾巴) · u · a · l · y`,每个提供解析的左/右轮廓函数(直杆常数、碗是圆弧、环是圆、尾巴是 22.5° 切口线 + 外弧),不做路径扁平化。
- 对每一对相邻元素,在 x 高带 `y ∈ [−4s, 0]` 取 64 条扫描线(等分区间的中点),每条线上空隙 = `右.left(y) − 左.right(y)`,单条封顶 `2s`,取平均为该对的"白"。
- 目标白冻结为绝对值 **`0.97s`**(`TARGET_WHITE`;来历:u、a 按手排参考的 0.6s 包围盒间隙摆放时量到 1.141s 的白,取其 85%;冻结后间距不再依赖这次自举)。四对逐一二分求解使白 = 目标。
- **Q–u 硬约束**:尾巴右缘与 u 轮廓在每条扫描线上的距离 ≥ `0.5s`(尾巴的两个角点显式纳入采样,最近点不会落在两条采样线之间)。u 取面积解与约束解中靠右者。
- `kern: Partial<Record<'Qu'|'ua'|'al'|'ly', number>>`,单位 s,加在该对的解上,默认空。`white` 选项只给预览页当旋钮,产品代码不传。

结果(s = 16):目标白 0.97s;白 Qu 1.029 / ua 0.970 / al 0.970 / ly 0.970;尾巴–u 最短距离 0.500s(约束生效,面积解本会把 u 放在环右缘外 0.794s 处);环右缘 (x = 6s) 到 u 左杆 0.853s(预期 0.6–0.9s);kern 空。字母起点 x = 109.65 / 180.12 / 259.64 / 287.87,与手排估值 110 / 183.6 / 261.2 / 290.8 相差 −0.02 / −0.22 / −0.10 / −0.18 s,都在 0.3s 内。

### 字标画布

紧贴内容:左 = 环左缘(0),右 = y 右缘,上 = 环顶(含溢出,`−cap/2 − 3s`),下 = `max(y 下端 +1.5s, 尾巴最低点 ≈ 0.92s)` = 1.5s。不留内边距。s = 16 时 viewBox `0 -94.602 351.873 118.602`。`<Wordmark height>` 的 `height` 是渲染后的 **cap 像素数**,不是画布高。

## 颜色

静态标志与字标永远单色:`currentColor`。加载全程无彩色,只用 `currentColor` 的透明度;不新增任何强调色 token。

## 动画

### 原理

八个元素——sector 1..7 与尾巴——各自只改 `opacity`,尾巴另有一个小位移。**没有旋转、没有零件移动、豁口永远敞开、字母永不退场。** 一段"光"或"墨"按顺序在八个元素间传递:`尾巴(0) → 1 → 2 → … → 7 → 尾巴`(顺时针,从右下经底、左、顶、右回到右下)。

### 时序

| 项                   | 值                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------- |
| 一圈                 | `1400ms`                                                                                     |
| 各元素停留           | 尾巴 `280ms`,其余七段各 `160ms`                                                              |
| 头进入各元素的时刻 C | `[0, 280, 440, 600, 760, 920, 1080, 1240]`                                                   |
| 切换的缓动           | 帧内 `cubic-bezier(.1,.9,.2,1)`(快变慢停);尾巴离开后的那一段 `cubic-bezier(.4,0,.6,1)`(余光) |

### 两种极性(同一时序、同一几何,只换明度表)

`level[d]` 是"头在 d 步之前经过它"的元素明度,d = 0 表示头正在它上面。

| 极性 | 用途                   | level[0..7]                                     | 尾巴作头时 |
| ---- | ---------------------- | ----------------------------------------------- | ---------- |
| 暗   | 字标、> 24px 的 Loader | `[0.40, 0.62, 0.85, 1, 1, 1, 1, 1]`             | `0.32`     |
| 浅   | ≤ 24px 行内指示器      | `[1, 0.60, 0.36, 0.24, 0.17, 0.14, 0.13, 0.12]` | `1`        |

`<Loader polarity>` 缺省按尺寸:≤ 24 浅、> 24 暗。`<Wordmark live>` 永远暗。

### 门口三动作(只作用于尾巴)

1. **探身**:头到达尾巴前 40ms,尾巴沿 45° 向豁口移动 `0.3s`(平移向量 1.5s → 1.2s),140ms 缓出到位,再 220ms 缓入缓出退回。实现为尾巴 `<path>` 上的第二条 CSS 动画:`transform: translate(0) → translate(−3.394px, −3.394px)`(用户单位,s = 16 时 0.3s·cos45°)→ 回 0;基准平移已烙在路径坐标里,所以关键帧是相对量。
2. **更亮**:尾巴作头时用上表"尾巴作头时"一列。
3. **余光**:头离开尾巴后的那一段用 `cubic-bezier(.4,0,.6,1)`。

### 关键帧推导(`src/keyframes.ts` 是手写字面量,`tools/brand/loop.ts` 是规则,`tools/tests/brand-loop.test.ts` 把两者钉在一起)

- 关键帧的 **0% 定义为探身开始**(时序 1360ms)。于是 `animation-delay: 0` 从探身开始,`animation-delay: 400ms` 就是首屏的 400ms 门槛。
- 头切换点 = `C[i] + 40ms` → `[2.857%, 22.857%, 34.286%, 45.714%, 57.143%, 68.571%, 80%, 91.429%]`。
- `target(k, i)` = 头在元素 i 上时元素 k 的目标明度 = `level[(i − k + 8) % 8]`,k = 0 且 i = 0 时取"尾巴作头时"。
- **每个关键帧携带该时刻元素已到达的值**:第 j 个切换点上元素 k 的值 = `target(k, (j + 7) % 8)`(上一段停留的目标),新目标出现在下一个关键帧;帧内 timing function 作用于到下一帧的区间,所以变化在头到达后立即发生、随后停住。0% 与 100% 的值 = `target(k, 7)`,循环连续。附录里"第 i 个切换点的值 = level[(i − k) % 8]"的写法会让每个元素提前一段停留变亮,与 rAF 语义不符,按语义实现。
- 尾巴(k = 0)在第 1 个切换点(22.857%,头刚离开)的帧用余光曲线,其余帧用快变慢停曲线;100% 帧不带 timing function。
- 探身:`0%: translate(0)`,`10% (140ms): translate(−3.394px)`,`25.714% (360ms): translate(0)`,`100%: translate(0)`;缓动分别为 `cubic-bezier(.33,1,.68,1)`(缓出)与 `cubic-bezier(.65,0,.35,1)`(缓入缓出)。
- 属性层:`animation-duration: 1400ms`、`linear`(帧内曲线覆盖它)、`infinite`;尾巴是两条动画的逗号列表。

**StyleX 实测结论**:`@stylexjs/stylex` 0.19 的编译器接受关键帧内的 `animationTimingFunction`(原样输出为 `animation-timing-function`),接受 `animationName: { default, '@media (prefers-reduced-motion: reduce)': ... }` 与两条动画的模板串;浏览器测试从 `getAnimations()[].effect.getKeyframes()` 读回逐帧 `easing`,与源码一致——**采用首选方案(帧内 timing function),未用 18 停靠点**。`stylex.keyframes()` 只接受字面量对象(引用常量直接报错),因此八套关键帧内联在调用里,规则与门禁在包外。CSS `transform` 在 SVG `<path>` 上以用户单位生效(Chromium 实测:140ms 时 computed transform 为 `matrix(1,0,0,1,−3.394,−3.394)`,48px 画布上包围盒位移 1.27px)。

### 减少动态

`prefers-reduced-motion: reduce` 时不循环:七段无动画,尾巴以 `2400ms` 周期 `opacity 1 → 0.55 → 1` 缓慢呼吸(只动透明度),探身关闭。StyleX 媒体查询条件,纯 CSS。

### 一次性序列(冷启动)

只属于 `LoadingScreen`,见下文「首屏」。

## 场景接入

| 场景                             | 位置                                   | 形态                                                                                                         |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 冷启动、i18n 回退、manifest 加载 | `@qualy/ui/spinner` 的 `LoadingScreen` | 首屏全套(下节)                                                                                               |
| 路由级内容区等待                 | `PageLoading`                          | `<Loader size={24}>`,`opacity` 0 → 1、150ms、`animation-delay: 300ms`、`both`:300ms 内到达的页面永远看不到它 |
| 按钮内、行内、提交态             | `Spinner`                              | `<Loader size={16}>`(浅极性),`role="status"` + `aria-label`,点击即显示、完成即消失                           |
| 顶栏                             | `layout-default/TopBar.tsx` 的 `Brand` | `<Wordmark height={14} title="Qualy">`,永不 `live`;链接的可访问名称就是 `<title>`,不再另加 aria-label        |
| favicon                          | `apps/web/public/favicon.svg`          | 静态标志,内嵌 `prefers-color-scheme` 切 `#18191D` / `#FAFAF8`;`index.html` 的 `<link rel="icon">`            |
| 位图图标                         | `apps/web/public/favicon.png`、`apple-touch-icon.png` | Safari 不认 svg favicon,深色标签栏上裸黑 Q 会消失:白底圆角方(22% 圆角)上放黑 Q,32 与 180 两档;`index.html` 里 png 在 svg 之前,认 svg 的浏览器取后者 |

`Spinner` / `LoadingScreen` / `PageLoading` 三个导出名与 props 不变,lucide 的 `Loader2Icon` 不再被引用。加载类元素带 `role="status"`,视觉隐藏文案用 `@qualy/ui/visually-hidden`;冷启动的文案由宿主(`apps/web/src/App.tsx`)从 `commonMessages` 的英文 `defaultMessage` 取出交给宿主组件——它运行在 catalog 之前,而 `@qualy/ui` 保持零文案。

## 首屏(冷启动)

按用户真实等待的每一刻定义:加载动画不能让等待变长,也不能让快的加载显得慢。

### 结构:一个宿主,多个认领

到第一屏之前有三段串联的等待——catalog、manifest、布局 chunk——每一段都渲染 `<LoadingScreen />`。如果每个自己画字标,循环会在每次交接时重启,而且没有谁能动画退场:画它的那个 fallback 在后面的画面出现时已经卸载了。所以 `LoadingScreen` 是对一块共享覆盖层的**认领**(`useLayoutEffect` 里计数),覆盖层由包在根上、位于所有 provider 之外的 `<ColdStart copy>…</ColdStart>` 画:只要有认领就在,最后一个认领撤走一帧之后退场。「有没有宿主」经 context 告诉子树,认领方在挂载它的那次 render 就知道——曾经是宿主在 layout effect 里抬一个计数器,于是每个首次 render 都以为自己没有宿主,独立屏先提交再撤回,而那一次提交在所有引擎里都被画了一帧:首帧之下多出第二个字标(rAF 探针实测,Chromium 与 WebKit 皆然)。没有宿主的树里,`LoadingScreen` 画一个普通的静态屏。

### 首帧(0ms,JS 之前)

`apps/web/index.html` 只带一个标记 `<!-- qualy-boot -->`;构建(与 dev server、浏览器套件同一条 Vite 管线)用 `@qualy/web-build/vite` 的 `qualyBootFrame()` 在 `transformIndexHtml` 里换成 `@qualy/brand/boot` 的 `bootFrame()` 生成的字标 SVG——cap 28px,环心所在的水平线在 `44vh`,水平居中——定位经元素上的两个自定义属性(`--boot-top`、`--boot-hint-gap`)交给 index.html 的静态样式读。运行时零 JS、零 React、零外部请求,和以前一样;变的是开发层:几何只有 `geometry.ts` 一份,`ColdStart` 的 `coldStartPlacement` 读的是同一个 `bootPlacement(28)`,两边不可能再各存一份数字。这不违反零 codegen:产物不进仓库,和 Vite 往 HTML 注入 `<script src=/assets/…>` 是同一类事;源码没有标记时构建直接失败。

颜色仍是手写的:用应用自己的前景 / 背景 token 值(`oklch(0.21 0.006 80)` / `oklch(0.99 0.001 80)`,深色 `oklch(0.93 0.004 80)` / `oklch(0.17 0.006 80)`),不用预览页的 `#18191D` / `#FAFAF8`——接管那一帧覆盖层用的是同一组 token,两者必须逐值相同,`tools/tests/index-html.test.ts` 钉住;不让 bootstrap 等 tokens.css,那会破坏 boot 的独立性。一段内联脚本按 `ThemeProvider` 持久化的同一个键 `qualy.theme` 读取用户偏好(`packages/web/runtime/src/theme.tsx`),没有持久化就只看 `prefers-color-scheme`,设 `data-mode` 并提前加上 token 切换用的 `.dark` 类,页面背景同理。首帧不淡入。index.html 里不放任何注释(它原样发给每个浏览器;标记是唯一例外,构建把它换掉,生产 smoke 断言产物里没有注释),说明在 `tools/tests/index-html.test.ts`。

同一段脚本还是原生的 **watchdog**:20 秒后 `#qualy-boot` 还在(index.html 到了但 JS 404、chunk 版本错位、初始化直接抛错——React 永远不会挂载,React 侧的 6s / 30s 一个都覆盖不到),就在字标下方补一行「加载时间较长,刷新页面」,链接经 `addEventListener` 触发 `location.reload()`(内联 `onclick` 会被 CSP 拦);React 正常接管时 `#qualy-boot` 被删,定时器自然作废。脚本是 CSP `script-src` 里唯一放行的 hash,改一个字节就要同步 `shell-policy.ts` 的常量(测试守)。

### 接管(React 挂载后)

`ColdStart` 用完全相同的几何与位置渲染 `<Wordmark height={28} live>`(循环带 400ms delay),在它自己的 `useLayoutEffect` 里**同帧**移除 `#qualy-boot`,覆盖层与首帧之间不出现双字标或空白帧(首帧之下的第二个字标是另一件事,见上一段)。浏览器测试把 `bootFrame()` 生成的首帧片段(加 index.html 的静态样式)注入页面,比对两者的 `getBoundingClientRect`,逐像素一致。400ms 门槛的起点是 `performance.getEntriesByName('first-contentful-paint')` 的首帧时刻(取不到退回导航起点),不是导航:样式表慢时字标出现得晚,按导航算会让读者才看了 80ms 的静止字标就动起来。

### 等待

- 400ms 内就绪:循环从未开始(delay 未过),直接落位。
- 超过 400ms:循环从探身开始(关键帧 0%)。
- 6000ms 未就绪:字标下方 40px 淡入一行 muted 小字(英文 fallback "Still loading"),400ms。
- 30000ms 未就绪:停止循环(八段 150ms 归 1、尾巴退回,WAAPI 保持),显示重试按钮(刷新页面)。请求失败时,失败的加载器撤走认领,覆盖层照常退场,露出运行时自己的失败界面(带重试)——失败时不会还在转。

### 落位(就绪后)

1. 最后一个认领撤走 → 下一帧确认没有新的认领(fallback 之间的交接是同一次 commit 里的先撤后认,不会被当成结束)。
2. 先暂停八条循环动画,读各段当前 `opacity` 与尾巴的 `transform`,WAAPI 150ms 过渡到 1 / 归位并保持。
3. **然后**才 `document.startViewTransition(() => { 去掉 html[data-cold-start]; flushSync(卸载覆盖层) })`——快照是实心字标。覆盖层的字标与顶栏的字标共用 `view-transition-name: qualy-wordmark`;顶栏那个在覆盖层在场时被 `html[data-cold-start] [data-brand-wordmark] { view-transition-name: none }` 压掉,否则同名两元素会让浏览器跳过过渡。`::view-transition-group(qualy-wordmark)` 320ms `cubic-bezier(.2,.8,.2,1)`,old/new 图像不交叉淡化(同一张画);`::view-transition-new(root)` 从 60ms 起 260ms 淡入,`::view-transition-old(root)` 150ms 淡出。规则在 `apps/web/src/app.css`(根伪元素只能写在那里)。
4. 不支持 View Transitions 或 `prefers-reduced-motion: reduce`:覆盖层 150ms 淡出后卸载,不做 FLIP。
5. 落位后顶栏的字标是唯一的字标。
6. **飞行只属于第一屏**:宿主按 episode 计数,同一页面里覆盖层第二次以后出现(登录后 manifest 重载、切换布局)只做 150ms 交叉淡入。
7. **目的地不存在时**(登录页用的是无顶栏的 blank shell):`::view-transition-old(qualy-wordmark):only-child` 让旧图像随覆盖层 150ms 淡出,而不是原地停满 320ms 再消失。

就绪到可交互 ≤ 500ms(150 + 320,内容淡入与飞行重叠)。

**预算怎么守住**:React 对重试的 Suspense 边界有 300ms 的揭示节流(`globalMostRecentFallbackTime + 300`),布局 chunk 10ms 到达也要在 fallback 后面待满 300ms;页面这样等无妨(它的指示器本来 300ms 后才出现),布局这样等就把飞行拖出预算。所以 `RuntimeLoader` 在 manifest 到达后先把它点名的布局 chunk 取回(`preloadable(thunk)`:模块已在时交给 React 一个同步回调的 thenable,`React.lazy` 一步读出,不再 suspend),布局与 manifest 同一次 commit 画出,冷启动的最后一个认领在那一刻撤走。生产入口实测见 STATUS。

**400ms 门槛从首帧起算**:第一个 episode 把 `animation-delay` 设为 `max(0, 400 − performance.now())`,脚本到达前已经过去的时间不再重复等;之后的 episode 从覆盖层出现起算 400ms。

### 录制

`pnpm brand:record`(`tools/brand/record.ts`,手工):起真实的生产入口(需 `pnpm build`、compose 数据库与 seed、`.env` 里的 `QUALY_ADMIN_USERNAME` / `QUALY_ADMIN_PASSWORD`),管理员登录,把 `/api/app/manifest` 分别压到导航开始后 300ms 与 3000ms 才应答,用 CDP screencast 按合成器时间戳取帧,各挑 12 个时刻写 `tools/brand/out/ready-300ms-*.png` / `ready-3s-*.png` 与两张拼图。

## 使用规则

- 静态标志与字标永远单色,深浅背景各取一色。
- 字标里 Q 就是标志,**禁止**把标志和字体 Q 并排("Q Qualy" 是重复)。
- 字标是路径,不是文本;禁止用活文本 + 任何字体渲染 "Qualy" 作为品牌展示。
- 界面正文字体与字标是两个独立决定。

## 工具

```sh
pnpm brand:export    # tools/brand/export.ts:从 geometry 写 packages/web/brand/assets/{mark,wordmark}.svg、apps/web/public/favicon.svg,并经 playwright 栅格化 favicon.png / apple-touch-icon.png
pnpm brand:preview   # tools/brand/preview.ts:清空 out/,写 preview.html,playwright 截 浅色 / 深色 / 模糊 / 镜像 / 倒置 五张图
```

预览页:标志与字标 16 / 24 / 32 / 48 / 96 / 256(字标尺寸是 cap 高)、14px 顶栏模拟、Loader 16 / 24 浅与 48 暗、28px live 字标、模糊 / 镜像 / 倒置 180° 开关、目标白取 0.85 / 0.97 / 1.09s 的对照行;截图前清空 `tools/brand/out/`,出 浅 / 深 / 模糊 / 镜像 / 倒置 五张,另外把 live 字标的动画暂停后逐 250ms 设 `currentTime` 截 12 帧(`live-01..12.png`)并拼成 `live-strip.png`。预览页的动画 CSS 由 `tools/brand/loop.ts` 从规则生成,与组件用的字面量经门禁保持一致。

**关于"零 codegen"**:`assets/*.svg` 与 favicon 是设计资产,等价于设计师从绘图工具导出的文件;导出工具是设计工具,不是构建步骤。不设"重新导出必须无 diff"的门禁、不进 CI,产物由人审阅后提交;favicon 与几何的一致性由测试守(阶段 3)。`geometry.ts` 是运行时代码,不是生成物。

## 历史

2026-09-13 之前的版本用 Jost 字体经 fontkit 导出 `ualy` 路径(wght 551);同日改为构造式,字体链路整体离场。fontkit 对 WOFF2 变体的实查留在 `docs/notes/fontkit.md`。
