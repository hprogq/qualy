import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { CheckboxGroup } from '@qualy/ui/admin'
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
// whenever somebody wants it: pick units and kinds of people, see how many
// that would add, decide. Nothing is remembered afterwards except that it
// happened - the roster is the batch's population, and this is one of the
// two ways somebody puts a name in it.

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
  onImport: (selection: { orgNodeIds: string[]; userTypeIds: string[] }) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [orgNodeIds, setOrgNodeIds] = useState<string[]>([])
  const [userTypeIds, setUserTypeIds] = useState<string[]>([])

  const nodes = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const userTypes = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })

  const ready = orgNodeIds.length > 0 && userTypeIds.length > 0
  // counted before anybody is added, and counted again by the server when
  // they are: this number is what somebody is agreeing to
  const candidates = useQuery({
    ...query.assessment.previewImport.queryOptions({
      params: { batchId },
      query: { orgNodeIds, userTypeIds },
    }),
    enabled: open && ready,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{format(m.importTitle)}</DialogTitle>
          <DialogDescription>{format(m.importHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">{format(m.scopeLegend)}</p>
            <div className="max-h-64 overflow-y-auto rounded-md border p-2">
              <TreeSelect
                value={orgNodeIds}
                onChange={setOrgNodeIds}
                nodes={nodes.data?.nodes ?? []}
                emptyLabel={format(m.scopeEmpty)}
              />
            </div>
          </div>
          <CheckboxGroup
            legend={format(m.userTypesLegend)}
            options={(userTypes.data?.userTypes ?? []).map((type) => ({
              value: type.id,
              label: type.name,
            }))}
            selected={userTypeIds}
            onChange={setUserTypeIds}
            emptyLabel={format(m.userTypesEmpty)}
          />
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {ready && candidates.data
              ? format(m.importCandidates, { count: candidates.data.candidates })
              : format(m.importChoose)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={pending || !ready || (candidates.data?.candidates ?? 0) === 0}
              onClick={() => onImport({ orgNodeIds, userTypeIds })}
            >
              {format(m.importConfirm)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
