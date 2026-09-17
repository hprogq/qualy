# Vitest 实查记录

## 5.0.1:`toHaveTextContent` 是全文全等,部分匹配用 `toMatchTextContent`(2026-09-17)

`expect.element(el).toHaveTextContent('等级')` 在元素文本为「当前认定行政认定王老师 · 3/2/2026, 8:00:00 AM等级省级」时**失败**,
报错的 Received 里明明含有期望的字。实查 `@vitest/browser@5.0.1` 的 `dist/expect-element.js`:

- `toHaveTextContent`(压缩后 `wn`):`pass: i === a`,即(默认归一化空白后的)整段 textContent 与参数**全等**。
- `toMatchTextContent`(压缩后 `kn`):`pass: !a && yt(i, t)`,字符串做**包含**匹配、RegExp 做 test,空字符串参数拒绝——即 4.x
  `toHaveTextContent` 的旧语义(同目录 `@vitest/browser@4.1.10` 里 `mn` 仍是这个实现)。

后果:从 4.x 沿用下来的「部分文本」断言会在 5.x 上一直失败到超时。本仓库其余 `toHaveTextContent` 用法都是对单值 testid
(`'1.00'`、`'true'`、`'0'`)做全等,语义正确;要断言「包含」一律写 `toMatchTextContent`。

触发:`participant-results.browser.test.tsx` 原先在卡片可见时只读一次 `textContent`,CI 上字段名(第二个请求)未到而失败;
改成可重试断言时撞上此语义。
