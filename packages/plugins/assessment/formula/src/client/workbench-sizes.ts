import { useCallback, useState } from 'react'

// How big the workbench's regions are, as the person last dragged them.
//
// A convenience of one viewer in one browser, so it lives in localStorage and
// every read and write is allowed to fail: a private window, blocked site data
// or a quota refusal simply gives the defaults back. The draft, a publication
// and a saved revision share one set, so looking at history keeps the room
// the author arranged.

export interface WorkbenchSizes {
  /** the try-run column, where it has a column of its own */
  readonly tryWidth: number
  /** the versions column, where it has a column of its own */
  readonly historyWidth: number
  /** the one column both share on a narrower screen */
  readonly sideWidth: number
  /** the panel of tabs under the source */
  readonly panelHeight: number
}

export const DEFAULT_WORKBENCH_SIZES: WorkbenchSizes = {
  tryWidth: 324,
  historyWidth: 324,
  sideWidth: 340,
  panelHeight: 268,
}

const KEY = 'qualy.formula-workbench.sizes'

const read = (): WorkbenchSizes => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_WORKBENCH_SIZES
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkbenchSizes, unknown>>
    const pick = (key: keyof WorkbenchSizes): number => {
      const value = parsed[key]
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_WORKBENCH_SIZES[key]
    }
    return {
      tryWidth: pick('tryWidth'),
      historyWidth: pick('historyWidth'),
      sideWidth: pick('sideWidth'),
      panelHeight: pick('panelHeight'),
    }
  } catch {
    return DEFAULT_WORKBENCH_SIZES
  }
}

const write = (sizes: WorkbenchSizes): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes))
  } catch {
    // kept for this visit only
  }
}

/** the sizes, a way to change one while dragging, and a way to keep what was settled on */
export const useWorkbenchSizes = () => {
  const [sizes, setSizes] = useState(read)
  const resize = useCallback(
    (key: keyof WorkbenchSizes, value: number, settle: boolean) =>
      setSizes((previous) => {
        const next = { ...previous, [key]: Math.round(value) }
        if (settle) write(next)
        return next
      }),
    [],
  )
  return { sizes, resize }
}
