import type { PeopleImportContext } from '@qualy/ui-contract'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { PageLink, useApiQuery, usePageHref } from '@qualy/web-runtime'
import { CheckboxGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { authApi } from '../api.ts'

import OrgNodePicker from './OrgNodePicker.tsx'
import * as m from '#messages'

// Naming a slice of the organization instead of naming people.
//
// The units come from the same picker every other screen uses - tree, search,
// filter by kind, ticking one covers everything under it - and the kinds of
// person are the other half of the query. What running it does is the asking
// screen's business.

// Two scrollbars inside one dialog is one too many, and the reader has to
// work out which is which before either of them helps. So this takes the
// whole height the dialog gives it and hands it out: the kinds of person are
// a short, always-needed choice and keep their natural height at the foot,
// and the tree takes what is left and scrolls on its own. The dialog body
// then never overflows, which is what removes the outer bar.
const styles = stylex.create({
  page: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 20,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  units: { minHeight: 0, flexGrow: 1 },
  kinds: { flexShrink: 0 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
})

export default function PeopleImportPicker({ context }: { context: PeopleImportContext }) {
  const query = useApiQuery(authApi)

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const types = options.data?.userTypes ?? []
  // where kinds of person are made, for the reader who may go there
  const typesReachable = usePageHref('auth/user-types') !== undefined
  const allChosen =
    types.length > 0 && types.every((type) => context.value.userTypeIds.includes(type.id))

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.section, styles.units)}>
        <p {...stylex.props(styles.title)}>{m.picker_importUnits()}</p>
        <OrgNodePicker
          context={{
            value: context.value.orgNodeIds,
            onChange: (orgNodeIds) => context.onChange({ ...context.value, orgNodeIds }),
          }}
        />
      </div>

      <div {...stylex.props(styles.section, styles.kinds)}>
        <div {...stylex.props(styles.head)}>
          <p {...stylex.props(styles.title)}>{m.picker_importTypes()}</p>
          {types.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                context.onChange({
                  ...context.value,
                  // one button for both directions: with everything ticked the
                  // only thing left to want is none of it
                  userTypeIds: allChosen ? [] : types.map((type) => type.id),
                })
              }
            >
              {(allChosen ? m.picker_importClearTypes : m.picker_importAllTypes)()}
            </Button>
          )}
        </div>
        {/* the heading above says these words already, beside the control
            that ticks them all; a fieldset still needs a name, and this is
            where it stops being drawn twice */}
        <CheckboxGroup
          hideLegend
          legend={m.picker_importTypes()}
          options={types.map((type) => ({ value: type.id, label: type.name }))}
          selected={[...context.value.userTypeIds]}
          onChange={(userTypeIds) => context.onChange({ ...context.value, userTypeIds })}
          emptyLabel={m.picker_importNoTypes()}
          emptyHint={(typesReachable ? m.picker_importNoTypesHint : m.picker_importNoTypesAsk)()}
          {...(typesReachable
            ? {
                emptyAction: (
                  <Button asChild size="sm" variant="outline">
                    <PageLink page="auth/user-types">{m.picker_importOpenTypes()}</PageLink>
                  </Button>
                ),
              }
            : {})}
        />
      </div>
    </div>
  )
}
