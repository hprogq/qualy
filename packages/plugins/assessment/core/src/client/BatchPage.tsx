import { useEffect } from 'react'
import { usePageNavigate, usePageRouteParams } from '@qualy/web-runtime'

// A batch on its own is not a screen: it is whichever of its sections you
// were last sent to. The address stays meaningful - somebody who has only the
// id can type it - and lands on the first section without leaving a step in
// the history to go back through.
export default function BatchPage() {
  const { batchId } = usePageRouteParams('batchId')
  const navigate = usePageNavigate()
  useEffect(() => {
    navigate('assessment/batch-phases', { params: { batchId }, replace: true })
  }, [navigate, batchId])
  return null
}
