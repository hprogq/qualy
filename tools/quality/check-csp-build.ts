import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// No code from strings in the browser bundle.
//
// The shell's script policy names 'self' and the hash of one inline
// script, and nothing else: no `eval`, no `Function` from a string. A
// dependency that compiles code at run time - a schema compiler, a
// template engine, a JIT - is reported while the policy is reported-only
// and stopped once it is enforced, so the build is read for the three
// spellings of it here, after every build. A method named eval on an
// object is not the global; a property access before the name rules it
// out, and so does a body after the parentheses: `eval(t){...}` defines a
// method. `Function('')` is a feature probe - an empty program runs nothing
// - which a library may make once to learn whether it may compile at all.

const distAssets = path.join(repoRoot, 'apps/web/dist/assets')
const SPELLINGS: readonly [name: string, pattern: RegExp][] = [
  ['eval(', /(?<![\w$.])eval\s*\(/g],
  ['new Function(', /\bnew\s+Function\s*\(/g],
  ['Function("...")', /(?<![\w$.])Function\s*\(\s*["'`]/g],
]

/** whether the parenthesis opened at `open` closes into a block: a definition, not a call */
const definesMethod = (source: string, open: number): boolean => {
  let depth = 0
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return /^\s*\{/.test(source.slice(at + 1, at + 4))
    }
  }
  return false
}

/** `Function('')`, `Function("")`, `Function(\`\`)`: an empty program, a probe */
const emptyProgram = (source: string, at: number): boolean =>
  /^Function\s*\(\s*(''|""|``)\s*\)/.test(source.slice(at, at + 24))

if (!fs.existsSync(distAssets)) {
  console.error(`check-csp-build: ${distAssets} is missing; run the web build first`)
  process.exit(1)
}

const findings: string[] = []
for (const name of fs.readdirSync(distAssets).sort()) {
  if (!name.endsWith('.js')) continue
  const source = fs.readFileSync(path.join(distAssets, name), 'utf8')
  for (const [spelling, pattern] of SPELLINGS) {
    for (const match of source.matchAll(pattern)) {
      const at = match.index
      if (spelling === 'eval(' && definesMethod(source, source.indexOf('(', at))) continue
      if (spelling.startsWith('Function') && emptyProgram(source, at)) continue
      const around = source.slice(Math.max(0, at - 80), at + 80).replace(/\s+/g, ' ')
      findings.push(`${name}: ${spelling} at ${String(at)}: ...${around}...`)
    }
  }
}

if (findings.length > 0) {
  console.error(`check-csp-build: ${String(findings.length)} place(s) make code from strings:`)
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}
console.log('check-csp-build: no code from strings in the bundle')
