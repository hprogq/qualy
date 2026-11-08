import type { QueryKey } from '@tanstack/react-query'

// Where one read of an api lives in the query cache: its group, its
// endpoint, and the input it was asked with.
//
// One function, for the page that reads and for a server that reads first
// on the page's behalf (docs/adr/0012-rsc-data-mode.md): an answer the
// server put under any other key would not be found, and the page would ask
// again for what it was already handed. Free of React and of the browser,
// so a server render can name it.
//
// The input is part of the key - two reads that differ by input are
// different entries, and dropping it would serve one page's data to another
// - and a read with no input has a key of two parts, the same key its
// group-wide invalidation already names.

export const queryKeyOf = (group: string, endpoint: string, input?: unknown): QueryKey =>
  input !== undefined ? [group, endpoint, input] : [group, endpoint]
