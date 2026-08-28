# Upstream issue draft — pnpm

Submit at https://github.com/pnpm/pnpm/issues/new (Bug report).

---

## Title

`pnpm run` is killed by SIGINT instead of waiting for the script and reporting
its exit status (regression in 12.0.0)

---

## Describe the bug

A terminal delivers Ctrl+C to the whole foreground process group, so both
`pnpm` and the script it runs receive SIGINT. A script that traps the signal
and shuts down gracefully finishes normally, but under pnpm 12 the shell
reports the command as _killed by SIGINT_ rather than as exiting 0.

pnpm 11.8.0 and npm both survive the signal, wait for the child, and exit with
the child's status. pnpm 12.0.0 dies by the signal first — the child's
graceful shutdown still completes, and its exit status is simply never
reported.

The condition is that the child takes time to stop. A script that exits
immediately on SIGINT is reported as signal-killed by both versions, because
neither runner is still around either way; the difference appears as soon as
the script has anything to finish, which any long-running development process
does.

## Reproduction

```
mkdir repro && cd repro
```

`package.json`

```json
{ "name": "repro", "private": true, "scripts": { "dev": "node run.mjs" } }
```

`run.mjs`

```js
process.on('SIGINT', () => {
  console.log('child: handling SIGINT')
  setTimeout(() => {
    console.log('child: exiting 0')
    process.exit(0)
  }, 1200)
})
console.log('ready')
setInterval(() => {}, 1000)
```

Run `pnpm dev` in its own process group and interrupt the whole group, the way
a terminal does:

```js
import { spawn } from 'node:child_process'
const child = spawn('pnpm', ['dev'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (chunk) => {
  out += chunk
})
const poll = setInterval(() => {
  if (!out.includes('ready')) return
  clearInterval(poll)
  process.kill(-child.pid, 'SIGINT')
}, 200)
child.on('exit', (code, signal) => console.log(`code=${code} signal=${signal}`))
```

## Expected behavior

`code=0 signal=null`, which is what pnpm 11.8.0 and npm both report.

## Actual behavior

`code=null signal=SIGINT` on pnpm 12.0.0. Three runs of each, on the same
machine and the same script:

| runner         | result                          |
| -------------- | ------------------------------- |
| `node run.mjs` | `code=0 signal=null`            |
| `npm run dev`  | `code=0 signal=null`            |
| pnpm 11.8.0    | `code=0 signal=null` (3/3)      |
| pnpm 12.0.0    | `code=null signal=SIGINT` (3/3) |

The child's own output confirms it finished: `["ready", "child: handling
SIGINT", "child: exiting 0"]`.

## Which versions of pnpm are affected?

12.0.0. Not 11.8.0.

## Which Node.js version are you using?

24.20.0, macOS arm64.
