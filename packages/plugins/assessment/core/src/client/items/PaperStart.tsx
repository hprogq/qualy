import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// A round with no paper yet.
//
// The paper is the outermost group: everything a round asks sits inside it,
// and its ceiling is what the whole round is worth. Until it exists there is
// nothing to arrange, so this screen is about starting one rather than an
// empty list with an add button somewhere in it.

export function PaperStart({ batchId, onCreated }: { batchId: string; onCreated: () => void }) {
  const { format } = useI18n()
  const [wizard, setWizard] = useState(false)
  const [blank, setBlank] = useState(false)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
      <div className="flex max-w-140 flex-col gap-2 text-center">
        <h3 className="text-lg font-semibold">{format(m.paperStartTitle)}</h3>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          {format(m.paperStartHint)}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {/* the suggested route carries the darker edge and the filled button;
            two identical cards make the reader choose before they know what
            either one does */}
        <button
          type="button"
          className="flex w-74 flex-col gap-2.5 rounded-lg border border-foreground/20 p-4.5 text-left shadow-xs transition-colors hover:bg-accent/40"
          onClick={() => setWizard(true)}
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">{format(m.paperStartGuided)}</span>
            <span className="rounded-full bg-primary px-1.75 py-px text-[11px] font-medium text-primary-foreground">
              {format(m.paperStartSuggested)}
            </span>
          </span>
          <span className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
            {format(m.paperStartGuidedHint)}
          </span>
          <span className="flex h-8 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            {format(m.paperStartAction)}
          </span>
        </button>

        <button
          type="button"
          className="flex w-74 flex-col gap-2.5 rounded-lg border p-4.5 text-left transition-colors hover:bg-accent/40"
          onClick={() => setBlank(true)}
        >
          <span className="text-sm font-semibold">{format(m.paperStartBlank)}</span>
          <span className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
            {format(m.paperStartBlankHint)}
          </span>
          <span className="flex h-8 items-center justify-center rounded-lg border text-sm font-medium">
            {format(m.itemsGroupNew)}
          </span>
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{format(m.paperStartReassure)}</p>

      {(wizard || blank) && (
        <PaperWizard
          batchId={batchId}
          /* the blank route asks the same two things and simply leaves the
             ceiling empty; a second dialog for that would be a second answer
             to one question */
          capped={wizard}
          onClose={() => {
            setWizard(false)
            setBlank(false)
          }}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}

function PaperWizard({
  batchId,
  capped,
  onClose,
  onCreated,
}: {
  batchId: string
  capped: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [name, setName] = useState(format(m.paperDefaultName))
  const [cap, setCap] = useState(capped ? '100.00' : '')

  const create = useMutation({
    mutationFn: () =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: [
              {
                parentGroupId: null,
                name: name.trim(),
                cap: cap.trim() === '' ? null : cap.trim(),
                floor: null,
              },
            ],
            expectedVersion: 1,
          },
        }),
      ),
    onSuccess: () => {
      onCreated()
      onClose()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <FormDialog
      open
      title={format(m.paperCreateTitle)}
      description={format(m.paperCreateHint)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={create.isPending || name.trim() === ''} onClick={() => create.mutate()}>
            {format(m.paperCreate)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={format(m.itemsGroupName)}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.paperTotal)} hint={format(m.paperTotalHint)}>
          {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
        </Field>
      </div>
    </FormDialog>
  )
}
