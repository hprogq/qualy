import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Every constraint a plugin translates has to be one the database actually has.
//
// A translator maps a constraint name to a domain error, and the name is a
// bare string. Three of the names org translates belong to auth and rbac
// (fk_users_primary_org_node, fk_role_grants_node,
// fk_role_allowed_org_types_type), so a rename in one plugin silently breaks
// error translation in another: the constraint still fires, but nothing
// recognises it, and a domain error degrades into an untranslated 500.
//
// The lineage is the ground truth rather than the schema source, because the
// lineage is what the running database was built from. A name that only exists
// in a table definition nobody has migrated yet would still fail in production.

const repoRoot = path.resolve(import.meta.dirname, '../..')

const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full)
        return full
      })
    : []

const lineage = walk(path.join(repoRoot, 'db/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

/** the constraint names each translator claims it can explain */
const translated = () => {
  const sources = walk(path.join(repoRoot, 'packages/plugins')).filter(
    (file) => file.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(file),
  )
  const found = new Map<string, string>()
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8')
    const start = text.indexOf('createConstraintTranslator(')
    if (start < 0) continue
    // the keys of the object literal handed to the translator
    for (const match of text.slice(start).matchAll(/^\s{2}((?:uq|fk|chk|idx)_[a-z0-9_]+):/gm)) {
      found.set(match[1]!, path.relative(repoRoot, file))
    }
  }
  return found
}

describe('constraint names crossing a plugin boundary', () => {
  it('found translators to check', () => {
    expect(lineage.length).toBeGreaterThan(0)
    expect(translated().size).toBeGreaterThan(5)
  })

  it('names a constraint the deployed lineage actually creates', () => {
    const missing = [...translated()]
      .filter(([name]) => !lineage.includes(name))
      .map(([name, file]) => `${file} translates ${name}, which no migration creates`)
    expect(missing).toEqual([])
  })
})
