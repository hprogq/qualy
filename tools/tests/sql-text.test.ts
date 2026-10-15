import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript6'
import { describe, expect, it } from 'vitest'

// No value is ever written into a statement's text.
//
// Every statement's text is exported as `db.query.text`
// (packages/plugins/infra/database/src/server/statements.ts), on the promise
// that a value only ever travels as a bind parameter: the text is a template,
// `$1` where a value goes. Nothing at run time can tell a template from a
// statement with a value spliced in, so the promise is kept here, over the
// source: every way this codebase has of putting something into SQL text
// other than a parameter is found, whatever name it is imported under.
//
// Two kinds of finding. Writing a value into the text - `sql.raw`/`sql.lit`
// with anything but a literal, a template or concatenation handed to an
// `execute`, `CompiledQuery.raw`, MikroORM's raw helpers, the driver itself -
// is refused, except for the few entries below, each with its reason. Naming
// an identifier from a variable - `sql.ref(column)`, a builder given
// `` `u.${column}` `` - is how helpers take a column, so those are counted
// per file instead: a new one changes the count and asks to be looked at,
// because a name taken from a request would put that request into the text.
//
// Parsed with TypeScript 6's in-memory parser (the formula source policy's),
// so a call is a call however it is spelled, and a comment or a string that
// mentions `sql.raw` is not one.

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** the driver's module name, spelled apart so this file does not read as importing it */
const DRIVER = 'pg'

/** where the driver may be used directly: the plugin that owns it */
const DRIVER_HOME = 'packages/plugins/infra/database/src/'

/**
 * Not run under a query or a transaction, so never traced: the migrator,
 * the schema differ and the parity check build DDL from the entity model
 * and the migration files, on sessions of their own.
 */
const UNTRACED = [
  'packages/plugins/infra/database/src/migrator.ts',
  'packages/plugins/infra/database/src/assembly/',
  'packages/plugins/infra/database/src/parity.ts',
  'packages/plugins/infra/database/src/testkit.ts',
]

/** values written into text on purpose, each a closed set the code itself spells */
const ALLOWED: Record<string, string> = {
  // isolation and access mode from TransactionOptions' two literal unions
  'packages/plugins/infra/database/src/server/orm.ts execute: `set transaction ${mode}`':
    'mode is built from literal option values only',
  // LISTEN takes no parameter; the listener's own session, never pooled or
  // traced, and the channel is a plugin's constant, quoted as an identifier
  'packages/plugins/infra/database/src/server/notifications.ts query: `listen ${quoteIdentifier(channel)}`':
    'channel names are code constants, quoted',
}

/** identifiers named from a variable, per file; a change here is a change to review */
const DYNAMIC_IDENTIFIERS: Record<string, number> = {
  'packages/plugins/assessment/core/src/administrative-import/db.ts': 1,
  'packages/plugins/assessment/core/src/entry/db.ts': 1,
  'packages/plugins/assessment/core/src/item/db.ts': 1,
  'packages/plugins/assessment/core/src/review/db.ts': 1,
  'packages/plugins/assessment/core/src/scoring/db.ts': 1,
  'packages/plugins/assessment/core/src/scoring/recognition-db.ts': 1,
  'packages/plugins/assessment/core/src/server/db.ts': 13,
  'packages/plugins/base/auth/src/server/db.ts': 1,
  'packages/plugins/infra/storage/src/server/db.ts': 1,
}

/** builder methods that read their first argument as a table or column name */
const NAMING_METHODS = new Set([
  'where',
  'whereRef',
  'having',
  'on',
  'onRef',
  'select',
  'orderBy',
  'groupBy',
  'selectFrom',
  'updateTable',
  'insertInto',
  'deleteFrom',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'returning',
  'distinctOn',
  'column',
  'columns',
])

/** methods that send their argument to the server as text */
const EXECUTING_METHODS = new Set(['execute', 'executeQuery', 'query', 'raw'])

interface Finding {
  readonly file: string
  readonly line: number
  readonly kind: 'value' | 'identifier'
  readonly rule: string
  readonly text: string
}

const isLiteral = (node: ts.Node | undefined): boolean =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))

/** text built at run time: a template with substitutions, or a concatenation */
const isBuiltText = (node: ts.Node | undefined): boolean =>
  node !== undefined &&
  (ts.isTemplateExpression(node) ||
    (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken))

