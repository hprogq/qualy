// Which state of a formula the workbench shows, and how the address says it.
//
// One draft that is edited, and two kinds of history that are only read: a
// publication, by its number, and a saved revision of the draft. The address
// carries it so a reload, a back press or a link lands on the same thing.

export type WorkbenchView =
  | { readonly kind: 'draft' }
  | { readonly kind: 'release'; readonly versionNo: number }
  | { readonly kind: 'revision'; readonly revisionNo: number }

const positive = (text: string | undefined): number | null => {
  const value = Number(text)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export const parseView = (value: string): WorkbenchView => {
  const [kind, number] = value.split('-')
  const n = positive(number)
  if (kind === 'release' && n !== null) return { kind: 'release', versionNo: n }
  if (kind === 'revision' && n !== null) return { kind: 'revision', revisionNo: n }
  return { kind: 'draft' }
}

export const viewValue = (view: WorkbenchView): string =>
  view.kind === 'release'
    ? `release-${String(view.versionNo)}`
    : view.kind === 'revision'
      ? `revision-${String(view.revisionNo)}`
      : ''
