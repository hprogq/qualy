import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OpenApi } from 'effect/unstable/httpapi'
import type { AuditAction } from '../../packages/contracts/audit/src/action.ts'
import { servedApi } from './support/served-api.ts'

// A secret a tenant gave the product never comes back out of it.
//
// An entrance's client secret, a refresh token, a password: each is written
// once, kept encrypted, and read only by the code that spends it. What this
// refuses is the two ways one leaks by accident - an api answering with it
// because a row was handed to a screen whole, and an audit event recording
// what a setting changed TO. Both are one property name away at any time,
// which is why it is a gate rather than a review note.
//
// Field NAMES, not values: a value cannot be searched for here, and the name
// is what a serializer would put it under.

const root = fileURLToPath(new URL('../..', import.meta.url))

// The names a secret VALUE is carried under. A field called `secret` is not
// one of them: the entrances response declares what an entrance's credential
// box looks like - its label and the lengths it takes - and says nothing that
// was typed into it.
const FORBIDDEN = /^(client_?secret|refresh_?token|access_?token|password)$/i

/** every property name a schema fragment declares, however deep */
const propertiesOf = (node: unknown, found: string[] = []): string[] => {
  if (node === null || typeof node !== 'object') return found
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && value !== null && typeof value === 'object') {
      found.push(...Object.keys(value))
    }
    propertiesOf(value, found)
  }
  return found
}

describe('what a caller can be told', () => {
  it('never names a secret in a successful response', () => {
    const document = OpenApi.fromApi(servedApi) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
      components?: unknown
    }
    const offenders: string[] = []
    for (const [route, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (!status.startsWith('2')) continue
          const named = propertiesOf(response).filter((name) => FORBIDDEN.test(name))
          for (const name of new Set(named)) {
            offenders.push(`${method.toUpperCase()} ${route} answers with "${name}"`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

const pluginsDir = path.join(root, 'packages/plugins')

const actionFiles = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((group) => group.isDirectory())
  .flatMap((group) =>
    fs
      .readdirSync(path.join(pluginsDir, group.name), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(pluginsDir, group.name, entry.name, 'src/actions.ts')),
  )
  .filter((file) => fs.existsSync(file))

const isAction = (value: unknown): value is AuditAction =>
  typeof value === 'object' &&
  value !== null &&
  (value as { _tag?: unknown })._tag === 'AuditAction'

const actions = (
  await Promise.all(
    actionFiles.map(async (file) => {
      const module = (await import(file)) as Record<string, unknown>
      return Object.values(module)
        .filter(isAction)
        .map((action) => ({ action, declaredIn: path.relative(root, file) }))
    }),
  )
).flat()

describe('what the audit trail records', () => {
  it('found the actions to check', () => {
    expect(actions.length).toBeGreaterThan(20)
  })

  it('names what changed, never a secret it changed to', () => {
    const offenders = actions.flatMap(({ action, declaredIn }) => {
      const fields = Object.keys(
        (action.details as unknown as { fields?: Record<string, unknown> }).fields ?? {},
      )
      return fields
        .filter((name) => FORBIDDEN.test(name))
        .map((name) => `${action.code} records "${name}" (${declaredIn})`)
    })
    expect(offenders).toEqual([])
  })
})
