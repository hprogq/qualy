// the side-effect half a provider plugin registers itself from, as a
// lifecycle value: setup announces, the disposer takes it back
export const ACME_PROBE_BOOT_MARKER = 'acme-dist-probe-boot-4d90ab'

export default {
  setup: () => {
    globalThis.__acmeProbeBooted = ACME_PROBE_BOOT_MARKER
    return () => {
      delete globalThis.__acmeProbeBooted
    }
  },
}
