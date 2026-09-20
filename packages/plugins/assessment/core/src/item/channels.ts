// The doors a question's records come in through.
//
// A revision names every door open on it, as a list: participants filing
// for themselves, staff recording an administrative fact, or both at once.
// It used to be exactly one of the two, which made the common arrangement -
// participants file, and the office fills in what they missed - impossible
// to configure. A derived question, which nobody files, names no door.
//
// The list is the whole of what a revision says about entry; how a record
// then walks (review, or none) is the review policy's, and which door a
// given record actually came through is the entry's own `source`.

export type EntryChannel = 'participant' | 'administrative'

export const ENTRY_CHANNELS: readonly EntryChannel[] = ['participant', 'administrative']

export const isEntryChannel = (value: unknown): value is EntryChannel =>
  value === 'participant' || value === 'administrative'

/** the stored list read back defensively: anything that is not a door is dropped */
export const readEntryChannels = (raw: unknown): readonly EntryChannel[] =>
  Array.isArray(raw) ? raw.filter(isEntryChannel) : []

export const opensTo = (channels: readonly EntryChannel[], channel: EntryChannel): boolean =>
  channels.includes(channel)
