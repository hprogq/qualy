// The shape every administration screen shares: a band that names the page,
// and a body laid out in columns under it.
//
// The band spans the content area and is cut from the body by one rule - not
// a card, not an inset box. Everything below is drawn the same way: sections
// separated by a hairline, lists in one bordered box rather than one box per
// row. A page built from cards reads as a pile of unrelated things; these
// screens are one thing with parts.
//
// Sizes and spacing are the product's, not a mock's: a heading here is the
// same heading as on every other page, and a control is whatever the design
// system says a control is.
//
// One public module (`@qualy/ui/screen`), split by migration unit: the page
// shell, section furniture, tick lists, the rail, and the blank state.
export { Screen, Segmented } from './shell.tsx'
export { SectionHead, Facts, DefRow, Barred, EditorHead, ModeChoice, SaveBar } from './sections.tsx'
export { PickGrid, PickList } from './pick.tsx'
export { Rail, RailRow, RailSkeleton, EditorSkeleton } from './rail.tsx'
export { Blank } from './blank.tsx'
