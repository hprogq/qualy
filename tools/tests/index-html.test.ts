import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BOOT_PLACEHOLDER, bootFrame } from '../../packages/web/brand/src/boot.ts'
import { INLINE_BOOT_SCRIPT_HASH } from '../../packages/plugins/infra/web/src/server/shell-policy.ts'
import { injectBootFrame } from '../../packages/build/web/src/vite.ts'

// What index.html still carries by hand, and why, since the file itself
// ships to every browser and explains nothing:
//
// - the cascade layer order, declared before any stylesheet can declare its
//   own (a layer's position is fixed by its first declaration; in dev the
//   StyleX runtime's sheet arrives ahead of app.css), kept in step with
//   src/app.css and tests/support/cascade-layers.ts;
// - the boot script: it resolves the colour scheme before anything paints,
//   from the same key the runtime's ThemeProvider persists under and the
//   system preference when nothing is stored, setting the same class the
//   tokens switch on; and it is the watchdog that offers a reload when the
//   application never takes over. The shell's content security policy
//   allows it by the hash of its exact bytes, so the constant the policy
//   carries must be this script's digest, of the file as served (Vite
//   leaves a non-module inline script untouched; the staged copy is
//   compared when it exists);
// - the first frame's colours, the application's own background and
//   foreground tokens, written as values because the frame must not wait
//   for tokens.css - and pinned here to the sheet, since a theme change
//   that forgot this file would paint the first frame in the old colours;
// - the marker the build replaces with the first frame itself, which is
//   generated from the brand's geometry and no longer written by hand.

const ROOT = path.resolve(import.meta.dirname, '../..')
const html = fs.readFileSync(path.join(ROOT, 'apps/web/index.html'), 'utf8')
const theme = fs.readFileSync(path.join(ROOT, 'packages/web/runtime/src/theme.tsx'), 'utf8')
const tokens = fs.readFileSync(path.join(ROOT, 'packages/web/ui/src/styles/tokens.css'), 'utf8')

const scriptOf = (source: string) => /<script>([\s\S]*?)<\/script>/.exec(source)?.[1]

describe('the shell source', () => {
  it('carries the marker and no first frame of its own', () => {
    expect(html).toContain(BOOT_PLACEHOLDER)
    expect(html).not.toContain('id="qualy-boot"')
    expect(html).not.toContain('<svg')
    // the marker is the one comment: everything else in this file ships
    expect(html.match(/<!--/g)).toHaveLength(1)
  })

  it('hashes the boot script exactly as the content security policy allows it', () => {
    const script = scriptOf(html)
    expect(script).toBeDefined()
    const digest = `sha256-${createHash('sha256').update(script!).digest('base64')}`
    expect(INLINE_BOOT_SCRIPT_HASH).toBe(digest)
    // the served file is the staged one; when a build exists, its script is
    // the same bytes, or the hash above allows a script nobody serves
    const staged = path.join(ROOT, 'packages/plugins/infra/web/client-dist/index.html')
    if (fs.existsSync(staged)) {
      expect(scriptOf(fs.readFileSync(staged, 'utf8'))).toBe(script)
    }
  })

  it('resolves the theme from the key the application persists under', () => {
    const key = /const STORAGE_KEY = '([^']+)'/.exec(theme)?.[1]
    expect(key).toBeDefined()
    expect(html).toContain(`localStorage.getItem('${key}')`)
  })

  it('paints the application’s own colours', () => {
    const token = (block: string, name: string) =>
      new RegExp(`${block} \\{[^}]*--q-${name}: ([^;]+);`).exec(tokens)?.[1]
    expect(html).toContain(`background: ${token(':root', 'background')};`)
    expect(html).toContain(`color: ${token(':root', 'foreground')};`)
    expect(html).toContain(`background: ${token('.dark', 'background')};`)
    expect(html).toContain(`color: ${token('.dark', 'foreground')};`)
  })

  it('names the favicon the export writes', () => {
    expect(html).toContain('href="/favicon.svg"')
    expect(fs.existsSync(path.join(ROOT, 'apps/web/public/favicon.svg'))).toBe(true)
  })
})

describe('the shell as built', () => {
  const built = injectBootFrame(html)

  it('carries the generated first frame where the marker was, and no comment', () => {
    expect(built).not.toContain(BOOT_PLACEHOLDER)
    expect(built).not.toContain('<!--')
    expect(built).toContain(bootFrame().markup)
    // in the body, before the application's root, so it is painted first
    expect(built.indexOf('id="qualy-boot"')).toBeLessThan(built.indexOf('id="root"'))
  })

  it('positions the frame through the properties the shell style reads', () => {
    const { placement, markup } = bootFrame()
    expect(markup).toContain(`--boot-top:${placement.top}`)
    expect(markup).toContain(`--boot-hint-gap:${placement.hintGap}px`)
    expect(html).toContain('top: var(--boot-top);')
    expect(html).toContain('margin: var(--boot-hint-gap) 0 0;')
  })

  it('refuses a source without the marker', () => {
    expect(() => injectBootFrame(html.replace(BOOT_PLACEHOLDER, ''))).toThrow(/marker/)
  })
})
