// What a file asks for, judged row by row and folded into the tree it
// implies - before anything is looked up, and with nothing looked up.
//
// Pure so the reading of a spreadsheet is a unit test: which rows are
// incomplete, which identifiers repeat, and what the set of units under the
// anchor would be if every row got its way.

import type { TableRow } from '@qualy/spreadsheet'
import type { ResolvedChain } from './mapping.ts'

export interface ImportIssue {
  readonly rowNo: number | null
  readonly field: string | null
  readonly severity: 'error' | 'warning'
  readonly reason: string
  readonly detail?: string
}

/** one row read through the mapping */
export interface JudgedRow {
  readonly rowNo: number
  readonly businessNo: string
  readonly displayName: string
  /** the unit names this row stands under, one per column level, in chain order */
  readonly orgNames: readonly string[]
  readonly issues: readonly ImportIssue[]
}

// what the columns they are written to hold: users.business_no,
// users.display_name and org_nodes.name
const BUSINESS_NO_MAX = 64
const DISPLAY_NAME_MAX = 100
const ORG_NAME_MAX = 255

/**
 * Whether a cell holds a C0 control character or DEL.
 *
 * A workbook can carry any of them through its `_xHHHH_` escape. A NUL is
 * refused by postgres, so the lookups the preview makes by number and by
 * unit name would fail outright; the unit separator is what joins the names
 * of a path, so it would make two different paths one unit. None of them
 * belongs in an identifier, a name or a unit.
 */
const holdsControl = (text: string): boolean => {
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export const judgeRows = (
  rows: readonly TableRow[],
  mapping: {
    readonly displayName: { readonly column: string }
    readonly businessNo: { readonly column: string }
  },
  chain: ResolvedChain,
): readonly JudgedRow[] => {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const issues: ImportIssue[] = []
    const businessNo = row.cells[mapping.businessNo.column] ?? ''
    const displayName = row.cells[mapping.displayName.column] ?? ''
    const say = (field: string, reason: string, detail?: string) =>
      issues.push({
        rowNo: row.rowNo,
        field,
        severity: 'error',
        reason,
        ...(detail === undefined ? {} : { detail }),
      })
    if (businessNo === '') say('businessNo', 'business-no-required')
    else if (holdsControl(businessNo)) say('businessNo', 'control-character')
    else if (businessNo.length > BUSINESS_NO_MAX) say('businessNo', 'business-no-too-long')
    else {
      const first = seen.get(businessNo)
      if (first !== undefined) say('businessNo', 'duplicate-in-file', String(first))
      else seen.set(businessNo, row.rowNo)
    }
    if (displayName === '') say('displayName', 'display-name-required')
    else if (holdsControl(displayName)) say('displayName', 'control-character')
    else if (displayName.length > DISPLAY_NAME_MAX) say('displayName', 'display-name-too-long')
    const orgNames = chain.columns.map((level) => row.cells[level.column!] ?? '')
    chain.columns.forEach((level, at) => {
      const name = orgNames[at]!
      if (name === '') say(`org.${level.orgTypeId}`, 'org-level-required')
      else if (holdsControl(name)) say(`org.${level.orgTypeId}`, 'control-character')
      else if (name.length > ORG_NAME_MAX) say(`org.${level.orgTypeId}`, 'org-name-too-long')
    })
    return { rowNo: row.rowNo, businessNo, displayName, orgNames, issues }
  })
}

/** one unit the file implies, by the names above it */
export interface DesiredNode {
  /** the names from the anchor down to this unit, joined by a separator no name holds */
  readonly key: string
  readonly parentKey: string | null
  readonly names: readonly string[]
  readonly name: string
  readonly depth: number
  readonly orgTypeId: string
}

/** joins the names of a path; a slash is what a reader sees, so it is not this */
export const KEY_SEPARATOR = ''

/**
 * The tree under the anchor, folded from every complete row: each distinct
 * prefix of names is one unit, parents before children.
 */
export const desiredTree = (
  rows: readonly JudgedRow[],
  chain: ResolvedChain,
): readonly DesiredNode[] => {
  const nodes = new Map<string, DesiredNode>()
  for (const row of rows) {
    if (row.issues.some((issue) => issue.severity === 'error')) continue
    let parentKey: string | null = null
    const names: string[] = []
    row.orgNames.forEach((name, depth) => {
      names.push(name)
      const key = names.join(KEY_SEPARATOR)
      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          parentKey,
          names: [...names],
          name,
          depth: depth + 1,
          orgTypeId: chain.columns[depth]!.orgTypeId,
        })
      }
      parentKey = key
    })
  }
  return [...nodes.values()].sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
}

/** the key of the unit a complete row stands at, or null at the anchor itself */
export const leafKeyOf = (row: JudgedRow): string | null =>
  row.orgNames.length === 0 ? null : row.orgNames.join(KEY_SEPARATOR)
