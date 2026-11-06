import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findServerFunctions,
  productSourceRoots,
  serverDirectivesIn,
} from '../quality/check-server-functions.ts'

// Server functions stay off until an ADR turns them on
// (docs/adr/0012-rsc-data-mode.md): no product module declares one.

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('server functions', () => {
  it('are declared nowhere in the product', () => {
    expect(findServerFunctions(productSourceRoots(repoRoot))).toEqual([])
  })

  it('are found at the top of a module and at the top of a function body', () => {
    const module = `'use server'\nexport async function save() {}\n`
    const inline = `export function Page() {\n  async function save() {\n    'use server'\n  }\n  return <form action={save} />\n}\n`
    expect(serverDirectivesIn(module, 'a.ts')).toHaveLength(1)
    expect(serverDirectivesIn(inline, 'a.tsx')).toHaveLength(1)
  })

  it('are not the words in a string, or a directive that is not first', () => {
    const words = `const said = 'use server'\nexport const x = () => { const y = 1; 'use server' }\n`
    const client = `'use client'\nexport const z = 1\n`
    expect(serverDirectivesIn(words, 'a.ts')).toEqual([])
    expect(serverDirectivesIn(client, 'a.ts')).toEqual([])
  })
})
