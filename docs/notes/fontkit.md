# fontkit 实查(历史记录:字标已于 2026-09-13 改为构造式,fontkit 与字体依赖同日离场;本文只作实查存档)

版本:fontkit 2.0.4(根 devDependency,只给 `tools/brand/*` 用),类型来自 `@types/fontkit` 2.0.9(包本身不带 d.ts)。

## WOFF2 变体字体:轮廓不随 wght 变化

对象:`@fontsource-variable/jost/files/jost-latin-wght-normal.woff2`(Jost Version 3.710,wght 100–900,glyf + gvar + HVAR,glyf 表带 WOFF2 变换)。

1. `font.getVariation({ wght })` 直接抛 `Cannot read properties of undefined (reading 'tables')`:`TTFFont.getVariation` 用原始(压缩)流在 `_directoryPos` 处 `new TTFFont(stream, coords)`,WOFF2 目录被当作 sfnt 目录解析,得到的表名全是二进制垃圾(`src/TTFFont.js:521-527`,WOFF2Font 没有覆写)。
2. 绕过第 1 条(`fontkit.create(buffer)` 后设 `variationCoords`,与 `getVariation` 内部做的一样)之后,`glyphForCodePoint('l').bbox` 在 wght 400/500/600/700 下**全部**是 `75–155`(stem 80),而 advance 从 230 涨到 270:HVAR 被应用了,gvar 没有。原因在 `src/glyph/WOFF2Glyph.js`:`_decode()` 直接返回 `WOFF2Font._transformGlyfTable()` 预解码的点,跳过了 `TTFGlyph._decodeSimple` 里调用 `_variationProcessor.transformPoints` 的那一段(`src/glyph/TTFGlyph.js:171-175`)。

结论:fontkit 2.0.4 对 glyf 变换过的 WOFF2 不支持变体轮廓。处理方式是先用 `wawoff2`(Google woff2 参考实现的 WASM 编译,`decompress` 无损还原 TTF 字节,26,576 → 56,864 bytes,magic `0x00010000`)展开,再 `fontkit.create(ttf)`。同一字体经这条路径:wght 400 stem 80、500 → 108、551 → 120、600 → 130、700 → 152,advance 与 WOFF2 路径一致。

## 其他

- `Path.toSVG()` 固定四舍五入到 2 位小数(`src/glyph/Path.js`);要 3 位就自己遍历 `path.commands` 序列化(`tools/brand/wordmark.ts`)。
- `Path.transform(a, b, c, d, e, f)` 返回新 Path(经 `mapPoints`),不改原对象;`glyph.path` 是缓存 getter。
- `font.version` 运行时是字符串 `"Version 3.710"`,`@types/fontkit` 标为 `number`。
- `layout('ualy')` 在 Jost 里四个位置的 `xOffset` 全 0、带不带 kern 特性 advance 相同:这几对没有字距调整。
