// The batch header and deadline docks are independent surfaces of the same
// workspace. The header owns the drawer, including its focus lifecycle.
const eventType = 'qualy:assessment:open-timeline'

export function openBatchFlow(batchId: string) {
  window.dispatchEvent(new CustomEvent(eventType, { detail: batchId }))
}

export function onBatchFlowRequest(batchId: string, open: () => void) {
  const receive = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === batchId) open()
  }
  window.addEventListener(eventType, receive)
  return () => window.removeEventListener(eventType, receive)
}
