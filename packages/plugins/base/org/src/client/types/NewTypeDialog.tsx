import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { orgMessages as m } from '../i18n.ts'
import type { Api, Run } from '../shape.ts'

/** a new kind of unit has only a name; what it may hold is set once it exists */
export function NewTypeDialog({
  open,
  api,
  run,
  onCreated,
  onClose,
}: {
  open: boolean
  api: Api
  run: Run
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    setBusy(true)
    void run(api.org.createType({ payload: { name: name.trim() } }))
      .then((created) => {
        setName('')
        onClose()
        const id =
          (created as { type?: { id?: string }; id?: string } | undefined)?.type?.id ??
          (created as { id?: string } | undefined)?.id
        if (id) onCreated(id)
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return (
    <FormDialog
      open={open}
      title={format(m.newTypeTitle)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={name.trim() === '' || busy} onClick={submit}>
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Field label={format(m.nameLabel)}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() !== '' && !busy) submit()
            }}
          />
        )}
      </Field>
    </FormDialog>
  )
}
