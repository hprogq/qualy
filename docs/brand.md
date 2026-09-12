# Qualy 品牌标识

标志是一个缺了一段的圆环:缺失的那段弧滑出到环外,成为 Q 的尾巴。尾巴与环是同一个零件,这是整个标志的概念;加载动画就是这个零件在轨道上绕行。字标 "Qualy" 里的 Q 由标志本身充当,后面四个字母 `ualy` 取自 Jost 字体、展开为路径后冻结。

代码在 `packages/web/brand`(`@qualy/brand`),叶子子路径 `./mark` `./wordmark` `./loader` `./geometry`,无 barrel。静态素材在该包 `assets/mark.svg` 与 `assets/wordmark.svg`。

## 几何(冻结)

单位是模数 `s`(= 线宽)。坐标系是 SVG 常规:x 向右,y 向下,角度以 x 正方向为 0°、顺时针为正,环心为原点。

| 项       | 值                                                                      |
| -------- | ----------------------------------------------------------------------- |
| 环外半径 | 3s                                                                      |
| 环内半径 | 2s                                                                      |
| 缺口     | 张角 45°,中心方向 45°(右下),占据 22.5°–67.5°                            |
| 滑出零件 | 与缺口完全相同的弧带,沿 45° 方向平移 1.5s,即 (1.0607s, 1.0607s)         |
| 切口     | 径向平切,两端指向圆心,无圆角                                            |
| 画布     | 正方形 8s × 8s,环心在 (4s, 4s);零件沿任一轴最远到环心外 3.832s,在画布内 |
| 效果     | 无阴影、无渐变、无描边、无圆角、无滤镜;一切以填充表达                   |

路径由 `src/geometry.ts` 的 `markGeometry({ s, center })` 运行时计算(纯函数,默认 s = 16、画布 128),同时给出环、滑出零件、归位零件、完整轨道四条 `d` 与 viewBox。自检值:s = 16 时环带外弧起点 (82.369, 108.346)。

## 颜色

静态标志与字标永远单色:`currentColor`。以下两个 token 只声明、不接入任何组件(阶段 2 写入 `tokens.css`):

| token              | 含义                    | 浅色      | 深色      |
| ------------------ | ----------------------- | --------- | --------- |
| `--q-brand-accent` | 青,运动零件与未来交互态 | `#0F7099` | `#41ABD8` |
| `--q-brand-track`  | 蓝,加载轨道             | `#D6E6EE` | `#23343D` |

加载动画 v1 单色:零件 `currentColor`,轨道 `color-mix(in oklab, currentColor 18%, transparent)`。

## 字标

- 字体 **Jost**(可变字体,`@fontsource-variable/jost`,根 devDependency,字体文件不提交,OFL 1.1)。OpenType 特性留空。
- 字重由方程决定:在 wght 500–700 逐 1 扫描,取使 `6 × stem` 最接近 `1.03 × capHeight` 的值;stem 是字母 `l` 的字形包围盒宽度,capHeight 取 OS/2。**解:wght 551,stem 120 / capHeight 700(font units),环高 / capHeight = 1.0286(目标 1.03,偏差 −0.14%)。**
- `s = stem`。字标坐标系取 s = 16(与标志默认一致),即 0.13333 字标单位 / font unit,capHeight = 93.333,基线 y = 0。
- 环放在大写字母的位置:外径 6s,环心 y = −capHeight/2(= −46.667),环左缘 x = 0。
- 四个字母经 `font.layout('ualy')` 取形与 advance(Jost 在这四对之间没有字距调整),缩放、翻转 y、按 advance 排布。
- **参数 A(尾巴到 u 的间距)= 0.5s**:零件最右点到 u 包围盒左缘。对照 u–a 之间 0.611s 的空白,在 0.35 / 0.5 / 0.65 / 0.8 里 0.5 最接近视觉一致(0.65 起 Q–u 明显比 u–a 松),镜像检查同样成立。
- **参数 B(字距)= −0.02em**:每个字间在 advance 上减去 0.02em;−0.01 偏松、−0.03 时 a–l 偏挤。
- viewBox 紧贴内容:左 = 环左缘(0),右 = y 右缘,下 = max(y 下伸部底, 零件底),**上 = 内容顶**。规格原文写的是"环顶",但 Jost 的 `l` 上伸到 780 units,高过环顶(350 + 360 = 710 units);按"环顶"会裁掉 l 的顶部,故取 min(环顶, 字母顶)。当前 viewBox `0 -104 341.34 133.333`。
- `<Wordmark height>` 的 `height` 是渲染的 capHeight 像素数,绘图本身比它高(环上下溢出、l 上伸)。

