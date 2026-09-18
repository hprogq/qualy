import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { formulaMessages as m } from './i18n.ts'
import { inputFactsOf } from './report-words.ts'

// The examples a template was published with, read rather than run.
//
// They are the fastest way to see what the formula does with real values, and
// the only part of a template a reader cannot get from the source at a glance.
// Nothing here runs: this version is somebody else's publication, and running
// it is what the copy in your own formulas is for.

const styles = stylex.create({
  panel: {
    display: 'flex',
    width: { default: 'min(440px, 92vw)', [breakpoints.phone]: '100%' },
    flexDirection: 'column',
    gap: 0,
    padding: 0,
  },
  list: {
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    flexGrow: 1,
    gap: 10,
    overflowY: 'auto',
    padding: 20,
  },
  example: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 14,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
  },
  name: { fontSize: 13, fontWeight: 500, color: tokens.foreground },
  facts: { display: 'flex', flexDirection: 'column', gap: 4 },
  factsLabel: {
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  fact: { display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12 },
  factLabel: { minWidth: 76, flexShrink: 0, color: tokens.mutedForeground },
  factValue: { minWidth: 0, color: tokens.foreground, wordBreak: 'break-word' },
  expected: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    fontSize: 12,
  },
  expectedValue: {
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
})

export function TemplateExamplesSheet({
  open,
  onOpenChange,
  examples,
  schema,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly examples: readonly { name: string; input: unknown; expected: string }[]
  /** the version's own input structure, which names and orders the fields */
  readonly schema: NormalizedInputSchema | null
}) {
  const { format, locale } = useI18n()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" xstyle={styles.panel}>
        <SheetHeader>
          <SheetTitle>{format(m.testsTitle)}</SheetTitle>
          <SheetDescription>{format(m.templatesExamplesHint)}</SheetDescription>
        </SheetHeader>
        <div data-testid="template-examples" {...stylex.props(styles.list)}>
          {(open ? examples : []).map((example, index) => (
            <div key={index} data-testid="template-example" {...stylex.props(styles.example)}>
              <span {...stylex.props(styles.name)}>{example.name}</span>
              <div {...stylex.props(styles.facts)}>
                <span {...stylex.props(styles.factsLabel)}>{format(m.testInputLabel)}</span>
                {inputFactsOf(format, locale, schema, example.input).map((fact) => (
                  <span key={fact.label} {...stylex.props(styles.fact)}>
                    <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
                    <span {...stylex.props(styles.factValue)}>{fact.value}</span>
                  </span>
                ))}
              </div>
              <span {...stylex.props(styles.expected)}>
                <span {...stylex.props(styles.factLabel)}>{format(m.expectedLabel)}</span>
                <span {...stylex.props(styles.expectedValue)}>{example.expected}</span>
              </span>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
