import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** where a batch opens, for whoever it belongs to */
export default function BatchOverviewPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabOverview)} description={format(m.overviewHint)}>
      {() => <p className="text-sm text-muted-foreground">{format(m.overviewPlaceholder)}</p>}
    </BatchScreen>
  )
}
