import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { browsing, signIn } from './support.ts'

// The key screens, as axe-core reads them against WCAG 2.1 A and AA, signed
// in as the people who use them. The shell's content security policy refuses
// injected script, which is what axe is, so this context alone passes over
// it; nothing else about the page is changed.

const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'
const axe = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../node_modules/axe-core/axe.min.js'),
  'utf8',
)

interface Violation {
  readonly id: string
  readonly impact: string | null
  readonly help: string
  readonly nodes: { readonly target: readonly string[]; readonly summary?: string }[]
}

const audit = async (page: Page): Promise<Violation[]> => {
  await page.addScriptTag({ content: axe })
  return page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: { run: (context: unknown, options: unknown) => Promise<{ violations: Violation[] }> }
      }
    ).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    return result.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      // axe's own node shape, which says why each one fails
      nodes: (nodes as unknown as { target: unknown[]; failureSummary?: string }[]).map(
        ({ target, failureSummary }) => ({ target: target.map(String), summary: failureSummary }),
      ),
    }))
  })
}

const SCREENS: readonly { name: string; who?: 'student' | 'counsellor'; route: string }[] = [
  { name: 'sign-in', route: '/login' },
  { name: 'batches', who: 'student', route: '/assessment/batches' },
  { name: 'my entries', who: 'student', route: `/assessment/batches/${BATCH}/my-entries` },
  { name: 'my result', who: 'student', route: `/assessment/batches/${BATCH}/my-result` },
  { name: 'review queue', who: 'counsellor', route: `/assessment/batches/${BATCH}/reviews` },
]

describe('the key screens, to assistive technology', () => {
  const session = browsing({ context: { bypassCSP: true } })

  for (const screen of SCREENS) {
    it(`has no serious or critical WCAG violation: ${screen.name}`, async () => {
      const page = session.page()
      if (screen.who !== undefined) await signIn(page, screen.who)
      await page.goto(screen.route)
      // not network idle: a batch page keeps its event stream open
      await page.getByRole('heading').first().waitFor()
      await page.waitForTimeout(1500)
      const violations = await audit(page)
      const report = violations.map(
        (one) =>
          `${one.impact ?? '?'} ${one.id} (${String(one.nodes.length)}): ${one.help} - ${one.nodes[0]?.target.join(' ') ?? ''} ${one.nodes[0]?.summary?.replace(/\s+/g, ' ').slice(0, 220) ?? ''}`,
      )
      console.log(`${screen.name}:\n  ${report.join('\n  ') || 'none'}`)
      expect(
        violations
          .filter((one) => one.impact === 'serious' || one.impact === 'critical')
          .map((one) => one.id),
      ).toEqual([])
    })
  }
})
