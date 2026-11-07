import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { answersOf } from '@qualy/web-rsc/queries'
import { formulaApi } from './api.ts'
import { libraryQueryOf } from './list-place.ts'
import FormulaTemplatesPage from './FormulaTemplatesPage.tsx'

// The formula templates of the library as a server draws them (docs/adr/0012-rsc-data-mode.md): the page
// the address names, read as the page reads it and handed to it.

export default async function Library() {
  const search = renderRequest().url.searchParams
  const read = { query: libraryQueryOf((key) => search.get(key) ?? '') }
  const key = queryKeyOf('assessmentFormula', 'listFormulaTemplates', read)
  const handed = await answersOf([
    {
      key,
      exit: readApiExit(
        formulaApi,
        (client) => client.assessmentFormula.listFormulaTemplates(read),
        { key },
      ),
    },
  ])
  return (
    <QueryHydration {...handed}>
      <FormulaTemplatesPage />
    </QueryHydration>
  )
}
