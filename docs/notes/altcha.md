# ALTCHA：实查记录（2026-09-24）

依据是装进仓库的发布物（`altcha-lib@2.5.0`、`altcha@3.2.3`），不是记忆或旧文档。

## altcha-lib 2.5.0（服务端）

- 默认入口 `altcha-lib` 即 v2：`createChallenge`、`verifySolution`、`solveChallenge`、`randomInt`、`HmacAlgorithm`。v1 在 `altcha-lib/v1`，本仓库不用。
- `deriveKey`：Node 用 `altcha-lib/algorithms/pbkdf2`，浏览器 / WebCrypto 用 `altcha-lib/algorithms/web/pbkdf2`。
- `randomInt(max, min)`：参数顺序是 **max 在前**。
- 挑战形状：`{ parameters: { algorithm, nonce, salt, cost, keyLength, keyPrefix, keySignature?, expiresAt?(秒), data? }, signature }`。
  签名是对 `parameters` 的 canonical JSON 做 HMAC，**`data` 在签名范围内**，所以我们放进 data 的 tenant / purpose / bindingHash 不可篡改。
- `verifySolution` 顺序：`expiresAt`（秒，缺省即不检查——我们总是设置）→ 签名 → 有 `keySignature` 且给了 `hmacKeySignatureSecret` 时只比对
  `derivedKey` 的 HMAC（快速路径，不重算 PBKDF2）。`hexToBuffer` 对奇数长度 hex 会抛出，所以 payload 先按 Schema 校验 `derivedKey` 为偶数长度小写 hex。
- widget 提交的 payload 是 `base64(JSON { challenge, solution })`（`frameworks/shared.js` 的 `parsePayload`）。
- 自带的 `store` 重放防护只是框架插件的可选项；本仓库用自己的表 `captcha_altcha_used_challenges`，一条 `insert … on conflict do nothing returning` 判定。

## altcha 3.2.3（浏览器 widget）

- `altcha/external`：不内嵌 worker（默认构建内嵌 worker 并从 `blob:` 启动，严格 CSP 下被 `worker-src 'self'` 拒绝）。external 构建里没有 `createObjectURL` / `new Blob(`，
  由 `packages/plugins/infra/captcha-altcha/tests/csp.test.ts` 守住。
- worker：`import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker'`，再 `$altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker())`；Vite 把它产出为同源文件。
- 样式：`altcha/altcha.css`（external 不注入样式）。
- **方法要等 `load` 事件之后才存在**：刚 append 的元素上 `configure` 还不是函数（实测 `TypeError: widget.configure is not a function`）。先挂 `load` 监听再 append。
- `configure({ challenge, auto: 'onload', display: 'invisible', workers, hideFooter, hideLogo })`：`challenge` 可以直接是挑战对象，不必是 URL。
- 事件：`verified` 的 detail 是 `{ payload: string }`；`statechange` 的 detail 是 `{ state, payload? }`，state 取值 `code | error | verified | verifying | unverified | expired`；另有 `expired`、`load`。

## 解题耗时实测（cost 5000，PBKDF2/SHA-256，Apple M2 Max）

| 环境 | counter 5000 | 7500 | 10000 |
| --- | --- | --- | --- |
| Node 24，单线程 `solveChallenge` | 2.6 s | 3.9 s | 5.2 s |
| Chromium，driver + 1 个 worker | 2.2 s | 3.2 s | 4.3 s |

单次派生约 0.5 ms。counter 按 `randomInt(5000, 10000)` 均匀抽取，期望约 3.2 s（桌面）。**低端手机通常慢数倍**，同样参数可能到 10 s 以上；
这组数字是 docs/captcha.md §36 定的起点，是否下调 cost / counter 或增加 worker 数，要等真机数据再定，不在这里拍板。

对照安全侧：攻击者单核每次密码尝试同样付出约 3–4 s 的 CPU（PBKDF2 对浏览器和脚本是对称的），即单核每小时约 1000 次受 CAPTCHA 保护的尝试。
