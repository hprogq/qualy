import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// A plugin must typecheck on its own, not merely in company.
//
// Services reach a plugin as `ctx.<name>`, typed by the owning plugin's
// `declare module 'cordis'`. That augmentation arrives only if something in
// the file's own program pulls it in, and the root tsconfig compiles every
// package together, so a plugin that never imports its peer still typechecks
// here while having no type for the call at all.
//
// It was not hypothetical: org called `ctx.auth.iam.usersBlockingOrgType`
// without importing @qualy/plugin-auth anywhere, and ping and auth-local had
// the same hole. Nothing failed, because nothing ever compiled them alone.
//
// This matters beyond tidiness. The Effect migration turns these calls into
// service tags, which are values rather than ambient types, and a call whose
// type exists only by accident cannot be ported faithfully.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const probe = path.join(repoRoot, 'tsconfig.plugin-isolation.probe.json')

const pluginDirs = fs
  .readdirSync(path.join(repoRoot, 'packages/plugins'))
  .flatMap((group) => {
    const groupDir = path.join(repoRoot, 'packages/plugins', group)
    if (!fs.statSync(groupDir).isDirectory()) return []
    return fs.readdirSync(groupDir).map((name) => path.join('packages/plugins', group, name))
  })
  .filter((dir) => fs.existsSync(path.join(repoRoot, dir, 'src')))

afterAll(() => {
  fs.rmSync(probe, { force: true })
})

const typecheckAlone = (dir: string) => {
  fs.writeFileSync(
    probe,
    JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: { noEmit: true },
      include: [`${dir}/src/**/*.ts`],
    }),
  )
  try {
    execFileSync('node_modules/.bin/tsc', ['-p', probe, '--noEmit'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? String(error)
  }
}

describe('every plugin typechecks on its own', () => {
  it('found plugins to check', () => {
    expect(pluginDirs.length).toBeGreaterThan(5)
  })

  for (const dir of pluginDirs) {
    it(`${dir.split('/').slice(-1)[0]} needs no other plugin in its program`, () => {
      const output = typecheckAlone(dir)
      // the failure this guards reads as "Property 'auth' does not exist on
      // type 'Context'", so point at the fix rather than only the symptom
      expect(
        output,
        `${dir} does not typecheck alone. A service reached as ctx.<name> needs the owning plugin's module augmentation in this program: add \`import type {} from '@qualy/plugin-<name>'\`.\n${output}`,
      ).toBe('')
    })
  }
})
