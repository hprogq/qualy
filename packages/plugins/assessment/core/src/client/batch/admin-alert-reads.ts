// What a batch's administrators owe it is read with (admin-alerts.ts), and
// whether it is read at all.
//
// One module for the screens that read it and for the server that reads it
// first on the overview's behalf (BatchOverviewPage.server.tsx): the inputs
// are part of each read's cache key, so the counts a server read are the
// ones the desk finds, and the desk does not ask for them again while they
// are fresh. Free of React, so a server render can name it.

/** how long a count stands before another look, on every screen of the batch */
export const ADMIN_ALERTS_FRESH_MS = 60_000

/**
 * Whether this batch owes its administrators anything the desk and the
 * rail would list, by the batch's own word on the reader and on itself.
 *
 * Only for whoever manages it: the reads are refused to anybody else, and
 * a desk that asked anyway would only collect refusals. And not once it is
 * archived: an archived batch takes no appointment, no roster change and no
 * change to its questions (§9, §32.90①), so nothing listed there could be
 * mended - the staff page counts no pending organization change there for
 * the same reason.
 */
export const owesAdministration = (batch: {
  readonly status: 'draft' | 'active' | 'archived'
  readonly capabilities: { readonly manage: boolean }
}): boolean => batch.capabilities.manage && batch.status !== 'archived'

/** the inputs of the three counts; the totals ride on the first page, so one row is all it takes */
export const adminAlertReads = (batchId: string) => {
  const params = { batchId }
  return {
    alerts: { params, query: {} },
    placements: { params, query: { limit: '1' } },
    access: { params, query: { limit: '1' } },
  }
}
