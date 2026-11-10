/** Relay one chunk at a time and cancel the reader that owns the source lock. */
export const relayRenderStream = (
  source: ReadableStream<Uint8Array>,
  controller: AbortController,
): ReadableStream<Uint8Array> => {
  const reader = source.getReader()
  let canceled = false
  return new ReadableStream<Uint8Array>({
    async pull(sink) {
      try {
        const { done, value } = await reader.read()
        if (canceled) return
        if (done) {
          reader.releaseLock()
          sink.close()
        } else {
          sink.enqueue(value)
        }
      } catch (error) {
        if (!canceled) {
          reader.releaseLock()
          sink.error(error)
        }
      }
    },
    async cancel(reason) {
      canceled = true
      controller.abort(reason)
      try {
        await reader.cancel(reason)
      } finally {
        reader.releaseLock()
      }
    },
  })
}
