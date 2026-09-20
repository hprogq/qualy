import { UploadIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import type { UsersPageActionsContext } from '@qualy/ui-contract'
import { directoryImportMessages as m } from './i18n.ts'

// The one press on the users screen that leads to importing people: a
// link, so the import page opens with the unit the reader was looking at.

export default function ImportUsersAction({ context }: { context: UsersPageActionsContext }) {
  const { format } = useI18n()
  return (
    <Button size="sm" variant="outline" asChild>
      <PageLink
        page="directory-import/users"
        {...(context.anchorNodeId === null ? {} : { search: { anchor: context.anchorNodeId } })}
      >
        <UploadIcon aria-hidden />
        {format(m.action)}
      </PageLink>
    </Button>
  )
}
