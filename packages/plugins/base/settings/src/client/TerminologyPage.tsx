import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { Card, Cell, LeadWord, Table, TableRow, Tag } from '@qualy/ui/screen'
import { FormDialog } from '@qualy/ui/admin'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { Screen } from '@qualy/ui/screen'
import { Reveal } from '@qualy/ui/reveal'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { settingsApi } from './api.ts'
import { settingsMessages as m } from './i18n.ts'
import { TERMINOLOGY_KEY, useTerminology } from './terms.ts'

// The words this tenant uses, drawn the way the rest of the library is: a
// masthead, then one white sheet per category with a term to a row. A dozen
// terms at most, each with a box per language beside its name. A box left
// empty means the default; the default is written under it so nobody has to
// remember what "empty" resolves to.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    gap: { default: 20, [breakpoints.phone]: 16 },
  },
  heading: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  title: { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em' },
  hint: { margin: 0, fontSize: 14, color: tokens.mutedForeground },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: 500, color: tokens.mutedForeground },
  // The sheet stays at every width. A roster's rows are a list, and a list
  // on a phone is read straight off the page; these are FORMS - a name, a
  // note and two fields each - and without a sheet under them they are a
  // column of loose boxes with nothing saying where one term ends.
  sheet: {
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  // the name on one side, what it is called on the other; stacked where the
  // two will not fit abreast
  term: {
    display: 'grid',
    alignItems: 'start',
    columnGap: 32,
    rowGap: 14,
    gridTemplateColumns: {
      default: 'minmax(0, 15rem) minmax(0, 1fr)',
      '@media (max-width: 899.98px)': 'minmax(0, 1fr)',
    },
    paddingInline: { default: 20, [breakpoints.phone]: 16 },
    paddingBlock: { default: 18, [breakpoints.phone]: 16 },
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  termHead: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 5 },
  termTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  termNote: { margin: 0, fontSize: 12, lineHeight: 1.6, color: tokens.mutedForeground },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  // The two languages abreast only where both are still a field rather than
  // a slot: inside the right-hand column of a split row, 640px left each of
  // them about nine characters wide.
  boxes: {
    display: 'grid',
    gap: { default: 12, '@media (min-width: 1040px)': 16 },
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 1040px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  empty: {
    margin: 0,
    paddingInline: { default: 20, [breakpoints.phone]: 16 },
    paddingBlock: 28,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
})

const LOCALE_NAME = {
  'zh-CN': m.localeZhCN,
  'en-US': m.localeEnUS,
} as const

export default function TerminologyPage() {
  const { format, formatText, formatError } = useI18n()
  // Narrow, a dozen terms means a dozen forms opened at once - two boxes and
  // two buttons each, a screen apiece. The list says what every word is
  // called today; changing one is a press away, in the panel that opens.
  const phone = useIsBelow(768)
  const terminology = useTerminology()
  const categories = [...(terminology.data?.categories ?? [])].sort((a, b) => a.order - b.order)
  const terms = terminology.data?.terms ?? []
  return (
    <Screen title={format(m.title)} description={format(m.hint)}>
      <div {...stylex.props(styles.page)} data-testid="terminology-page">
        <AsyncSection
          pending={terminology.isPending}
          error={terminology.isError ? formatError(terminology.error) : null}
          loadingLabel={format(m.loading)}
          retryLabel={format(m.retry)}
          onRetry={() => void terminology.refetch()}
        >
          {terms.length === 0 ? (
            <div {...stylex.props(styles.sheet)}>
              <p {...stylex.props(styles.empty)}>{format(m.empty)}</p>
            </div>
          ) : (
            categories.map((category) => {
              const own = terms
                .filter((term) => term.categoryId === category.id)
                .sort((a, b) => a.order - b.order)
              if (own.length === 0) return null
              return (
                <section key={category.id} {...stylex.props(styles.section)}>
                  <span {...stylex.props(styles.sectionLabel)}>{formatText(category.label)}</span>
                  {phone ? (
                    <Card>
                      <Table columns="minmax(0, 1fr) auto" openable>
                        {own.map((term) => (
                          <TermRow key={`${term.id}:${term.version}`} term={term} />
                        ))}
                      </Table>
                    </Card>
                  ) : (
                    <div {...stylex.props(styles.sheet)}>
                      {own.map((term) => (
                        <TermEditor key={`${term.id}:${term.version}`} term={term} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </AsyncSection>
      </div>
    </Screen>
  )
}

type Term = NonNullable<ReturnType<typeof useTerminology>['data']>['terms'][number]

/** the drafts for one term, and the one write that saves or clears them */
function useTermDraft(term: Term) {
  const { format, formatError } = useI18n()
  const api = useApi(settingsApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<SupportedLocale, string>>(() => ({
    'zh-CN': term.override['zh-CN'] ?? '',
    'en-US': term.override['en-US'] ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const customised = supportedLocales.some((locale) => (term.override[locale] ?? '') !== '')
  const dirty = supportedLocales.some(
    (locale) => drafts[locale].trim() !== (term.override[locale] ?? ''),
  )
  const [namespace, name] = term.id.split('/') as [string, string]

  const write = async (override: Record<SupportedLocale, string>) => {
    setSaving(true)
    try {
      await run(
        api.settings.putTerm({
          params: { namespace, name },
          payload: { version: term.version, override },
        }),
      )
      await queryClient.invalidateQueries({ queryKey: TERMINOLOGY_KEY })
      toast.success(format(m.saved))
      return true
    } catch (error) {
      toast.error(formatError(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  return { drafts, setDrafts, saving, customised, dirty, write }
}

/** a box per language, with the default written under it */
function TermBoxes({
  term,
  drafts,
  setDrafts,
  saving,
}: {
  term: Term
  drafts: Record<SupportedLocale, string>
  setDrafts: (
    next: (current: Record<SupportedLocale, string>) => Record<SupportedLocale, string>,
  ) => void
  saving: boolean
}) {
  const { format } = useI18n()
  return (
    <>
      {supportedLocales.map((locale) => (
        <Field
          key={locale}
          label={format(LOCALE_NAME[locale])}
          hint={format(m.defaultWord, { value: term.defaults[locale] ?? '' })}
        >
          {(id) => (
            <Input
              id={id}
              value={drafts[locale]}
              maxLength={term.maxLength}
              placeholder={term.defaults[locale]}
              disabled={saving}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [locale]: event.target.value }))
              }
            />
          )}
        </Field>
      ))}
    </>
  )
}

/** one term: a box per language, saved as one resource under the version it was read at */
function TermEditor({ term }: { term: Term }) {
  const { format, formatText } = useI18n()
  const { drafts, setDrafts, saving, customised, dirty, write } = useTermDraft(term)

  return (
    <div {...stylex.props(styles.term)} data-testid="term" data-term={term.id}>
      <div {...stylex.props(styles.termHead)}>
        <span {...stylex.props(styles.termTitle)}>
          {formatText(term.label)}
          {customised && <Badge variant="secondary">{format(m.customised)}</Badge>}
        </span>
        {term.description !== null && (
          <p {...stylex.props(styles.termNote)}>{formatText(term.description)}</p>
        )}
      </div>
      <div {...stylex.props(styles.words)}>
        <div {...stylex.props(styles.boxes)}>
          <TermBoxes term={term} drafts={drafts} setDrafts={setDrafts} saving={saving} />
        </div>
        <div {...stylex.props(styles.actions)}>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || (!customised && !dirty)}
            onClick={() => void write({ 'zh-CN': '', 'en-US': '' })}
          >
            {format(m.reset)}
          </Button>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void write(drafts)}>
            {format(m.save)}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** the same term as one line of a list, with the form a press away */
function TermRow({ term }: { term: Term }) {
  const { format, formatText, locale } = useI18n()
  const { drafts, setDrafts, saving, customised, dirty, write } = useTermDraft(term)
  const [open, setOpen] = useState(false)
  const word = term.override[locale] ?? term.defaults[locale] ?? ''

  const close = () => {
    setDrafts(() => ({
      'zh-CN': term.override['zh-CN'] ?? '',
      'en-US': term.override['en-US'] ?? '',
    }))
    setOpen(false)
  }

  return (
    <>
      <TableRow onOpen={() => setOpen(true)} data-testid="term" data-term={term.id}>
        <Cell lead>
          <LeadWord>{formatText(term.label)}</LeadWord>
          {customised && <Tag>{format(m.customised)}</Tag>}
        </Cell>
        {/* what the word is today, whether it was chosen here or fell back */}
        <Cell narrow="end" unlabelled tone="plain">
          {word}
        </Cell>
      </TableRow>
      <FormDialog
        open={open}
        title={formatText(term.label)}
        description={term.description === null ? undefined : formatText(term.description)}
        onClose={close}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={saving || (!customised && !dirty)}
              onClick={() => void write({ 'zh-CN': '', 'en-US': '' }).then(close)}
            >
              {format(m.reset)}
            </Button>
            <Button
              disabled={saving || !dirty}
              onClick={() => void write(drafts).then((ok) => ok && close())}
            >
              {format(m.save)}
            </Button>
          </>
        }
      >
        <TermBoxes term={term} drafts={drafts} setDrafts={setDrafts} saving={saving} />
      </FormDialog>
    </>
  )
}