## 加载动画

画布同 8s 正方形,环心即画布中心。轨道是完整环带(单色回退 18%),零件是归位位置的弧带,所在 `<g>` 绕画布中心匀速旋转 360° / 1.2s、linear、infinite,`transformBox: 'view-box'`、`transformOrigin: '50% 50%'`。`prefers-reduced-motion: reduce` 时纯 CSS(StyleX 媒体查询条件)隐藏轨道与旋转零件、显示静态标志。"完成"过渡动画未做。

## 使用规则

- 静态标志与字标永远单色,深浅背景各取一色;青不进静态标志。
- 青只出现在运动与交互态,蓝只作轨道。
- 字标里 Q 就是标志,**禁止**把标志和字体 Q 并排("Q Qualy" 是重复)。
- 字标是路径资产,不是文本;禁止用活文本 + 字体渲染 "Qualy" 作为品牌展示。
- 界面正文字体与字标字体是两个独立决定,Jost 不用于界面正文。

## 生成与预览

```sh
pnpm brand:generate   # tools/brand/generate.ts:求解字重,写 src/wordmark-paths.ts 与 assets/*.svg,打印 wght / stem / 比值 / A / B
pnpm brand:preview    # tools/brand/preview.ts:写 tools/brand/out/preview.html,并用 playwright 截 浅色 / 深色 / 浅色模糊 / 浅色镜像 四张图
```

可调参数只在 `tools/brand/spec.ts`(`TAIL_GAP`、`TRACKING`);`tools/brand/font.ts` 打开字体并解方程,`tools/brand/wordmark.ts` 排布字标,几何一律 import `packages/web/brand/src/geometry.ts`,工具里不复制几何代码。预览页除规格要求的各档尺寸、14px 顶栏模拟、模糊与镜像开关外,另有两行只服务于工具:浏览器用同一字体文件在同一 wght 下渲染的活文本(红)叠在冻结路径上,证明路径就是字体的;以及 A、B 各在相邻取值下的对照。

**关于"零 codegen"**:`src/wordmark-paths.ts` 与 `assets/*.svg` 是设计资产,等价于设计师从绘图工具导出的文件;生成工具是设计工具,不是构建步骤。因此不设"重新生成必须无 diff"的门禁、不进 CI,产物由人审阅后提交。`geometry.ts` 是运行时代码,不是生成物。

### 读取字体:fontkit 与 WOFF2 变体

fontkit 2.0.4 能打开 fontsource 的 WOFF2,但对它**不应用 gvar**:WOFF2 的 glyf 表是变换过的,fontkit 预先解码这些字形,应用变体增量的那条解码路径永远走不到,于是 500–700 每个字重回来的都是 Regular 的轮廓(stem 恒为 80),而 advance(来自 HVAR)却在变。`getVariation` 对 WOFF2 还会用错子类,直接抛错。处理:先用 `wawoff2`(Google 的 woff2 参考解码器编译成 WASM,无损)把 WOFF2 展开为 TTF 字节,再交给 fontkit 的 `create`,变体走 TTF 的正常路径。字体来源、字体文件、读取库都没有换;预览页的活文本叠加是这条路径的实测证据。细节见 `docs/notes/fontkit.md`。