export const findings = (file: string, source: string): Finding[] => {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Finding[] = []
  const report = (node: ts.Node, kind: Finding['kind'], rule: string) => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree))
    found.push({ file, line: line + 1, kind, rule, text: node.getText(tree).split('\n')[0]! })
  }
  // every local name kysely's `sql` goes by, and every namespace it hangs off
  const sqlNames = new Set<string>()
  const kyselyNamespaces = new Set<string>()
  const ormRaw = new Set<string>()

  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const from = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (from === DRIVER && !file.startsWith(DRIVER_HOME))
      report(statement, 'value', 'driver import')
    if (bindings === undefined) continue
    if (ts.isNamespaceImport(bindings)) {
      if (from === 'kysely') kyselyNamespaces.add(bindings.name.text)
      continue
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (from === 'kysely' && imported === 'sql') sqlNames.add(element.name.text)
      if (from.startsWith('@mikro-orm/') && ['raw', 'sql', 'ref'].includes(imported)) {
        ormRaw.add(element.name.text)
        report(element, 'value', 'orm raw helper')
      }
    }
  }

  /** `sql`, under whatever name, or `kysely.sql` */
  const isSql = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && sqlNames.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      node.name.text === 'sql' &&
      ts.isIdentifier(node.expression) &&
      kyselyNamespaces.has(node.expression.text))

  const visit = (node: ts.Node): void => {
    // the helpers taken off `sql` and used under another name
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isSql(node.initializer))
      report(node, 'value', 'sql aliased')
    if (ts.isElementAccessExpression(node) && isSql(node.expression))
      report(node, 'value', 'sql indexed')

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const first = node.arguments[0]
      if (ts.isPropertyAccessExpression(callee) && isSql(callee.expression)) {
        const helper = callee.name.text
        if ((helper === 'raw' || helper === 'lit') && !isLiteral(first))
          report(node, 'value', `sql.${helper}`)
        if ((helper === 'ref' || helper === 'id' || helper === 'table') && !isLiteral(first))
          report(node, 'identifier', `sql.${helper}`)
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'CompiledQuery' &&
        callee.name.text === 'raw' &&
        !isLiteral(first)
      )
        report(node, 'value', 'CompiledQuery.raw')
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'executeQuery')
        report(node, 'value', 'executeQuery')
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text
        if (EXECUTING_METHODS.has(method) && isBuiltText(first))
          report(node, 'value', `${method} of built text`)
        else if (NAMING_METHODS.has(method) && isBuiltText(first))
          report(node, 'identifier', `${method} of built name`)
      }
      if (ts.isIdentifier(callee) && ormRaw.has(callee.text) && !isLiteral(first))
        report(node, 'value', 'orm raw')
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

const productionSources = (): string[] => {
  const listed = spawnSync(
    'git',
    [
      'ls-files',
      '--',
      'apps/*/src/**.ts',
      'apps/*/src/**.tsx',
      'packages/**/src/**.ts',
      'packages/**/src/**.tsx',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (listed.status !== 0) throw new Error(listed.stderr)
  return listed.stdout
    .split('\n')
    .filter((file) => file !== '' && !UNTRACED.some((skip) => file.startsWith(skip)))
}

const keyOf = (finding: Finding) => {
  const builtText = /`[^`]*`/.exec(finding.text)?.[0] ?? finding.text
  return `${finding.file} ${finding.rule.split(' ')[0]}: ${builtText}`
}

describe('what a statement text may contain', () => {
  const all = productionSources().flatMap((file) =>
    findings(file, fs.readFileSync(path.join(ROOT, file), 'utf8')),
  )

  it('writes no value into a statement text', () => {
    const refused = all
      .filter((finding) => finding.kind === 'value' && ALLOWED[keyOf(finding)] === undefined)
      .map((finding) => `${finding.file}:${finding.line} ${finding.rule}: ${finding.text}`)
    expect(refused).toEqual([])
    // and every allowance still names something that exists
    const used = new Set(all.map(keyOf))
    expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([])
  })

  it('names identifiers from variables only where it already did', () => {
    const counted: Record<string, number> = {}
    for (const finding of all.filter((one) => one.kind === 'identifier'))
      counted[finding.file] = (counted[finding.file] ?? 0) + 1
    expect(counted).toEqual(DYNAMIC_IDENTIFIERS)
  })
})

// The finder itself, on the shapes it exists to catch: a gate whose matcher
// silently stopped matching passes forever.
describe('the finder', () => {
  const rules = (source: string, file = 'fixture/src/a.ts') =>
    findings(file, source).map((finding) => `${finding.kind} ${finding.rule}`)

  it('follows sql under any name', () => {
    expect(rules(`import { sql as q } from 'kysely'\nq.raw(input)`)).toEqual(['value sql.raw'])
    expect(rules(`import * as K from 'kysely'\nK.sql.lit(input)`)).toEqual(['value sql.lit'])
    expect(rules(`import { sql } from 'kysely'\nconst { raw } = sql`)).toEqual([
      'value sql aliased',
    ])
    expect(rules(`import { sql } from 'kysely'\nconst s = sql\n`)).toEqual(['value sql aliased'])
    expect(rules(`import { sql } from 'kysely'\nsql['raw'](x)`)).toEqual(['value sql indexed'])
  })

  it('lets literals and parameters through', () => {
    expect(
      rules(
        `import { sql } from 'kysely'\nsql.raw('now()'); sql.lit(\`x\`); sql.val(input); sql\`select \${input}\``,
      ),
    ).toEqual([])
  })

  it('finds text built for execution, and names built for builders', () => {
    expect(rules('em.execute(`select ${input}`)')).toEqual(['value execute of built text'])
    expect(rules("client.query('select ' + input)")).toEqual(['value query of built text'])
    expect(rules('CompiledQuery.raw(text, [])')).toEqual(['value CompiledQuery.raw'])
    expect(rules('k.executeQuery(compiled)')).toEqual(['value executeQuery'])
    expect(rules("q.where(`u.${column}`, '=', value)")).toEqual(['identifier where of built name'])
    expect(rules(`import { sql } from 'kysely'\nsql.ref(column)`)).toEqual(['identifier sql.ref'])
  })

  it('refuses the driver and the orm raw helpers outside their home', () => {
    expect(rules(`import { Client } from '${DRIVER}'`)).toEqual(['value driver import'])
    expect(rules(`import { Client } from '${DRIVER}'`, `${DRIVER_HOME}server/x.ts`)).toEqual([])
    expect(rules(`import { raw } from '@mikro-orm/core'\nraw(input)`)).toEqual([
      'value orm raw helper',
      'value orm raw',
    ])
  })
})
