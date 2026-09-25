import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { FieldGroup } from '@qualy/ui/field'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { TreeSelect } from '@qualy/ui/tree-select'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Running the organization query again, once.
//
// The same act that filled the roster when the batch was created, offered
// whenever somebody wants it, and drawn from the same options the batch was
// created from: the units this reader manages and the kinds of people there
// are, served by this domain. Running a round needs assessment authority and
// nothing else - not the directory's own read permission, which a round's
// administrator need not hold. What it would do here is said as a number
// before the button will do anything.

interface Selection {
  orgNodeIds: readonly string[]
  userTypeIds: readonly string[]
}

const styles = stylex.create({
  body: { maxHeight: '62vh' },
  tree: {
    maxHeight: 280,
    overflowY: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 8,
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  foot: {
    justifyContent: {
      default: null,
      [breakpoints.tablet]: 'space-between',
      [breakpoints.desktop]: 'space-between',
    },
  },
  footSide: { display: 'flex', alignItems: 'center', gap: 8 },
})

const EMPTY: Selection = { orgNodeIds: [], userTypeIds: [] }

export function ImportDialog({
  batchId,
  open,
  pending,
  onImport,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onImport: (selection: Selection) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [selection, setSelection] = useState<Selection>(EMPTY)
  useEffect(() => {
    if (open) setSelection(EMPTY)
  }, [open])

  // asked for when the dialog opens, not when the page behind it loads
  const nodes = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const userTypes = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })

  const ready = selection.orgNodeIds.length > 0 && selection.userTypeIds.length > 0
  // counted before anybody is added, and counted again by the server when
  // they are: this number is what somebody is agreeing to
  const candidates = useQuery({
    ...query.assessment.previewImport.queryOptions({
      params: { batchId },
      query: {
        orgNodeIds: [...selection.orgNodeIds],
        userTypeIds: [...selection.userTypeIds],
      },
    }),
    enabled: open && ready,
  })
  const failed = nodes.isError ? nodes.error : userTypes.isError ? userTypes.error : null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="42rem">
        <DialogHeader>
          <DialogTitle>{format(m.importTitle)}</DialogTitle>
          <DialogDescription>{format(m.importHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <AsyncSection
            pending={nodes.isPending || userTypes.isPending}
            error={failed === null ? null : formatError(failed)}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => {
              void nodes.refetch()
              void userTypes.refetch()
            }}
          >
            <FieldGroup>
              <Field label={format(m.scopeLegend)}>
                {() => (
                  <div data-testid="import-units" {...stylex.props(styles.tree)}>
                    <TreeSelect
                      value={selection.orgNodeIds}
                      onChange={(orgNodeIds) => setSelection((now) => ({ ...now, orgNodeIds }))}
                      nodes={nodes.data?.nodes ?? []}
                      emptyLabel={format(m.scopeEmpty)}
                    />
                  </div>
                )}
              </Field>
              <CheckboxGroup
                legend={format(m.userTypesLegend)}
                options={(userTypes.data?.userTypes ?? []).map((type) => ({
                  value: type.id,
                  label: type.name,
                }))}
                selected={[...selection.userTypeIds]}
                onChange={(userTypeIds) => setSelection((now) => ({ ...now, userTypeIds }))}
                emptyLabel={format(m.userTypesEmpty)}
              />
            </FieldGroup>
          </AsyncSection>
        </DialogBody>
        <DialogFooter className={stylex.props(styles.foot).className}>
          <span
            // how many this import would add, as a number; the sentence
            // around it is copy and changes without the count changing
            data-testid="import-candidates"
            data-ready={String(ready && candidates.data !== undefined)}
            data-count={ready && candidates.data ? String(candidates.data.candidates) : ''}
            {...stylex.props(styles.quiet)}
          >
            {ready && candidates.data
              ? format(m.importCandidates, { count: candidates.data.candidates })
              : format(m.importChoose)}
          </span>
          <div {...stylex.props(styles.footSide)}>
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={pending || !ready || (candidates.data?.candidates ?? 0) === 0}
              onClick={() => onImport(selection)}
            >
              {format(m.importConfirm)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
